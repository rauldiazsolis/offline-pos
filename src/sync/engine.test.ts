import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '../domain/result.ts';
import { markLotFailed as markLotFailedForTest, buildPushLot } from '../domain/push-lot.ts';
import { db } from '../storage/db.ts';
import { fakeConnector } from '../test/fake-connector.ts';
import { setCatalogRepository } from '../ui/state/catalog.ts';
import {
  lastSyncFailureSignal,
  lastSyncedAtSignal,
  localCatalogCountsSignal,
  pushLotIssuesSignal,
  setSyncPaused,
  syncConfiguredSignal,
  syncLogSignal,
  syncStatusSignal,
} from '../ui/state/sync.ts';
import { saveSyncConfig } from './config.ts';
import {
  getCustomersCursor,
  getLastFullSyncAt,
  getProductsCursor,
  setProductsCursor,
} from './cursor.ts';
import {
  acquireSyncLockWaiting,
  cancelScheduledPull,
  cancelScheduledPush,
  PULL_SAFETY_NET_INTERVAL_MS,
  PUSH_INTERVAL_MS,
  pushPendingLot,
  requestPushSoon,
  resetFullRefreshSession,
  runPullCycle,
  runPullCycleNow,
  runPushCycle,
  startSyncEngine,
  syncNow,
  toBatchItem,
  tryAcquireSyncLock,
} from './engine.ts';
import {
  addAwaitingLot,
  getAwaitingLots,
  getCurrentPushLot,
  setCurrentPushLot,
} from './push-lot.ts';
import type { Product } from '../domain/product.ts';
import type { Sale } from '../domain/sale.ts';
import type { StockItem } from '../domain/stock.ts';

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

const now = '2026-01-01T00:00:00.000Z';

beforeEach(async () => {
  await db.open();
  setCatalogRepository({
    search: () => [],
    findByBarcodeOrSku: () => undefined,
    getProduct: () => undefined,
    getStock: () => Promise.resolve(undefined),
  });
});

