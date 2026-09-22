import { splitConnectorCustomers } from '../domain/customer.ts';
import { markSynced, type OutboxEvent } from '../domain/outbox.ts';
import { buildPushLot, isLotDue, isPushStruggling, markLotFailed, type PushLot } from '../domain/push-lot.ts';
import { err, ok, type Failure, type Result } from '../domain/result.ts';
import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { db } from '../storage/db.ts';
import { newId } from '../storage/ids.ts';
import { countLocalCatalog } from '../storage/local-data.ts';
import { reconcileSnapshot } from '../storage/reconcile.ts';
import { setCatalogRepository } from '../ui/state/catalog.ts';
import { setCustomerRepository } from '../ui/state/customer-repository.ts';
import {
  lastSyncFailureSignal,
  setLastSyncFailure,
  setLastSyncedAt,
  setLocalCatalogCounts,
  setPendingOutboxCount,
  setPushLotIssues,
  setSyncConfigured,
  setSyncStatus,
  syncPausedSignal,
} from '../ui/state/sync.ts';
import type { Connector, OutboxBatchItem } from './connector.ts';
import { loadSyncConfig } from './config.ts';
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

  const pending = await db.outbox.where('status').equals('pending').sortBy('createdAt');
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

  const result = await connector.pushBatch(events.map(toBatchItem), lot.id);
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

type PullOutcome = { applied: boolean; failure?: Failure; issues: string[] };

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
  const cursors = options.full
    ? {}
    : {
        ...(getProductsCursor() !== undefined ? { products: getProductsCursor() } : {}),
        ...(getCustomersCursor() !== undefined ? { customers: getCustomersCursor() } : {}),
      };

  const pullPromise = connector.pullBatch({ cursors, pendingLotIds: awaiting.map((lot) => lot.id) });
  // Solo la foto completa lleva tope de tiempo (mismo criterio que antes de #87): un backend
  // colgado en un delta normal no justificaba la complejidad extra, la foto completa sí porque
  // puede tardar mucho más y correr menos seguido.
  const pullResult = options.full ? await withTimeout(pullPromise, FULL_REFRESH_TIMEOUT_MS) : await pullPromise;
  if (!pullResult.ok) {
    return { applied: false, failure: pullResult, issues: [] };
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
    return { applied: false, failure: err('sync/pending-lot', undefined) as Failure, issues };
  }

  if (options.full) {
    const snapshot = toProbeSnapshot(pullResult.value);
    const applied = await reconcileSnapshot(snapshot, { now });
    if (!applied.ok) {
      return { applied: false, failure: applied, issues };
    }
    if (applied.value.skipped.length > 0) {
      return {
        applied: false,
        failure: err('sync/empty-snapshot', { tables: applied.value.skipped }) as Failure,
        issues,
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
    return { applied: true, issues };
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
  return { applied: true, issues };
}

/** Cola común de un ciclo de pull: conteos, aviso de issues y estado honesto (#53, adaptado a #87). */
async function finishPullCycle(now: string, outcome: PullOutcome): Promise<Result<void>> {
  setPendingOutboxCount(await db.outbox.where('status').equals('pending').count());
  setLocalCatalogCounts(await countLocalCatalog());
  setPushLotIssues(outcome.issues.length > 0 ? outcome.issues : null);

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
 * Es responsabilidad de la app no saturar a la API: si un push tarda más
 * que el intervalo del loop (una API lenta de verdad), el próximo disparo
 * (`setInterval`, evento `online`, o `/SINCRONIZAR`) no debe arrancar un
 * segundo ciclo en paralelo — ver issue #1. La bandera se lee/escribe de
 * forma síncrona (`tryAcquireSyncLock`, primera línea de `runSyncCycle`),
 * antes de cualquier `await`, así una llamada reentrante la ve actualizada
 * sin importar en qué punto del ciclo anterior ocurra. Desde la Etapa 2b es
 * también el cerrojo de `sync/apply-connection.ts`: aplicar una conexión no
 * puede intercalarse con un ciclo.
 */
let syncInProgress = false;

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
 * Arma el `Connector` real desde la config guardada y corre un ciclo. Acá
 * viven los chequeos de entorno (¿hay red? ¿hay una conexión activa?) que
 * `syncOnce` no conoce a propósito — así queda testeable de forma aislada.
 * Una config sin probar (`verifiedAt` ausente) no sincroniza: la app pide
 * probarla antes de operar (Etapa 2b).
 */
export async function runSyncCycle(
  options: { pull?: boolean; full?: boolean } = {},
): Promise<void> {
  // `/CONFIG` abierto: no arrancar ciclos (ver `syncPausedSignal`).
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
    const now = new Date().toISOString();
    if (options.pull === false) {
      await pushOnce(connector, now);
    } else if (
      isFullRefreshDue({
        mode: connectorPullMode(configResult.value.type),
        lastFullAt: getLastFullSyncAt(),
        now,
        doneThisSession: fullRefreshDoneThisSession,
        forced: options.full === true,
      })
    ) {
      await syncFull(connector, now);
    } else {
      await syncOnce(connector, now);
    }
    await scheduleNextRetry();
  } finally {
    release();
  }
}

/** Ciclo completo (envío + pull) de red de seguridad: el resto lo disparan los eventos. */
export const SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** Espera antes de un envío disparado por un evento: agrupa los que llegan seguidos. */
export const SYNC_DEBOUNCE_MS = 2_000;
const MIN_RETRY_TIMER_MS = 1_000;
const MAX_RETRY_TIMER_MS = 5 * 60 * 1000;

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pushDueAt = 0;

/**
 * Agenda un ciclo de solo envío. Si ya hay uno agendado más cerca, lo conserva
 * (varios eventos seguidos comparten un envío, y un evento nunca demora un
 * reintento); si el nuevo es más cercano, lo adelanta.
 */
export function requestPushSoon(delayMs: number = SYNC_DEBOUNCE_MS): void {
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
    void runSyncCycle({ pull: false });
  }, delayMs);
}

