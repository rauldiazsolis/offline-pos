import { markSynced, type OutboxEvent } from '../domain/outbox.ts';
import {
  buildPushLot,
  isLotDue,
  isPushStruggling,
  markLotFailed,
  markLotNotReceived,
  type PushLot,
} from '../domain/push-lot.ts';
import { err, ok, type Failure, type Result } from '../domain/result.ts';
import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { db } from '../storage/db.ts';
import { applyPull } from '../storage/apply-pull.ts';
import { newId } from '../storage/ids.ts';
import { countLocalCatalog, listPendingOutbox } from '../storage/local-data.ts';
import { setCatalogRepository } from '../ui/state/catalog.ts';
import { setCustomerRepository } from '../ui/state/customer-repository.ts';
import { refreshStockSnapshot } from '../ui/state/stock.ts';
import {
  appendSyncLogEntry,
  lastSyncFailureSignal,
  pushLotIssuesSignal,
  setLastPullApplication,
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
import { runCleanupIfDue } from './cleanup-schedule.ts';
import type { Connector, LotIssue, OutboxBatchItem } from './connector.ts';
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
import { withTimeout } from './pull-snapshot.ts';
import { classifyLots, type PullApplication } from './pull-rule.ts';
import {
  addAwaitingLot,
  type AwaitingLot,
  clearCurrentPushLot,
  getAwaitingLots,
  getCurrentPushLot,
  setCurrentPushLot,
  updateAwaitingLots,
} from './push-lot.ts';
import { getDeviceId } from './terminal-identity.ts';

/** Convierte un evento del outbox a su forma de red (contrato v3): payload + sobre, sin `status`. */
export function toBatchItem(event: OutboxEvent): OutboxBatchItem {
  // Un evento encolado antes de v3 no tiene `origin`: viaja vacío (el contrato lo tolera hasta #97).
  const envelope = { id: event.id, createdAt: event.createdAt, origin: event.origin ?? {} };
  switch (event.type) {
    case 'sale':
      return { type: 'sale', sale: event.sale, ...envelope };
    case 'stock-movement':
      return { type: 'stock-movement', movement: event.movement, ...envelope };
    case 'customer':
      return { type: 'customer', customer: event.customer, ...envelope };
    case 'account-hold-confirm':
      return {
        type: 'account-hold-confirm',
        holdId: event.holdId,
        saleId: event.saleId,
        ...envelope,
      };
    case 'account-hold-release':
      return { type: 'account-hold-release', holdId: event.holdId, ...envelope };
    case 'cash-movement':
      return { type: 'cash-movement', movement: event.movement, ...envelope };
    case 'customer-payment':
      return { type: 'customer-payment', payment: event.payment, ...envelope };
    default: {
      const exhaustiveCheck: never = event;
      throw new Error(`Tipo de evento de outbox desconocido: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/**
 * Registra un intento real de push/pull para `/DIAGNOSTICO` — `request`/
 * `result` son literalmente lo que el call site ya tiene en la mano, sin
 * resumir, así se puede correlacionar con la pestaña Network. Un ciclo
 * exitoso no toca la consola, salvo un pull que retuvo stock y saldos: es el
 * comportamiento esperado mientras un lote se procesa (#98), va a `console.info`.
 */
function logSyncAttempt(
  kind: 'push' | 'pull',
  now: string,
  request: unknown,
  result: Result<unknown>,
  application?: PullApplication,
): void {
  const entry: SyncLogEntry = {
    at: now,
    kind,
    request,
    result: result.ok ? { ok: true } : { ok: false, error: result.error, meta: result.meta },
    ...(application !== undefined ? { application } : {}),
  };
  appendSyncLogEntry(entry);
  if (!result.ok) {
    console.error(`[sync] ${kind} falló: ${result.error}`, entry);
    return;
  }
  if (application?.kind === 'retained') {
    console.info('[sync] pull aplicado sin stock ni saldos — lote(s) procesando', entry);
  }
}

/**
 * Retoma el lote en curso (mismo id, mismo conjunto de eventos — nunca se
 * recalcula en un reintento) o arma uno nuevo con todo lo pendiente del
 * outbox, en orden `createdAt`. `undefined` si no hay nada que enviar.
 */
async function buildOrResumeLot(
  now: string,
): Promise<{ lot: PushLot; events: OutboxEvent[] } | undefined> {
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
  const lot = buildPushLot(
    pending.map((event) => event.id),
    { id: newId(), now },
  );
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

  const batch = { deviceId: getDeviceId(), events: events.map(toBatchItem) };
  const result = await connector.pushBatch(batch, lot.id);
  logSyncAttempt('push', now, { idempotencyId: lot.id, ...batch }, result);
  if (result.ok) {
    await db.outbox.bulkPut(events.map(markSynced));
    clearCurrentPushLot();
    addAwaitingLot({ id: lot.id, sentAt: now, eventIds: lot.eventIds });
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

type PullOutcome = {
  application?: PullApplication;
  failure?: Failure;
  issues: LotIssue[];
  request: unknown;
};

/**
 * Ack recuperado (#98): el backend informó el lote en curso, así que lo
 * recibió aunque la respuesta del push se perdió. Mismo efecto que el ack:
 * eventos `synced`, lote a la lista de espera, nunca se reenvía.
 */
async function recoverLostAck(lot: AwaitingLot): Promise<void> {
  const events = (await db.outbox.bulkGet(lot.eventIds ?? [])).filter(
    (event): event is OutboxEvent => event !== undefined && event.status === 'pending',
  );
  await db.outbox.bulkPut(events.map(markSynced));
  clearCurrentPushLot();
  addAwaitingLot(lot);
}

/**
 * Un ciclo de **pull** (spec de #98): un solo `pullBatch` que pregunta por
 * los lotes en espera y por el lote en curso. Datos maestros y bloqueos se
 * aplican siempre; stock y saldo, con el valor del backend más los eventos
 * que todavía no refleja, o los locales si algún lote sigue `processing`
 * (en ese caso el cursor de clientes no avanza: el saldo viaja en el cliente).
 */
async function pullAndApply(
  connector: Connector,
  now: string,
  options: { full: boolean },
): Promise<PullOutcome> {
  const awaiting = getAwaitingLots();
  const currentLot = getCurrentPushLot();
  const productsCursor = getProductsCursor();
  const customersCursor = getCustomersCursor();
  const cursors = options.full
    ? {}
    : {
        ...(productsCursor !== undefined ? { products: productsCursor } : {}),
        ...(customersCursor !== undefined ? { customers: customersCursor } : {}),
      };

  const request = {
    deviceId: getDeviceId(),
    cursors,
    pendingLotIds: [
      ...awaiting.map((lot) => lot.id),
      ...(currentLot !== undefined ? [currentLot.id] : []),
    ],
  };
  const pullPromise = connector.pullBatch(request);
  // Solo la foto completa lleva tope de tiempo (mismo criterio que antes de #87).
  const pullResult = options.full
    ? await withTimeout(pullPromise, FULL_REFRESH_TIMEOUT_MS)
    : await pullPromise;
  if (!pullResult.ok) {
    return { failure: pullResult, issues: [], request };
  }

  const lots = classifyLots({ awaiting, currentLot, reported: pullResult.value.lots });
  if (lots.recoveredLot !== undefined) {
    await recoverLostAck(lots.recoveredLot);
  } else if (currentLot !== undefined && lots.currentLotNotReceived) {
    setCurrentPushLot(markLotNotReceived(currentLot, now));
  }
  updateAwaitingLots(lots.resolvedIds, lots.inProgress);

  const retain = lots.retainingLotIds.length > 0;
  const applied = await applyPull({
    full: options.full,
    result: pullResult.value,
    retain,
    queuedEventIds: lots.queuedEventIds,
    now,
  });
  if (!applied.ok) {
    return { failure: applied, issues: lots.issues, request };
  }
  if (applied.value.skipped.length > 0) {
    return {
      failure: err('sync/empty-snapshot', { tables: applied.value.skipped }) as Failure,
      issues: lots.issues,
      request,
    };
  }

  const { products, customers } = pullResult.value;
  if (products.nextCursor !== undefined) {
    setProductsCursor(products.nextCursor);
  }
  if (!retain && customers.nextCursor !== undefined) {
    setCustomersCursor(customers.nextCursor);
  }
  if (options.full || products.items.length > 0) {
    setCatalogRepository(await loadCatalogRepository());
  }
  if (options.full || customers.items.length > 0) {
    setCustomerRepository(await loadCustomerRepository());
  }
  if (options.full && !retain) {
    setLastFullSyncAt(now);
    fullRefreshDoneThisSession = true;
  }

  const application: PullApplication = retain
    ? { kind: 'retained', lotIds: lots.retainingLotIds }
    : applied.value.reappliedEvents > 0
      ? { kind: 'reapplied', events: applied.value.reappliedEvents }
      : { kind: 'applied' };
  return { application, issues: lots.issues, request };
}

/** Cola común de un ciclo de pull: conteos, aviso de issues y estado honesto (#53, adaptado a #87). */
async function finishPullCycle(now: string, outcome: PullOutcome): Promise<Result<void>> {
  setPendingOutboxCount(await db.outbox.where('status').equals('pending').count());
  setLocalCatalogCounts(await countLocalCatalog());
  await refreshStockSnapshot();
  setPushLotIssues(outcome.issues.length > 0 ? outcome.issues : null);
  if (outcome.issues.length > 0) {
    console.warn(
      '[sync] el backend reportó issues en un lote de push ya confirmado',
      outcome.issues,
    );
  }
  logSyncAttempt(
    'pull',
    now,
    outcome.request,
    outcome.failure ?? ok(undefined),
    outcome.application,
  );

  if (outcome.failure !== undefined) {
    setLastSyncFailure(outcome.failure);
    setSyncStatus('sync-error');
    return outcome.failure;
  }
  setLastSyncFailure(null);
  setLastPullApplication(outcome.application ?? null);

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
 * ni `runPullCycle` necesitan saber de dónde salió. Devuelve lo que devuelve
 * `run`, o `undefined` si el ciclo no corrió (pausado, cerrojo, sin red o sin config).
 */
async function withConnectorCycle<T>(
  run: (connector: Connector, now: string, config: SyncConfig) => Promise<T>,
): Promise<T | undefined> {
  if (syncPausedSignal.value) {
    return undefined;
  }
  const release = tryAcquireSyncLock();
  if (release === undefined) {
    return undefined;
  }
  try {
    if (!navigator.onLine) {
      setSyncStatus('offline');
      return undefined;
    }
    const configResult = loadSyncConfig();
    if (!configResult.ok || configResult.value.verifiedAt === undefined) {
      setSyncConfigured(false);
      return undefined;
    }
    setSyncConfigured(true);
    const connector = createConnector(configResult.value);
    return await run(connector, new Date().toISOString(), configResult.value);
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
/** Limpieza a 7 días (#98): nunca con `/CONFIG` abierto; el cerrojo lo toma ella misma. */
async function maybeRunCleanup(): Promise<void> {
  if (syncPausedSignal.value) {
    return;
  }
  await runCleanupIfDue({ now: new Date().toISOString(), acquireLock: tryAcquireSyncLock });
}

export async function runPullCycleNow(options: { full?: boolean } = {}): Promise<void> {
  const pulled = await withConnectorCycle(async (connector, now, config) => {
    const full =
      options.full === true ||
      isFullRefreshDue({
        mode: connectorPullMode(config.type),
        lastFullAt: getLastFullSyncAt(),
        now,
        doneThisSession: fullRefreshDoneThisSession,
      });
    const result = await runPullCycle(connector, now, { full });
    if (!full && pushLotIssuesSignal.value !== null) {
      await runPullCycle(connector, now, { full: true });
    }
    return result.ok;
  });
  // Después de soltar el cerrojo del pull: la limpieza lo toma por su cuenta.
  if (pulled === true) {
    await maybeRunCleanup();
  }
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
  // Al arrancar: la limpieza corre aunque no haya red (no depende del backend).
  void runPushThenPull().then(maybeRunCleanup);
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
