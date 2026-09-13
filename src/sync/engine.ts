import {
  isDue,
  isSyncStruggling,
  markFailed,
  markSynced,
  type OutboxEvent,
} from '../domain/outbox.ts';
import type { Result } from '../domain/result.ts';
import { createRestFetchConnector } from '../connectors/rest-fetch-connector.ts';
import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { db } from '../storage/db.ts';
import { setCatalogRepository } from '../ui/state/catalog.ts';
import {
  setLastSyncedAt,
  setPendingOutboxCount,
  setSyncConfigured,
  setSyncStatus,
} from '../ui/state/sync.ts';
import type { Connector } from './connector.ts';
import { loadSyncConfig } from './config.ts';
import { getProductsCursor, setProductsCursor } from './cursor.ts';

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
 * Un ciclo de sync: push del outbox pendiente + pull de catálogo. Nunca
 * bloquea la UI — el caller (`runSyncCycle`) lo dispara en background.
 * No conoce config ni arma el `Connector`: eso es responsabilidad del
 * caller, así esta función se testea directo contra un `Connector` fake.
 */
export async function syncOnce(connector: Connector, now: string): Promise<void> {
  setSyncStatus('syncing');

  await pushPending(connector, now);
  await pullCatalog(connector);

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
 * Arma el `Connector` real desde la config guardada y corre un ciclo. Acá
 * viven los chequeos de entorno (¿hay red? ¿hay config?) que `syncOnce` no
 * conoce a propósito — así queda testeable de forma aislada.
 */
export async function runSyncCycle(): Promise<void> {
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
