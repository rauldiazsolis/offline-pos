import { splitConnectorCustomers } from '../domain/customer.ts';
import {
  isDue,
  isSyncStruggling,
  markFailed,
  markSynced,
  type OutboxEvent,
} from '../domain/outbox.ts';
import { ok, type Failure, type Result } from '../domain/result.ts';
import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { db } from '../storage/db.ts';
import { countLocalCatalog } from '../storage/local-data.ts';
import { setCatalogRepository } from '../ui/state/catalog.ts';
import { setCustomerRepository } from '../ui/state/customer-repository.ts';
import {
  lastSyncFailureSignal,
  setLastSyncFailure,
  setLastSyncedAt,
  setLocalCatalogCounts,
  setPendingOutboxCount,
  setSyncConfigured,
  setSyncStatus,
  syncPausedSignal,
} from '../ui/state/sync.ts';
import type { Connector } from './connector.ts';
import { loadSyncConfig } from './config.ts';
import { createConnector } from './connector-registry.ts';
import {
  getCustomersCursor,
  getProductsCursor,
  setCustomersCursor,
  setProductsCursor,
} from './cursor.ts';

function pushOne(connector: Connector, event: OutboxEvent): Promise<Result<void>> {
  switch (event.type) {
    case 'sale':
      return connector.pushSale(event.sale, event.id);
    case 'stock-movement':
      return connector.pushStockMovement(event.movement, event.id);
    case 'sale-void':
      return connector.pushSaleVoid(
        {
          saleId: event.saleId,
          voidedAt: event.voidedAt,
          ...(event.voidReason !== undefined ? { voidReason: event.voidReason } : {}),
        },
        event.id,
      );
    case 'customer':
      return connector.pushCustomer(event.customer, event.id);
    case 'account-hold-confirm':
      return connector.pushAccountHoldConfirm(
        { holdId: event.holdId, saleId: event.saleId },
        event.id,
      );
    case 'account-hold-release':
      return connector.releaseAccountHold({ holdId: event.holdId }, event.id);
    case 'cash-session':
      return connector.pushCashSession(event.session, event.id);
    default: {
      const exhaustiveCheck: never = event;
      throw new Error(`Tipo de evento de outbox desconocido: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

export type PushSummary = { attempted: number; failed: number };

/**
 * Empuja el outbox pendiente en orden. `ignoreBackoff` saltea la ventana de
 * reintento (`isDue`): lo usa el envío final antes de borrar los datos al
 * cambiar de conexión (`sync/apply-connection.ts::flushPendingBeforeWipe`);
 * `now` sigue siendo la hora real, así un fallo calcula bien su próximo intento.
 */
export async function pushPendingEvents(
  connector: Connector,
  now: string,
  options: { ignoreBackoff?: boolean } = {},
): Promise<PushSummary> {
  const pending = await db.outbox.where('status').equals('pending').sortBy('createdAt');
  let attempted = 0;
  let failed = 0;

  for (const event of pending) {
    if (options.ignoreBackoff !== true && !isDue(event, now)) {
      continue;
    }
    attempted += 1;
    const result = await pushOne(connector, event);
    if (!result.ok) {
      failed += 1;
    }
    await db.outbox.put(
      result.ok ? markSynced(event) : markFailed(event, { now, error: result.error }),
    );
  }
  return { attempted, failed };
}

async function pullCatalog(
  connector: Connector,
): Promise<{ products: Result<void>; stock: Result<void> }> {
  const since = getProductsCursor();
  const productsResult = await connector.pullProducts(since !== undefined ? { since } : {});
  let products: Result<void>;
  if (productsResult.ok) {
    if (productsResult.value.items.length > 0) {
      await db.products.bulkPut(productsResult.value.items);
    }
    if (productsResult.value.nextCursor !== undefined) {
      setProductsCursor(productsResult.value.nextCursor);
    }
    // El catálogo pudo haber cambiado — Fase 1 lo indexaba una sola vez
    // asumiéndolo estático, acá se reconstruye a propósito.
    setCatalogRepository(await loadCatalogRepository());
    products = ok(undefined);
  } else {
    products = productsResult;
  }

  const stockResult = await connector.pullStock();
  let stock: Result<void>;
  if (stockResult.ok) {
    if (stockResult.value.length > 0) {
      await db.stock.bulkPut(stockResult.value);
    }
    stock = ok(undefined);
  } else {
    stock = stockResult;
  }
  return { products, stock };
}

/**
 * Pull de clientes por delta, mismo criterio que `pullCatalog`: cada fila
 * cruda se separa en `Customer`/`CustomerAccount` (`splitConnectorCustomers`)
 * antes de guardarse, así las dos tablas quedan siempre consistentes entre
 * sí incluso si un cliente todavía no tiene cuenta corriente.
 */
async function pullCustomers(connector: Connector): Promise<Result<void>> {
  const since = getCustomersCursor();
  const result = await connector.pullCustomers(since !== undefined ? { since } : {});
  if (!result.ok) {
    return result;
  }

  if (result.value.items.length > 0) {
    const { customers, accounts } = splitConnectorCustomers(result.value.items, {
      now: new Date().toISOString(),
    });
    await db.customers.bulkPut(customers);
    if (accounts.length > 0) {
      await db.customerAccounts.bulkPut(accounts);
    }
    setCustomerRepository(await loadCustomerRepository());
  }
  if (result.value.nextCursor !== undefined) {
    setCustomersCursor(result.value.nextCursor);
  }
  return ok(undefined);
}

export type SyncReport = {
  push: PushSummary;
  pulls: { products: Result<void>; stock: Result<void>; customers: Result<void> };
};

/**
 * Un ciclo de sync: push del outbox pendiente + pull de catálogo. Nunca
 * bloquea la UI — el caller (`runSyncCycle`) lo dispara en background.
 * No conoce config ni arma el `Connector`: eso es responsabilidad del
 * caller, así esta función se testea directo contra un `Connector` fake.
 *
 * Estado honesto (#53): un pull que falla ya no se traga en silencio — el
 * estado pasa a `sync-error`, el motivo queda en `lastSyncFailureSignal` y
 * `lastSyncedAt` solo se actualiza en un ciclo completamente exitoso.
 */
export async function syncOnce(connector: Connector, now: string): Promise<SyncReport> {
  setSyncStatus('syncing');

  const push = await pushPendingEvents(connector, now);
  const catalog = await pullCatalog(connector);
  const customers = await pullCustomers(connector);
  const report: SyncReport = {
    push,
    pulls: { products: catalog.products, stock: catalog.stock, customers },
  };

  const events = await db.outbox.toArray();
  const pendingCount = events.filter((event) => event.status === 'pending').length;
  setPendingOutboxCount(pendingCount);
  setLocalCatalogCounts(await countLocalCatalog());

  const firstFailure = [catalog.products, catalog.stock, customers].find(
    (result): result is Failure => !result.ok,
  );
  if (firstFailure !== undefined) {
    setLastSyncFailure(firstFailure);
    setSyncStatus('sync-error');
    return report;
  }
  setLastSyncFailure(null);

  if (isSyncStruggling(events)) {
    setSyncStatus('sync-error');
    return report;
  }
  setSyncStatus('online-idle');
  setLastSyncedAt(now);
  return report;
}

/**
 * Ciclo de **solo envío**: empuja el outbox pendiente sin traer catálogo, stock ni
 * clientes. Lo disparan los eventos nuevos del outbox (venta, anulación, cliente,
 * cierre de caja) y los reintentos: cuesta un request en vez de tres, y una venta
 * no espera al próximo ciclo completo. No toca `lastSyncedAt` ni los conteos del
 * catálogo (no los refrescó), y no borra una falla de pull sin resolver: mientras
 * esa siga, el estado sigue siendo `sync-error`.
 */
export async function pushOnce(connector: Connector, now: string): Promise<PushSummary> {
  setSyncStatus('syncing');

  const push = await pushPendingEvents(connector, now);

  const events = await db.outbox.toArray();
  setPendingOutboxCount(events.filter((event) => event.status === 'pending').length);
  setSyncStatus(
    lastSyncFailureSignal.value !== null || isSyncStruggling(events) ? 'sync-error' : 'online-idle',
  );
  return push;
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
export async function runSyncCycle(options: { pull?: boolean } = {}): Promise<void> {
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
    } else {
      await syncOnce(connector, now);
    }
  } finally {
    release();
  }
}

const SYNC_INTERVAL_MS = 15_000;

/**
 * Loop de sync mientras la pestaña está abierta (`setInterval` + evento
 * `online`) — NO la Background Sync API de Service Worker, eso es
 * explícitamente Fase 7 (PWA). Se llama una sola vez desde `ui/bootstrap.ts`.
 */
export function startSyncEngine(): void {
  void runSyncCycle();
  setInterval(() => {
    void runSyncCycle();
  }, SYNC_INTERVAL_MS);
  window.addEventListener('online', () => {
    void runSyncCycle();
  });
}
