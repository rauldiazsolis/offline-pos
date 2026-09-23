import { splitConnectorCustomers } from '../domain/customer.ts';
import { markSynced, type OutboxEvent } from '../domain/outbox.ts';
import { buildPushLot, isLotDue, isPushStruggling, markLotFailed, type PushLot } from '../domain/push-lot.ts';
import { err, ok, type Failure, type Result } from '../domain/result.ts';
import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { db } from '../storage/db.ts';
import { newId } from '../storage/ids.ts';
import { countLocalCatalog, listPendingOutbox } from '../storage/local-data.ts';
import { reconcileSnapshot } from '../storage/reconcile.ts';
import { setCatalogRepository } from '../ui/state/catalog.ts';
import { setCustomerRepository } from '../ui/state/customer-repository.ts';
import {
  appendSyncLogEntry,
  lastSyncFailureSignal,
  pushLotIssuesSignal,
  setLastSyncFailure,
  setLastSyncedAt,
  setLocalCatalogCounts,
  setPendingOutboxCount,
  setPushLotIssues,
  setSyncConfigured,
  setSyncStatus,
  syncPausedSignal,
  type SyncLogEntry,
} from '../ui/state/sync.ts';
import type { Connector, OutboxBatchItem } from './connector.ts';
import { loadSyncConfig, type SyncConfig } from './config.ts';
import { connectorPullMode, createConnector } from './connector-registry.ts';
import {
  getCustomersCursor,
  getLastFullSyncAt,
  getProductsCursor,
  setCustomersCursor,
  setLastFullSyncAt,
  setProductsCursor,
} from './cursor.ts';
import { isFullRefreshDue } from './full-refresh.ts';
import { toProbeSnapshot, withTimeout } from './pull-snapshot.ts';
import {
  addAwaitingLot,
  clearCurrentPushLot,
  getAwaitingLots,
  getCurrentPushLot,
  resolveAwaitingLots,
  setCurrentPushLot,
} from './push-lot.ts';