/** Cancela el envío agendado (al detener el motor y en los tests). */
export function cancelScheduledPush(): void {
  if (pushTimer !== undefined) {
    clearTimeout(pushTimer);
    pushTimer = undefined;
  }
}

/**
 * Agenda un envío para cuando venza el backoff del evento pendiente más próximo:
 * con un ciclo completo cada 5 minutos, los reintentos de 2, 4, 8… segundos no
 * pueden depender del tick del intervalo.
 */
async function scheduleNextRetry(): Promise<void> {
  const pending = await db.outbox.where('status').equals('pending').toArray();
  if (pending.length === 0) {
    return;
  }
  const soonest = Math.min(...pending.map((event) => new Date(event.nextAttemptAt).getTime()));
  requestPushSoon(Math.min(Math.max(soonest - Date.now(), MIN_RETRY_TIMER_MS), MAX_RETRY_TIMER_MS));
}

/**
 * Motor de sync mientras la pestaña está abierta — NO la Background Sync API de
 * Service Worker, eso es explícitamente Fase 7 (PWA). Se llama una sola vez desde
 * `ui/bootstrap.ts`. Tres disparadores:
 * - un ciclo **completo** al arrancar, al volver la red y cada `SYNC_INTERVAL_MS`;
 * - un ciclo de **solo envío** por cada evento nuevo en `outbox` (venta, anulación,
 *   cliente, cierre de caja, fiado) — el hook de Dexie cubre todos los caminos que
 *   encolan sin que cada controlador tenga que acordarse;
 * - un ciclo de solo envío al vencer el backoff de un evento fallido.
 * Devuelve la función que lo detiene (tests).
 */
export function startSyncEngine(): () => void {
  resetFullRefreshSession();
  void runSyncCycle();
  const interval = setInterval(() => {
    void runSyncCycle();
  }, SYNC_INTERVAL_MS);
  const onOnline = (): void => {
    void runSyncCycle();
  };
  window.addEventListener('online', onOnline);
  const onOutboxEvent = (): void => {
    requestPushSoon();
  };
  db.outbox.hook('creating', onOutboxEvent);

  return () => {
    clearInterval(interval);
    window.removeEventListener('online', onOnline);
    db.outbox.hook('creating').unsubscribe(onOutboxEvent);
    cancelScheduledPush();
  };
}
