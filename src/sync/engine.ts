import { splitConnectorCustomer } from '../domain/customer.ts';
import {
  isDue,
  isSyncStruggling,
  markFailed,
  markSynced,
  type OutboxEvent,
} from '../domain/outbox.ts';
import type { Result } from '../domain/result.ts';
import { createRestFetchConnector } from '../connectors/rest/rest-fetch-connector.ts';
import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { db } from '../storage/db.ts';
import { setCatalogRepository } from '../ui/state/catalog.ts';
import { setCustomerRepository } from '../ui/state/customer-repository.ts';
import {
  setLastSyncedAt,
  setPendingOutboxCount,
  setSyncConfigured,
  setSyncStatus,
} from '../ui/state/sync.ts';
import type { Connector } from './connector.ts';
import { loadSyncConfig } from './config.ts';
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

async function pushPending(connector: Connector, now: string): Promise<void> {
  const pending = await db.outbox.where('status').equals('pending').sortBy('createdAt');

  for (const event of pending) {
    if (!isDue(event, now)) {
      continue;
    }
    const result = await pushOne(connector, event);
    await db.outbox.put(
      result.ok ? markSynced(event) : markFailed(event, { now, error: result.error }),
    );
  }
}

async function pullCatalog(connector: Connector): Promise<void> {
  const since = getProductsCursor();
  const productsResult = await connector.pullProducts(since !== undefined ? { since } : {});
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
  }

  const stockResult = await connector.pullStock();
  if (stockResult.ok && stockResult.value.length > 0) {
    await db.stock.bulkPut(stockResult.value);
  }
}

/**
 * Pull de clientes por delta, mismo criterio que `pullCatalog`: cada fila
 * cruda se separa en `Customer`/`CustomerAccount` (`splitConnectorCustomer`)
 * antes de guardarse, así las dos tablas quedan siempre consistentes entre
 * sí incluso si un cliente todavía no tiene cuenta corriente.
 */
async function pullCustomers(connector: Connector): Promise<void> {
  const since = getCustomersCursor();
  const result = await connector.pullCustomers(since !== undefined ? { since } : {});
  if (!result.ok) {
    return;
  }

  if (result.value.items.length > 0) {
    const now = new Date().toISOString();
    const customers = [];
    const accounts = [];
    for (const raw of result.value.items) {
      const split = splitConnectorCustomer(raw, { now });
      customers.push(split.customer);
      if (split.account !== undefined) {
        accounts.push(split.account);
      }
    }
    await db.customers.bulkPut(customers);
    if (accounts.length > 0) {
      await db.customerAccounts.bulkPut(accounts);
    }
    setCustomerRepository(await loadCustomerRepository());
  }
  if (result.value.nextCursor !== undefined) {
    setCustomersCursor(result.value.nextCursor);
  }
}

/**
 * Un ciclo de sync: push del outbox pendiente + pull de catálogo. Nunca
 * bloquea la UI — el caller (`runSyncCycle`) lo dispara en background.
 * No conoce config ni arma el `Connector`: eso es responsabilidad del
 * caller, así esta función se testea directo contra un `Connector` fake.
 */
export async function syncOnce(connector: Connector, now: string): Promise<void> {
  setSyncStatus('syncing');

  await pushPending(connector, now);
  await pullCatalog(connector);
  await pullCustomers(connector);

  const events = await db.outbox.toArray();
  const pendingCount = events.filter((event) => event.status === 'pending').length;
  setPendingOutboxCount(pendingCount);

  if (isSyncStruggling(events)) {
    setSyncStatus('sync-error');
    return;
  }
  setSyncStatus('online-idle');
  setLastSyncedAt(now);
}

/**
 * Es responsabilidad de la app no saturar a la API: si un push tarda más
 * que el intervalo del loop (una API lenta de verdad), el próximo disparo
 * (`setInterval`, evento `online`, o `/SINCRONIZAR`) no debe arrancar un
 * segundo ciclo en paralelo — ver issue #1. La bandera se lee/escribe de
 * forma síncrona como primera línea de `runSyncCycle`, antes de cualquier
 * `await`, así una llamada reentrante la ve actualizada sin importar en qué
 * punto del ciclo anterior ocurra.
 */
let syncInProgress = false;

/**
 * Arma el `Connector` real desde la config guardada y corre un ciclo. Acá
 * viven los chequeos de entorno (¿hay red? ¿hay config?) que `syncOnce` no
 * conoce a propósito — así queda testeable de forma aislada.
 */
export async function runSyncCycle(): Promise<void> {
  if (syncInProgress) {
    return;
  }
  syncInProgress = true;

  try {
    if (!navigator.onLine) {
      setSyncStatus('offline');
      return;
    }

    const configResult = loadSyncConfig();
    if (!configResult.ok) {
      setSyncConfigured(false);
      return;
    }
    setSyncConfigured(true);

    const connector = createRestFetchConnector(configResult.value);
    await syncOnce(connector, new Date().toISOString());
  } finally {
    syncInProgress = false;
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