afterEach(async () => {
  cancelScheduledPush(); // un reintento agendado no puede sobrevivir a la base del test
  db.close();
  await db.delete();
  localStorage.clear();
  setOnline(true);
  syncLogSignal.value = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sale: Sale = {
  id: 'sale-1',
  lines: [],
  payments: [],
  total: 0,
  status: 'closed',
  createdAt: now,
};

describe('pushPendingLot', () => {
  it('sin eventos pendientes no llama a pushBatch', async () => {
    const pushBatch = vi.fn();
    const summary = await pushPendingLot(fakeConnector({ pushBatch }), now);
    expect(summary).toEqual({ attempted: 0, failed: false });
    expect(pushBatch).not.toHaveBeenCalled();
  });

  it('manda todos los eventos pendientes en un solo lote, en orden por createdAt', async () => {
    await db.outbox.bulkAdd([
      {
        type: 'sale',
        sale: { ...sale, id: 'second' },
        id: 'second',
        status: 'pending',
        createdAt: '2026-01-01T00:00:02.000Z',
      },
      {
        type: 'sale',
        sale: { ...sale, id: 'first' },
        id: 'first',
        status: 'pending',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    ]);
    const pushBatch = vi.fn().mockResolvedValue(ok(undefined));

    const summary = await pushPendingLot(fakeConnector({ pushBatch }), now);

    expect(summary).toEqual({ attempted: 2, failed: false });
    expect(pushBatch).toHaveBeenCalledTimes(1);
    const [items] = pushBatch.mock.calls[0] as [unknown[], string];
    expect(items.map((item) => (item as { id: string }).id)).toEqual(['first', 'second']);
  });

  it('marca todos los eventos del lote como synced tras un ack exitoso, y limpia el lote en curso', async () => {
    await db.outbox.add({ type: 'sale', sale, id: 'sale-1', status: 'pending', createdAt: now });

    await pushPendingLot(fakeConnector({ pushBatch: () => Promise.resolve(ok(undefined)) }), now);

    expect((await db.outbox.get('sale-1'))?.status).toBe('synced');
    expect(getCurrentPushLot()).toBeUndefined();
  });

  it('un push exitoso queda en el log de sync, sin tocar la consola (para /DIAGNOSTICO)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await db.outbox.add({ type: 'sale', sale, id: 'sale-1', status: 'pending', createdAt: now });

    await pushPendingLot(fakeConnector({ pushBatch: () => Promise.resolve(ok(undefined)) }), now);

    const lotId = getAwaitingLots()[0]?.id;
    expect(syncLogSignal.value).toHaveLength(1);
    expect(syncLogSignal.value[0]).toEqual({
      at: now,
      kind: 'push',
      request: { idempotencyId: lotId, events: [{ type: 'sale', sale, id: 'sale-1' }] },
      result: { ok: true },
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('tras el ack, agrega el lote a la lista de espera de resolución', async () => {
    await db.outbox.add({ type: 'sale', sale, id: 'sale-1', status: 'pending', createdAt: now });

    await pushPendingLot(fakeConnector({ pushBatch: () => Promise.resolve(ok(undefined)) }), now);

    expect(getAwaitingLots()).toHaveLength(1);
  });

  it('un fallo de red deja los eventos pending y guarda el lote con backoff, sin agregarlo a la espera', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await db.outbox.add({ type: 'sale', sale, id: 'sale-1', status: 'pending', createdAt: now });
    const pushBatch = vi.fn().mockResolvedValue(err('sync/request-failed', { message: 'boom' }));

    const summary = await pushPendingLot(fakeConnector({ pushBatch }), now);

    expect(summary).toEqual({ attempted: 1, failed: true });
    expect((await db.outbox.get('sale-1'))?.status).toBe('pending');
    expect(getCurrentPushLot()?.retries).toBe(1);
    expect(getAwaitingLots()).toEqual([]);
    expect(syncLogSignal.value).toHaveLength(1);
    expect(syncLogSignal.value[0]?.result).toEqual({
      ok: false,
      error: 'sync/request-failed',
      meta: { message: 'boom' },
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('respeta el backoff del lote: no reintenta antes de tiempo salvo ignoreBackoff', async () => {
    await db.outbox.add({ type: 'sale', sale, id: 'sale-1', status: 'pending', createdAt: now });
    setCurrentPushLot(
      markLotFailedForTest(buildPushLot(['sale-1'], { id: 'lot-1', now }), { now, error: 'x' }),
    );
    const pushBatch = vi.fn().mockResolvedValue(ok(undefined));

    const withoutFlag = await pushPendingLot(fakeConnector({ pushBatch }), now);
    expect(withoutFlag).toEqual({ attempted: 0, failed: false });
    expect(pushBatch).not.toHaveBeenCalled();

    const withFlag = await pushPendingLot(fakeConnector({ pushBatch }), now, {
      ignoreBackoff: true,
    });
    expect(withFlag).toEqual({ attempted: 1, failed: false });
  });

  it('un reintento del mismo lote reusa el mismo idempotencyId y el mismo conjunto de eventos, aunque haya eventos nuevos en el outbox', async () => {
    await db.outbox.add({ type: 'sale', sale, id: 'sale-1', status: 'pending', createdAt: now });
    const pushBatch = vi
      .fn()
      .mockResolvedValueOnce(err('sync/request-failed', { message: 'boom' }));
    await pushPendingLot(fakeConnector({ pushBatch }), now, { ignoreBackoff: true });
    const lotIdAfterFailure = getCurrentPushLot()?.id;

    // Llega un evento nuevo mientras el lote sigue en vuelo (todavía no se reintentó).
    await db.outbox.add({
      type: 'sale',
      sale: { ...sale, id: 'sale-2' },
      id: 'sale-2',
      status: 'pending',
      createdAt: now,
    });
    const pushBatchRetry = vi.fn().mockResolvedValue(ok(undefined));

    await pushPendingLot(fakeConnector({ pushBatch: pushBatchRetry }), now, {
      ignoreBackoff: true,
    });

    const [items, idempotencyId] = pushBatchRetry.mock.calls[0] as [unknown[], string];
    expect(idempotencyId).toBe(lotIdAfterFailure); // mismo id congelado, no uno nuevo
    expect(items.map((item) => (item as { id: string }).id)).toEqual(['sale-1']); // sale-2 queda para el próximo lote
  });
});

// pushOne por tipo de evento: cubierto ahora por toBatchItem — un test por variante, directo.
describe('toBatchItem', () => {
  it.each([
    [
      { type: 'sale' as const, sale, id: 'sale-1', status: 'pending' as const, createdAt: now },
      { type: 'sale', sale, id: 'sale-1' },
    ],
    [
      {
        type: 'stock-movement' as const,
        movement: {
          id: 'm1',
          productId: 'p1',
          delta: -1,
          reason: 'sale' as const,
          saleId: 'sale-1',
          createdAt: now,
        },
        id: 'm1',
        status: 'pending' as const,
        createdAt: now,
      },
      {
        type: 'stock-movement',
        movement: {
          id: 'm1',
          productId: 'p1',
          delta: -1,
          reason: 'sale',
          saleId: 'sale-1',
          createdAt: now,
        },
        id: 'm1',
      },
    ],
    [
      {
        type: 'sale-void' as const,
        saleId: 'sale-1',
        voidedAt: now,
        voidReason: 'error',
        id: 'void-1',
        status: 'pending' as const,
        createdAt: now,
      },
      { type: 'sale-void', saleId: 'sale-1', voidedAt: now, voidReason: 'error', id: 'void-1' },
    ],
    [
      {
        type: 'customer' as const,
        customer: { id: 'c1', name: 'Juan Pérez', createdAt: now },
        id: 'c1',
        status: 'pending' as const,
        createdAt: now,
      },
      { type: 'customer', customer: { id: 'c1', name: 'Juan Pérez', createdAt: now }, id: 'c1' },
    ],
    [
      {
        type: 'account-hold-confirm' as const,
        holdId: 'hold-1',
        saleId: 'sale-1',
        id: 'confirm-1',
        status: 'pending' as const,
        createdAt: now,
      },
      { type: 'account-hold-confirm', holdId: 'hold-1', saleId: 'sale-1', id: 'confirm-1' },
    ],
    [
      {
        type: 'account-hold-release' as const,
        holdId: 'hold-1',
        id: 'release-1',
        status: 'pending' as const,
        createdAt: now,
      },
      { type: 'account-hold-release', holdId: 'hold-1', id: 'release-1' },
    ],
    [
      {
        type: 'cash-session' as const,
        session: { id: 'cs1', openedAt: now, openingAmount: 500, sales: ['s1'] },
        id: 'cs1',
        status: 'pending' as const,
        createdAt: now,
      },
      {
        type: 'cash-session',
        session: { id: 'cs1', openedAt: now, openingAmount: 500, sales: ['s1'] },
        id: 'cs1',
      },
    ],
  ])('convierte %o a %o, sin status ni createdAt', (event, expected) => {
    expect(toBatchItem(event)).toEqual(expected);
  });
});

describe('runPullCycle — delta', () => {
  const product: Product = {
    id: 'p1',
    sku: 'SKU-1',
    barcodes: [],
    name: 'Arroz 1kg',
    price: 100,
    taxRate: 0.21,
    category: 'almacen',
    tracksStock: true,
  };

  it('guarda los productos nuevos y avanza el cursor', async () => {
    const pullBatch = vi.fn().mockResolvedValue(
      ok({
        products: { items: [product], nextCursor: 'cursor-2' },
        customers: { items: [] },
        stock: [],
        lots: {},
      }),
    );

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect((await db.products.get('p1'))?.name).toBe('Arroz 1kg');
    expect(getProductsCursor()).toBe('cursor-2');
  });

  it('manda el cursor guardado como parte de cursors en el próximo ciclo', async () => {
    const pullBatch = vi.fn().mockResolvedValue(
      ok({
        products: { items: [product], nextCursor: 'cursor-2' },
        customers: { items: [] },
        stock: [],
        lots: {},
      }),
    );
    await runPullCycle(fakeConnector({ pullBatch }), now);

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(pullBatch).toHaveBeenLastCalledWith({
      cursors: { products: 'cursor-2' },
      pendingLotIds: [],
    });
  });

  it('actualiza el stock recibido', async () => {
    const stockItem: StockItem = { productId: 'p1', quantity: 7, updatedAt: now };
    const pullBatch = vi
      .fn()
      .mockResolvedValue(
        ok({ products: { items: [] }, customers: { items: [] }, stock: [stockItem], lots: {} }),
      );

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect((await db.stock.get('p1'))?.quantity).toBe(7);
  });

  it('si el pull falla: pasa a sync-error, guarda el motivo y no marca la sync como exitosa', async () => {
    lastSyncedAtSignal.value = null;
    const failure = err('sync/request-failed', { status: 401, message: 'x' });
    const pullBatch = vi.fn().mockResolvedValue(failure);

    const report = await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(report.ok).toBe(false);
    expect(syncStatusSignal.value).toBe('sync-error');
    expect(lastSyncFailureSignal.value).toEqual(failure);
    expect(lastSyncedAtSignal.value).toBeNull();
  });

  it('guarda customer y customerAccount, y avanza el cursor de clientes', async () => {
    const rawCustomer = {
      id: 'c1',
      name: 'Juan Pérez',
      creditLimit: 1000,
      margin: 0,
      balance: 100,
    };
    const pullBatch = vi.fn().mockResolvedValue(
      ok({
        products: { items: [] },
        customers: { items: [rawCustomer], nextCursor: 'cur-c' },
        stock: [],
        lots: {},
      }),
    );

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect((await db.customers.get('c1'))?.name).toBe('Juan Pérez');
    expect((await db.customerAccounts.get('c1'))?.balance).toBe(100);
    expect(getCustomersCursor()).toBe('cur-c');
  });

  it('un cliente sin datos de cuenta no crea fila en customerAccounts', async () => {
    const pullBatch = vi.fn().mockResolvedValue(
      ok({
        products: { items: [] },
        customers: { items: [{ id: 'c2', name: 'Sin cuenta' }] },
        stock: [],
        lots: {},
      }),
    );

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(await db.customerAccounts.get('c2')).toBeUndefined();
  });

  it('tras un ciclo exitoso limpia el motivo del fallo y guarda lo que hay en la base local', async () => {
    await db.products.put({
      id: 'p1',
      sku: 'S1',
      barcodes: [],
      name: 'Arroz',
      price: 100,
      taxRate: 0.21,
      category: 'x',
      tracksStock: false,
    });
    await runPullCycle(
      fakeConnector({
        pullBatch: () => Promise.resolve(err('sync/request-failed', { message: 'down' })),
      }),
      now,
    );
    expect(lastSyncFailureSignal.value).not.toBeNull();

    const report = await runPullCycle(fakeConnector(), now);

    expect(report.ok).toBe(true);
    expect(lastSyncFailureSignal.value).toBeNull();
    expect(localCatalogCountsSignal.value).toEqual({ products: 1, customers: 0 });
    expect(lastSyncedAtSignal.value).toBe(now);
  });
});

describe('runPullCycle — gateado por lotes de push pendientes', () => {
  it('si un lote que nos interesa sigue pending, no aplica el pull y no toca el catálogo local', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    addAwaitingLot({ id: 'lot-1', sentAt: now });
    await db.products.put({
      id: 'p1',
      sku: 'S1',
      barcodes: [],
      name: 'Viejo',
      price: 1,
      taxRate: 0,
      category: 'x',
      tracksStock: false,
    });
    const pullBatch = vi.fn().mockResolvedValue(
      ok({
        products: {
          items: [
            {
              id: 'p1',
              sku: 'S1',
              barcodes: [],
              name: 'Nuevo',
              price: 999,
              taxRate: 0,
              category: 'x',
              tracksStock: false,
            },
          ],
        },
        customers: { items: [] },
        stock: [],
        lots: { 'lot-1': { status: 'pending' } },
      }),
    );

    const report = await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(report).toEqual({ ok: false, error: 'sync/pending-lot', meta: undefined });
    expect((await db.products.get('p1'))?.name).toBe('Viejo'); // no se aplicó nada
    expect(getAwaitingLots()).toEqual([{ id: 'lot-1', sentAt: now }]); // sigue esperando
    // El descarte por lote pendiente es el comportamiento esperado del diseño, no un error real —
    // console.info (para debuguear), nunca console.error.
    expect(syncLogSignal.value[0]?.result).toEqual({
      ok: false,
      error: 'sync/pending-lot',
      meta: undefined,
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('si el backend no informa nada sobre un lote que esperamos, se trata como todavía pending', async () => {
    addAwaitingLot({ id: 'lot-1', sentAt: now });
    const pullBatch = vi
      .fn()
      .mockResolvedValue(
        ok({ products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }),
      );

    const report = await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(report.ok).toBe(false);
    expect(getAwaitingLots()).toEqual([{ id: 'lot-1', sentAt: now }]);
  });

  it('un lote resuelto ok se saca de la lista de espera y el pull se aplica normalmente', async () => {
    addAwaitingLot({ id: 'lot-1', sentAt: now });
    const pullBatch = vi.fn().mockResolvedValue(
      ok({
        products: { items: [] },
        customers: { items: [] },
        stock: [],
        lots: { 'lot-1': { status: 'ok' } },
      }),
    );

    const report = await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(report.ok).toBe(true);
    expect(getAwaitingLots()).toEqual([]);
  });

  it('un lote resuelto con issues se saca de la espera, el pull igual se aplica, y se avisa vía pushLotIssuesSignal', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    addAwaitingLot({ id: 'lot-1', sentAt: now });
    const pullBatch = vi.fn().mockResolvedValue(
      ok({
        products: { items: [] },
        customers: { items: [] },
        stock: [],
        lots: { 'lot-1': { status: 'issues', issues: ['stock insuficiente en p1'] } },
      }),
    );

    const report = await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(report.ok).toBe(true);
    expect(getAwaitingLots()).toEqual([]);
    expect(pushLotIssuesSignal.value).toEqual(['stock insuficiente en p1']);
    // Informativo, no bloquea nada (el POS nunca se autobloquea) — igual vale un console.warn.
    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), ['stock insuficiente en p1']);
  });

  it('un pull exitoso sin issues queda en el log sin tocar la consola', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await runPullCycle(fakeConnector(), now);

    const lastEntry = syncLogSignal.value[0];
    expect(lastEntry).toEqual({
      at: now,
      kind: 'pull',
      request: { cursors: {}, pendingLotIds: [] },
      result: { ok: true },
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('un fallo de red en el pull queda en el log y hace console.error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pullBatch = vi
      .fn()
      .mockResolvedValue(err('sync/remote-error', { message: 'Planilla ocupada' }));

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(syncLogSignal.value[0]?.result).toEqual({
      ok: false,
      error: 'sync/remote-error',
      meta: { message: 'Planilla ocupada' },
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('sin lotes en espera, pullBatch se llama con pendingLotIds vacío y el pull se aplica directo', async () => {
    const pullBatch = vi
      .fn()
      .mockResolvedValue(
        ok({ products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }),
      );

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(pullBatch).toHaveBeenCalledWith({ cursors: {}, pendingLotIds: [] });
  });
});

describe('runPullCycle — foto completa y reconciliación de bajas', () => {
  function catalogProduct(id: string): Product {
    return {
      id,
      sku: `SKU-${id}`,
      barcodes: [],
      name: `Producto ${id}`,
      price: 100,
      taxRate: 0.21,
      category: 'x',
      tracksStock: false,
    };
  }

  it('con full:true no manda cursores y reconcilia bajas', async () => {
    await db.products.bulkPut([catalogProduct('p1'), catalogProduct('p2')]);
    const pullBatch = vi.fn().mockResolvedValue(
      ok({
        products: { items: [catalogProduct('p1')], nextCursor: 'cur-p' },
        customers: { items: [], nextCursor: 'cur-c' },
        stock: [],
        lots: {},
      }),
    );

    await runPullCycle(fakeConnector({ pullBatch }), now, { full: true });

    expect(pullBatch).toHaveBeenCalledWith({ cursors: {}, pendingLotIds: [] });
    expect(await db.products.toCollection().primaryKeys()).toEqual(['p1']);
    expect(getProductsCursor()).toBe('cur-p');
    expect(getCustomersCursor()).toBe('cur-c');
  });

  it('si una parte llega vacía habiendo datos locales, no se borra nada y avisa sync/empty-snapshot', async () => {
    await db.products.bulkPut([catalogProduct('p1')]);
    const pullBatch = vi
      .fn()
      .mockResolvedValue(
        ok({ products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }),
      );

    const report = await runPullCycle(fakeConnector({ pullBatch }), now, { full: true });

    expect(report).toMatchObject({ ok: false, error: 'sync/empty-snapshot' });
    expect(await db.products.toCollection().primaryKeys()).toEqual(['p1']);
  });
});

describe('runPushCycle', () => {
  it('sin red, marca offline y no llama a fetch', async () => {
    setOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runPushCycle();

    expect(syncStatusSignal.value).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con la sincronización pausada no corre ni llama a fetch', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setSyncPaused(true);

    try {
      await runPushCycle();
    } finally {
      setSyncPaused(false);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin config guardada, marca syncConfigured en false', async () => {
    await runPushCycle();
    expect(syncConfiguredSignal.value).toBe(false);
  });

  it('con config sin verifiedAt (sin probar) no corre ni llama a fetch', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runPushCycle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncConfiguredSignal.value).toBe(false);
  });

  // Los siguientes dos tests arman el conector real desde la config guardada — dependen de que
  // `connectors/rest/rest-fetch-connector.ts` ya hable el contrato batch (Task 14 del plan de
  // Etapa 1). Quedan en `it.skip` hasta esa tarea, donde se verifican y se sacan del skip.
  it('con eventos pendientes, manda un solo POST batch', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    await db.outbox.add(pendingSaleEvent());
    const calls = stubRestFetch();

    await runPushCycle();

    expect(calls).toEqual(['POST /sync/push']);
  });

  it('no arranca un segundo push si el anterior sigue en curso', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    await db.outbox.add(pendingSaleEvent());
    let callCount = 0;
    let resolveFirst: (response: Response) => void = () => {
      throw new Error('no asignado');
    };
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({}),
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = runPushCycle();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await runPushCycle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirst({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({}),
    } as Response);
    await first;
  });
});

describe('runPullCycleNow', () => {
  // Dependen del conector REST real (Task 14) — ver nota en `describe('runPushCycle', ...)`.
  it('con config guardada, arma el conector real y corre un pull', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () =>
            Promise.resolve({
              products: { items: [] },
              customers: { items: [] },
              stock: [],
              lots: {},
            }),
        } as Response),
      ),
    );

    await runPullCycleNow();

    expect(syncConfiguredSignal.value).toBe(true);
    expect(syncStatusSignal.value).toBe('online-idle');
  });

  it('la primera vez de la sesión es una foto completa: sin cursores en el body', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(init?.body as string));
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () =>
            Promise.resolve({
              products: { items: [], nextCursor: 'cur-p' },
              customers: { items: [], nextCursor: 'cur-c' },
              stock: [],
              lots: {},
            }),
        } as Response);
      }),
    );

    await runPullCycleNow();

    expect(bodies).toEqual([{ cursors: {}, pendingLotIds: [] }]);
  });

  it('si un delta resuelve un lote con issues, encadena una foto completa ya (cadencia de #87)', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    resetFullRefreshSession();
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string) as { cursors: Record<string, string> };
        bodies.push(body);
        const hasCursor = Object.keys(body.cursors).length > 0;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () =>
            Promise.resolve({
              products: { items: [], nextCursor: 'cur-p' },
              customers: { items: [], nextCursor: 'cur-c' },
              stock: [],
              lots: hasCursor
                ? { 'lot-1': { status: 'issues', issues: ['stock insuficiente'] } }
                : {},
            }),
        } as Response);
      }),
    );
    // Foto completa de arranque, para que la próxima sea un delta con cursores.
    await runPullCycleNow({ full: true });
    addAwaitingLot({ id: 'lot-1', sentAt: now });
    bodies.length = 0;

    await runPullCycleNow();

    expect(bodies).toHaveLength(2);
    expect(
      Object.keys((bodies[0] as { cursors: Record<string, string> }).cursors).length,
    ).toBeGreaterThan(0);
    expect((bodies[1] as { cursors: Record<string, string> }).cursors).toEqual({});
  });
});