/** Convierte un evento del outbox a su forma de red — sin `status`/`createdAt`, bookkeeping local. */
export function toBatchItem(event: OutboxEvent): OutboxBatchItem {
  switch (event.type) {
    case 'sale':
      return { type: 'sale', id: event.id, sale: event.sale };
    case 'stock-movement':
      return { type: 'stock-movement', id: event.id, movement: event.movement };
    case 'sale-void':
      return {
        type: 'sale-void',
        id: event.id,
        saleId: event.saleId,
        voidedAt: event.voidedAt,
        ...(event.voidReason !== undefined ? { voidReason: event.voidReason } : {}),
      };
    case 'customer':
      return { type: 'customer', id: event.id, customer: event.customer };
    case 'account-hold-confirm':
      return { type: 'account-hold-confirm', id: event.id, holdId: event.holdId, saleId: event.saleId };
    case 'account-hold-release':
      return { type: 'account-hold-release', id: event.id, holdId: event.holdId };
    case 'cash-session':
      return { type: 'cash-session', id: event.id, session: event.session };
    default: {
      const exhaustiveCheck: never = event;
      throw new Error(`Tipo de evento de outbox desconocido: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/**
 * Registra un intento real de push/pull para `/DIAGNOSTICO` — `request`/
 * `result` son literalmente lo que el call site ya tiene en la mano (los
 * argumentos que le pasó al `Connector` y lo que devolvió), sin resumir
 * nada, así se puede correlacionar con la pestaña Network del navegador.
 * Un ciclo exitoso normal no imprime nada en consola — solo queda en el
 * log; `sync/pending-lot` es el descarte esperado del diseño (ver spec de
 * #87), no un problema, así que va a `console.info` en vez de `console.error`.
 */
function logSyncAttempt(kind: 'push' | 'pull', now: string, request: unknown, result: Result<unknown>): void {
  const entry: SyncLogEntry = {
    at: now,
    kind,
    request,
    result: result.ok ? { ok: true } : { ok: false, error: result.error, meta: result.meta },
  };
  appendSyncLogEntry(entry);
  if (result.ok) {
    return;
  }
  if (result.error === 'sync/pending-lot') {
    console.info(`[sync] ${kind} descartado — lote de push todavía pendiente`, entry);
    return;
  }
  console.error(`[sync] ${kind} falló: ${result.error}`, entry);
}

/**
 * Retoma el lote en curso (mismo id, mismo conjunto de eventos — nunca se
 * recalcula en un reintento) o arma uno nuevo con todo lo pendiente del
 * outbox, en orden `createdAt`. `undefined` si no hay nada que enviar.
 */
async function buildOrResumeLot(now: string): Promise<{ lot: PushLot; events: OutboxEvent[] } | undefined> {
  const existing = getCurrentPushLot();
  if (existing !== undefined) {
    const events = (await db.outbox.bulkGet(existing.eventIds)).filter(
      (event): event is OutboxEvent => event !== undefined && event.status === 'pending',
    );
    if (events.length > 0) {
      return { lot: existing, events };
    }
    // Ya no queda nada pendiente de ese lote (p.ej. lo limpió /DEMO_RESET) — se descarta.
    clearCurrentPushLot();
  }

  const pending = await listPendingOutbox();
  if (pending.length === 0) {
    return undefined;
  }
  const lot = buildPushLot(pending.map((event) => event.id), { id: newId(), now });
  setCurrentPushLot(lot);
  return { lot, events: pending };
}

export type PushSummary = { attempted: number; failed: boolean };

/**
 * Un ciclo de **push**: manda todo el outbox pendiente en un solo lote
 * (#87) — reemplaza el `pushOnce`/`pushPendingEvents` por-evento de antes.
 * `ignoreBackoff` saltea la ventana de reintento del lote: lo usa el envío
 * final antes de borrar los datos al cambiar de conexión
 * (`sync/apply-connection.ts::flushPendingBeforeWipe`) y `/SINCRONIZAR`.
 */
export async function pushPendingLot(
  connector: Connector,
  now: string,
  options: { ignoreBackoff?: boolean } = {},
): Promise<PushSummary> {
  const resumed = await buildOrResumeLot(now);
  if (resumed === undefined) {
    return { attempted: 0, failed: false };
  }
  const { lot, events } = resumed;
  if (options.ignoreBackoff !== true && !isLotDue(lot, now)) {
    return { attempted: 0, failed: false };
  }

  const items = events.map(toBatchItem);
  const result = await connector.pushBatch(items, lot.id);
  logSyncAttempt('push', now, { idempotencyId: lot.id, events: items }, result);
  if (result.ok) {
    await db.outbox.bulkPut(events.map(markSynced));
    clearCurrentPushLot();
    addAwaitingLot({ id: lot.id, sentAt: now });
    return { attempted: events.length, failed: false };
  }

  setCurrentPushLot(markLotFailed(lot, { now, error: result.error }));
  return { attempted: events.length, failed: true };
}

/** ¿Ya se hizo una foto completa desde que arrancó el motor (esta carga de la página)? */
let fullRefreshDoneThisSession = false;

/** Marca que en esta sesión todavía no hubo una foto completa (arranque del motor y tests). */
export function resetFullRefreshSession(): void {
  fullRefreshDoneThisSession = false;
}

/** Tope de una foto completa: un backend colgado no puede dejar tomado el cerrojo de sync. */
export const FULL_REFRESH_TIMEOUT_MS = 60_000;

type PullOutcome = { applied: boolean; failure?: Failure; issues: string[]; request: unknown };

/**
 * Un ciclo de **pull**: un solo `pullBatch` (delta si `full` no está, foto
 * completa si sí), gateado por el estado de los lotes de push que el POS
 * todavía espera confirmar (#87) — si alguno sigue `pending`, no se aplica
 * nada de este pull (ver spec, "Regla de aplicación"). Reemplaza
 * `pullCatalog`/`pullCustomers`/`syncOnce`/`syncFull` de antes de #87.
 */
async function pullAndApply(
  connector: Connector,
  now: string,
  options: { full: boolean },
): Promise<PullOutcome> {
  const awaiting = getAwaitingLots();
  const productsCursor = getProductsCursor();
  const customersCursor = getCustomersCursor();
  const cursors = options.full
    ? {}
    : {
        ...(productsCursor !== undefined ? { products: productsCursor } : {}),
        ...(customersCursor !== undefined ? { customers: customersCursor } : {}),
      };

  const request = { cursors, pendingLotIds: awaiting.map((lot) => lot.id) };
  const pullPromise = connector.pullBatch(request);
  // Solo la foto completa lleva tope de tiempo (mismo criterio que antes de #87): un backend
  // colgado en un delta normal no justificaba la complejidad extra, la foto completa sí porque
  // puede tardar mucho más y correr menos seguido.
  const pullResult = options.full ? await withTimeout(pullPromise, FULL_REFRESH_TIMEOUT_MS) : await pullPromise;
  if (!pullResult.ok) {
    return { applied: false, failure: pullResult, issues: [], request };
  }

  const resolved = new Set<string>();
  const issues: string[] = [];
  let stillPending = false;
  for (const lot of awaiting) {
    const status = pullResult.value.lots[lot.id];
    if (status === undefined || status.status === 'pending') {
      stillPending = true;
      continue;
    }
    resolved.add(lot.id);
    if (status.status === 'issues') {
      issues.push(...status.issues);
    }
  }
  resolveAwaitingLots(resolved);

  if (stillPending) {
    return { applied: false, failure: err('sync/pending-lot', undefined) as Failure, issues, request };
  }

  if (options.full) {
    const snapshot = toProbeSnapshot(pullResult.value);
    const applied = await reconcileSnapshot(snapshot, { now });
    if (!applied.ok) {
      return { applied: false, failure: applied, issues, request };
    }
    if (applied.value.skipped.length > 0) {
      return {
        applied: false,
        failure: err('sync/empty-snapshot', { tables: applied.value.skipped }) as Failure,
        issues,
        request,
      };
    }
    if (snapshot.cursors.products !== undefined) {
      setProductsCursor(snapshot.cursors.products);
    }
    if (snapshot.cursors.customers !== undefined) {
      setCustomersCursor(snapshot.cursors.customers);
    }
    setCatalogRepository(await loadCatalogRepository());
    setCustomerRepository(await loadCustomerRepository());
    setLastFullSyncAt(now);
    fullRefreshDoneThisSession = true;
    return { applied: true, issues, request };
  }

  if (pullResult.value.products.items.length > 0) {
    await db.products.bulkPut(pullResult.value.products.items);
    setCatalogRepository(await loadCatalogRepository());
  }
  if (pullResult.value.products.nextCursor !== undefined) {
    setProductsCursor(pullResult.value.products.nextCursor);
  }
  if (pullResult.value.stock.length > 0) {
    await db.stock.bulkPut(pullResult.value.stock);
  }
  if (pullResult.value.customers.items.length > 0) {
    const { customers, accounts } = splitConnectorCustomers(pullResult.value.customers.items, { now });
    await db.customers.bulkPut(customers);
    if (accounts.length > 0) {
      await db.customerAccounts.bulkPut(accounts);
    }
    setCustomerRepository(await loadCustomerRepository());
  }
  if (pullResult.value.customers.nextCursor !== undefined) {
    setCustomersCursor(pullResult.value.customers.nextCursor);
  }
  return { applied: true, issues, request };
}

/** Cola común de un ciclo de pull: conteos, aviso de issues y estado honesto (#53, adaptado a #87). */
async function finishPullCycle(now: string, outcome: PullOutcome): Promise<Result<void>> {
  setPendingOutboxCount(await db.outbox.where('status').equals('pending').count());
  setLocalCatalogCounts(await countLocalCatalog());
  setPushLotIssues(outcome.issues.length > 0 ? outcome.issues : null);
  if (outcome.issues.length > 0) {
    console.warn('[sync] el backend reportó issues en un lote de push ya confirmado', outcome.issues);
  }
  logSyncAttempt('pull', now, outcome.request, outcome.failure ?? ok(undefined));

  if (outcome.failure !== undefined) {
    setLastSyncFailure(outcome.failure);
    setSyncStatus('sync-error');
    return outcome.failure;
  }
  setLastSyncFailure(null);

  if (isPushStruggling(getCurrentPushLot())) {
    setSyncStatus('sync-error');
    return ok(undefined);
  }
  setSyncStatus('online-idle');
  setLastSyncedAt(now);
  return ok(undefined);
}

export async function runPullCycle(
  connector: Connector,
  now: string,
  options: { full?: boolean } = {},
): Promise<Result<void>> {
  setSyncStatus('syncing');
  const outcome = await pullAndApply(connector, now, { full: options.full === true });
  return finishPullCycle(now, outcome);
}

/**
 * Es responsabilidad de la app no saturar a la API: si un ciclo tarda más
 * que el intervalo del loop (una API lenta de verdad), el próximo disparo
 * (`setInterval`, evento `online`, o `/SINCRONIZAR`) no debe arrancar un
 * segundo ciclo en paralelo — ver issue #1. La bandera se lee/escribe de
 * forma síncrona (`tryAcquireSyncLock`), antes de cualquier `await`, así
 * una llamada reentrante la ve actualizada sin importar en qué punto del
 * ciclo anterior ocurra. Desde la Etapa 2b es también el cerrojo de
 * `sync/apply-connection.ts`: aplicar una conexión no puede intercalarse
 * con un ciclo. Con push y pull ahora independientes (#87), cada request
 * individual lo toma y lo suelta alrededor de sí mismo — nunca durante todo
 * el intervalo entre ciclos.
 */
let syncInProgress = false;

/** Para `/DIAGNOSTICO`: solo lectura, no toma ni libera el cerrojo. */
export function isSyncLockHeld(): boolean {
  return syncInProgress;
}

/** Toma el cerrojo sin esperar; devuelve la función que lo libera, o `undefined` si ya está tomado. */
export function tryAcquireSyncLock(): (() => void) | undefined {
  if (syncInProgress) {
    return undefined;
  }
  syncInProgress = true;
  return () => {
    syncInProgress = false;
  };
}

/** Como `tryAcquireSyncLock`, pero espera hasta `waitMs` a que se libere. */
export async function acquireSyncLockWaiting(waitMs: number): Promise<(() => void) | undefined> {
  const deadline = Date.now() + waitMs;
  let release = tryAcquireSyncLock();
  while (release === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    release = tryAcquireSyncLock();
  }
  return release;
}

/**
 * Preámbulo común a cualquier ciclo (push o pull, #87): toma el cerrojo
 * **solo mientras dura este request** (nunca durante todo el intervalo entre
 * ciclos), respeta `/CONFIG` abierto, chequea red y config activa. `run`
 * recibe el conector ya armado, la hora y la config — así ni `pushPendingLot`
 * ni `runPullCycle` necesitan saber de dónde salió.
 */
async function withConnectorCycle(
  run: (connector: Connector, now: string, config: SyncConfig) => Promise<void>,
): Promise<void> {
  if (syncPausedSignal.value) {
    return;
  }
  const release = tryAcquireSyncLock();
  if (release === undefined) {
    return;
  }
  try {
    if (!navigator.onLine) {
      setSyncStatus('offline');
      return;
    }
    const configResult = loadSyncConfig();
    if (!configResult.ok || configResult.value.verifiedAt === undefined) {
      setSyncConfigured(false);
      return;
    }
    setSyncConfigured(true);
    const connector = createConnector(configResult.value);
    await run(connector, new Date().toISOString(), configResult.value);
  } finally {
    release();
  }
}

/** Ciclo de **push**: reemplaza el `pull:false` de `runSyncCycle` de antes de #87. */
export async function runPushCycle(options: { ignoreBackoff?: boolean } = {}): Promise<void> {
  await withConnectorCycle(async (connector, now) => {
    const summary = await pushPendingLot(connector, now, options);
    setPendingOutboxCount(await db.outbox.where('status').equals('pending').count());
    setSyncStatus(
      lastSyncFailureSignal.value !== null || isPushStruggling(getCurrentPushLot())
        ? 'sync-error'
        : 'online-idle',
    );
    if (summary.attempted > 0 && !summary.failed) {
      schedulePullSoon(PULL_DELAY_AFTER_PUSH_MS);
    }
    scheduleNextPushRetry();
  });
}

/**
 * Ciclo de **pull**: decide foto completa vs. delta y corre `runPullCycle`. Si un delta resuelve
 * un lote con `issues`, encadena una foto completa ya mismo, sin esperar a la cadencia de 2h —
 * mismo criterio de la tabla de cadencias del spec ("pull completo ... o si un pull delta avisa
 * issues graves en algún lote"): acá se trata cualquier `issues` como grave, ya que
 * `BatchLotStatus` no distingue severidad — más conservador, nunca se autobloquea, solo adelanta
 * la reconciliación completa.
 */
export async function runPullCycleNow(options: { full?: boolean } = {}): Promise<void> {
  await withConnectorCycle(async (connector, now, config) => {
    const full =
      options.full === true ||
      isFullRefreshDue({
        mode: connectorPullMode(config.type),
        lastFullAt: getLastFullSyncAt(),
        now,
        doneThisSession: fullRefreshDoneThisSession,
      });
    await runPullCycle(connector, now, { full });
    if (!full && pushLotIssuesSignal.value !== null) {
      await runPullCycle(connector, now, { full: true });
    }
  });
}

/** `/SINCRONIZAR` (RF-12, bajo demanda): fuerza el push ya (ignora backoff) y un pull completo ya. */
export async function syncNow(): Promise<void> {
  await runPushCycle({ ignoreBackoff: true });
  await runPullCycleNow({ full: true });
}

/** Ciclo completo al arrancar/red de seguridad de push (10-15 min — #87 separa esto del pull). */
export const PUSH_INTERVAL_MS = 12 * 60 * 1000;
/** Red de seguridad de pull, independiente de que haya habido push (#87: cadencias propias). */
export const PULL_SAFETY_NET_INTERVAL_MS = 15 * 60 * 1000;
/** "Un rato después" de un push exitoso, antes de pedir el delta correspondiente (#87). */
export const PULL_DELAY_AFTER_PUSH_MS = 2 * 60 * 1000;
/** Agrupa pedidos de push seguidos (varios eventos del outbox casi juntos). */
export const PUSH_DEBOUNCE_MS = 2_000;
const MIN_RETRY_TIMER_MS = 1_000;
const MAX_RETRY_TIMER_MS = 5 * 60 * 1000;

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pushDueAt = 0;

/** Agenda un push. Si ya hay uno agendado más cerca, lo conserva; si el nuevo es más cercano, lo adelanta. */
export function requestPushSoon(delayMs: number = PUSH_DEBOUNCE_MS): void {
  const dueAt = Date.now() + delayMs;
  if (pushTimer !== undefined) {
    if (pushDueAt <= dueAt) {
      return;
    }
    clearTimeout(pushTimer);
  }
  pushDueAt = dueAt;
  pushTimer = setTimeout(() => {
    pushTimer = undefined;
    void runPushCycle();
  }, delayMs);
}

export function cancelScheduledPush(): void {
  if (pushTimer !== undefined) {
    clearTimeout(pushTimer);
    pushTimer = undefined;
  }
}

let pullTimer: ReturnType<typeof setTimeout> | undefined;
let pullDueAt = 0;

function schedulePullSoon(delayMs: number): void {
  const dueAt = Date.now() + delayMs;
  if (pullTimer !== undefined) {
    if (pullDueAt <= dueAt) {
      return;
    }
    clearTimeout(pullTimer);
  }
  pullDueAt = dueAt;
  pullTimer = setTimeout(() => {
    pullTimer = undefined;
    void runPullCycleNow();
  }, delayMs);
}

export function cancelScheduledPull(): void {
  if (pullTimer !== undefined) {
    clearTimeout(pullTimer);
    pullTimer = undefined;
  }
}

/** Agenda un push para cuando venza el backoff del lote en curso, si hay uno fallido. */
function scheduleNextPushRetry(): void {
  const lot = getCurrentPushLot();
  if (lot === undefined) {
    return;
  }
  const delay = Math.min(
    Math.max(new Date(lot.nextAttemptAt).getTime() - Date.now(), MIN_RETRY_TIMER_MS),
    MAX_RETRY_TIMER_MS,
  );
  requestPushSoon(delay);
}

/**
 * Dispara un push y, recién cuando termina (soltó el cerrojo), un pull —
 * nunca los dos a la vez: como los dos compiten por el mismo cerrojo
 * (`tryAcquireSyncLock`, sin espera) y el push siempre se llama primero, un
 * pull disparado en simultáneo perdería la carrera y no correría nunca. No
 * es la cadencia normal de cada uno (que sigue siendo independiente vía sus
 * propios timers) — es solo cómo conviven cuando algo los dispara juntos
 * (arranque, evento `online`).
 */
export async function runPushThenPull(options: { full?: boolean } = {}): Promise<void> {
  await runPushCycle();
  await runPullCycleNow(options);
}

/**
 * Motor de sync mientras la pestaña está abierta (Fase 2; Background Sync de
 * Service Worker sigue siendo Fase 7). Push y pull corren en dos cadencias
 * independientes (#87): push al arrancar + cada `PUSH_INTERVAL_MS` + por
 * cada evento nuevo del outbox (debounced) + al vencer su backoff; pull al
 * arrancar + cada `PULL_SAFETY_NET_INTERVAL_MS` + un rato después de cada
 * push exitoso. El evento `online` dispara los dos. Devuelve la función que
 * lo detiene (tests).
 */
export function startSyncEngine(): () => void {
  resetFullRefreshSession();
  void runPushThenPull();
  const pushInterval = setInterval(() => void runPushCycle(), PUSH_INTERVAL_MS);
  const pullInterval = setInterval(() => void runPullCycleNow(), PULL_SAFETY_NET_INTERVAL_MS);
  const onOnline = (): void => {
    void runPushThenPull();
  };
  window.addEventListener('online', onOnline);
  const onOutboxEvent = (): void => {
    requestPushSoon();
  };
  db.outbox.hook('creating', onOutboxEvent);

  return () => {
    clearInterval(pushInterval);
    clearInterval(pullInterval);
    window.removeEventListener('online', onOnline);
    db.outbox.hook('creating').unsubscribe(onOutboxEvent);
    cancelScheduledPush();
    cancelScheduledPull();
  };
}