describe('syncNow (/SINCRONIZAR)', () => {
  it('fuerza el push del lote pendiente (ignorando backoff) y después un pull completo', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    await db.outbox.add(pendingSaleEvent());
    const calls = stubRestFetch();

    await syncNow();

    expect(calls).toEqual(['POST /sync/push', 'POST /sync/pull']);
  });
});

describe('cerrojo de sync', () => {
  it('tryAcquireSyncLock devuelve undefined si ya está tomado y se puede volver a tomar tras liberar', () => {
    const release = tryAcquireSyncLock();
    expect(release).not.toBeUndefined();
    expect(tryAcquireSyncLock()).toBeUndefined();

    release?.();

    const again = tryAcquireSyncLock();
    expect(again).not.toBeUndefined();
    again?.();
  });

  it('acquireSyncLockWaiting espera a que se libere', async () => {
    const release = tryAcquireSyncLock();
    setTimeout(() => release?.(), 30);

    const acquired = await acquireSyncLockWaiting(1000);

    expect(acquired).not.toBeUndefined();
    acquired?.();
  });

  it('acquireSyncLockWaiting devuelve undefined si vence la espera', async () => {
    const release = tryAcquireSyncLock();

    const acquired = await acquireSyncLockWaiting(60);

    expect(acquired).toBeUndefined();
    release?.();
  });
});

function pendingSaleEvent(id = 'sale-1') {
  return {
    type: 'sale' as const,
    sale: { ...sale, id },
    id,
    status: 'pending' as const,
    createdAt: now,
  };
}

/** Espera a que termine el ciclo en vuelo (suelta el cerrojo): si no, el test cierra la base con un ciclo a medias. */
async function settled(): Promise<void> {
  await vi.waitFor(() => {
    const release = tryAcquireSyncLock();
    expect(release).not.toBeUndefined();
    release?.();
  });
}

/**
 * fetch de mentira contra un backend REST: registra "MÉTODO /ruta" y responde cada ruta con su forma
 * real (`/sync/push`/`/sync/pull`, contrato batch #87); `failures` = cuántos POST de push fallan
 * (500) antes de andar.
 */
function stubRestFetch(failures = 0): string[] {
  let remaining = failures;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${path}`);
      const fail = path === '/sync/push' && remaining > 0;
      if (fail) remaining -= 1;
      const body =
        path === '/sync/pull'
          ? { products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }
          : {};
      return Promise.resolve({
        ok: !fail,
        status: fail ? 500 : 200,
        statusText: fail ? 'Server Error' : 'OK',
        json: () => Promise.resolve(body),
      } as Response);
    }),
  );
  return calls;
}

describe('requestPushSoon y reintentos agendados', () => {
  beforeEach(() => {
    // Solo timeouts y reloj: fake-indexeddb sigue con su scheduler real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  afterEach(() => {
    cancelScheduledPush();
    vi.useRealTimers();
  });

  it('agrupa pedidos seguidos en un solo envío a los 2 s', async () => {
    await db.outbox.add(pendingSaleEvent());
    const calls = stubRestFetch();

    requestPushSoon();
    requestPushSoon();
    requestPushSoon();
    await vi.advanceTimersByTimeAsync(1900);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    await settled();

    expect(calls).toEqual(['POST /sync/push']);
  });

  it('un pedido más cercano adelanta al agendado', async () => {
    await db.outbox.add(pendingSaleEvent());
    const calls = stubRestFetch();

    requestPushSoon(5000);
    requestPushSoon(1000);
    await vi.advanceTimersByTimeAsync(1200);
    await settled();

    expect(calls).toEqual(['POST /sync/push']);
  });

  it('un pedido más lejano nunca posterga al agendado (un reintento no se demora por un evento)', async () => {
    await db.outbox.add(pendingSaleEvent());
    const calls = stubRestFetch();

    requestPushSoon(1000);
    requestPushSoon(5000);
    await vi.advanceTimersByTimeAsync(1200);
    await settled();

    expect(calls).toEqual(['POST /sync/push']);
  });

  it('tras un envío fallido, reintenta solo cuando vence el backoff y el lote queda synced', async () => {
    await db.outbox.add(pendingSaleEvent());
    const calls = stubRestFetch(1);

    await runPushCycle();
    expect(calls).toEqual(['POST /sync/push']);
    expect((await db.outbox.get('sale-1'))?.status).toBe('pending');

    await vi.advanceTimersByTimeAsync(1500); // el backoff del primer reintento es de 2 s
    expect(calls).toEqual(['POST /sync/push']);
    await vi.advanceTimersByTimeAsync(1000);
    await settled();

    expect(calls).toEqual(['POST /sync/push', 'POST /sync/push']);
    expect((await db.outbox.get('sale-1'))?.status).toBe('synced');
  });
});

describe('startSyncEngine', () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    cancelScheduledPush();
    cancelScheduledPull();
    vi.useRealTimers();
  });

  it('al arrancar corre un push y un pull', async () => {
    await db.outbox.add(pendingSaleEvent()); // si no hay nada pendiente, push no llama a la red
    const calls = stubRestFetch();
    stop = startSyncEngine();
    await settled();

    expect(calls).toContain('POST /sync/push');
    expect(calls).toContain('POST /sync/pull');
  });

  it('un evento nuevo en el outbox dispara un push a los ~2s, y agenda un pull ~2min después', async () => {
    const calls = stubRestFetch();
    stop = startSyncEngine();
    await settled();
    calls.length = 0;

    await db.outbox.add(pendingSaleEvent());
    await vi.advanceTimersByTimeAsync(2_100);
    await settled();
    expect(calls).toEqual(['POST /sync/push']);

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);
    await settled();
    expect(calls).toEqual(['POST /sync/push', 'POST /sync/pull']);
  });

  it('sin actividad nueva, el push corre cada PUSH_INTERVAL_MS y el pull cada PULL_SAFETY_NET_INTERVAL_MS', async () => {
    // Un evento que nunca logra sincronizarse queda pending para siempre — así el intervalo de
    // push (no el debounce por evento nuevo) tiene algo que reintentar en cada tick.
    await db.outbox.add(pendingSaleEvent());
    const calls = stubRestFetch(1000);
    stop = startSyncEngine();
    await settled();
    calls.length = 0;

    await vi.advanceTimersByTimeAsync(PUSH_INTERVAL_MS + 100);
    await settled();
    expect(calls).toContain('POST /sync/push');

    calls.length = 0;
    await vi.advanceTimersByTimeAsync(PULL_SAFETY_NET_INTERVAL_MS + 100);
    await settled();
    expect(calls).toContain('POST /sync/pull');
  });

  it('la función devuelta detiene los dos intervalos y los disparos agendados', async () => {
    const calls = stubRestFetch();
    stop = startSyncEngine();
    await settled();
    calls.length = 0;

    stop();
    stop = undefined;
    await db.outbox.add(pendingSaleEvent());
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);

    expect(calls).toEqual([]);
  });
});

describe('runPullCycleNow — foto completa y reconciliación de bajas (integración con conector real)', () => {
  function catalogProduct(id: string): Product {
    return {
      id,
      sku: `SKU-${id}`,
      barcodes: [],
      name: `Producto ${id}`,
      price: 100,
      taxRate: 0.21,
      category: 'x',
      tracksStock: false,
    };
  }

  type Backend = {
    products: Product[];
    customers: { id: string; name: string }[];
    failCustomers?: boolean;
  };

  /** Backend REST de mentira contra /sync/pull; registra "MÉTODO /ruta" de cada request. */
  function stubBackend(state: Backend): string[] {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const target = new URL(url);
        calls.push(`${init?.method ?? 'GET'} ${target.pathname}`);
        const failing = state.failCustomers === true;
        const response = {
          products: { items: state.products, nextCursor: 'cur-p' },
          customers: failing ? undefined : { items: state.customers, nextCursor: 'cur-c' },
          stock: [],
          lots: {},
        };
        return Promise.resolve({
          ok: !failing,
          status: failing ? 500 : 200,
          statusText: failing ? 'Server Error' : 'OK',
          json: () => Promise.resolve(failing ? {} : response),
        } as Response);
      }),
    );
    return calls;
  }

  beforeEach(() => {
    resetFullRefreshSession();
    lastSyncFailureSignal.value = null;
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('el primer ciclo de la sesión es una foto completa: sin cursores, borra lo que ya no viene y fija los cursores', async () => {
    await db.products.bulkPut([catalogProduct('p1'), catalogProduct('p2')]);
    setProductsCursor('cursor-viejo');
    const calls = stubBackend({ products: [catalogProduct('p1')], customers: [] });

    await runPullCycleNow();

    expect(calls).toContain('POST /sync/pull');
    expect(await db.products.toCollection().primaryKeys()).toEqual(['p1']);
    expect(getProductsCursor()).toBe('cur-p');
    expect(getCustomersCursor()).toBe('cur-c');
    expect(getLastFullSyncAt()).toBeDefined();
    expect(syncStatusSignal.value).toBe('online-idle');
  });

  it('a las 2 horas vuelve a hacer una foto completa', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      stubBackend({ products: [catalogProduct('p1')], customers: [] });
      await runPullCycleNow();

      vi.setSystemTime(Date.now() + 119 * 60 * 1000);
      await runPullCycleNow();
      expect(getLastFullSyncAt()).toBeDefined();

      vi.setSystemTime(Date.now() + 2 * 60 * 1000);
      await runPullCycleNow();
      // El tercer ciclo, ya pasadas las 2h desde la primera foto, vuelve a ser completo.
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pedido (full) fuerza la foto completa aunque la última sea reciente', async () => {
    stubBackend({ products: [catalogProduct('p1')], customers: [] });
    await runPullCycleNow();

    await runPullCycleNow({ full: true });

    expect(getLastFullSyncAt()).toBeDefined();
  });

  it('con un conector snapshot (Sheets) todo ciclo es completo y reconcilia las bajas', async () => {
    saveSyncConfig({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });
    const requests: { action: string; payload: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string) as { action: string; payload: unknown };
        requests.push(body);
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () =>
            Promise.resolve({
              ok: true,
              data: {
                products: { items: [catalogProduct('p1')] },
                customers: { items: [] },
                lots: {},
              },
            }),
        } as Response);
      }),
    );

    await runPullCycleNow();
    await db.products.put(catalogProduct('p-fantasma'));
    await runPullCycleNow();

    expect(await db.products.toCollection().primaryKeys()).toEqual(['p1']);
    expect(requests.filter((request) => request.action === 'pullBatch')).toHaveLength(2);
  });

  it('si el pull falla, no se aplica nada: ni upsert ni borrado, ni lastFullSyncAt', async () => {
    await db.products.bulkPut([catalogProduct('p1'), catalogProduct('p2')]);
    stubBackend({ products: [catalogProduct('p1')], customers: [], failCustomers: true });

    await runPullCycleNow();

    expect(await db.products.toCollection().primaryKeys()).toEqual(['p1', 'p2']);
    expect(getLastFullSyncAt()).toBeUndefined();
    expect(syncStatusSignal.value).toBe('sync-error');
    expect(lastSyncFailureSignal.value).toMatchObject({ ok: false, error: 'sync/request-failed' });
  });

  it('un catálogo vacío con datos locales se conserva, se avisa y la foto queda pendiente', async () => {
    await db.products.bulkPut([catalogProduct('p1'), catalogProduct('p2')]);
    stubBackend({ products: [], customers: [] });

    await runPullCycleNow();

    expect(await db.products.toCollection().primaryKeys()).toEqual(['p1', 'p2']);
    expect(syncStatusSignal.value).toBe('sync-error');
    expect(lastSyncFailureSignal.value).toEqual({
      ok: false,
      error: 'sync/empty-snapshot',
      meta: { tables: ['products'] },
    });
    expect(getLastFullSyncAt()).toBeUndefined();
  });
});
