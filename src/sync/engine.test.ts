import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '../domain/result.ts';
import { db } from '../storage/db.ts';
import { setCatalogRepository } from '../ui/state/catalog.ts';
import {
  lastSyncFailureSignal,
  lastSyncedAtSignal,
  localCatalogCountsSignal,
  pendingOutboxCountSignal,
  setSyncPaused,
  syncConfiguredSignal,
  syncStatusSignal,
} from '../ui/state/sync.ts';
import type { AccountHoldResult, Connector, ConnectorCustomer, ConnectorPullResult } from './connector.ts';
import { saveSyncConfig } from './config.ts';
import {
  getCustomersCursor,
  getLastFullSyncAt,
  getProductsCursor,
  setProductsCursor,
} from './cursor.ts';
import {
  acquireSyncLockWaiting,
  cancelScheduledPush,
  pushOnce,
  pushPendingEvents,
  requestPushSoon,
  resetFullRefreshSession,
  runSyncCycle,
  startSyncEngine,
  syncOnce,
  tryAcquireSyncLock,
} from './engine.ts';
import type { Product } from '../domain/product.ts';
import type { Sale } from '../domain/sale.ts';
import type { StockItem, StockMovement } from '../domain/stock.ts';

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

function fakeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    pullProducts: () => Promise.resolve(ok<ConnectorPullResult<Product>>({ items: [] })),
    pullStock: () => Promise.resolve(ok<StockItem[]>([])),
    pullCustomers: () => Promise.resolve(ok<ConnectorPullResult<ConnectorCustomer>>({ items: [] })),
    pushSale: () => Promise.resolve(ok(undefined)),
    pushStockMovement: () => Promise.resolve(ok(undefined)),
    pushSaleVoid: () => Promise.resolve(ok(undefined)),
    pushCustomer: () => Promise.resolve(ok(undefined)),
    requestAccountHold: () =>
      Promise.resolve(ok<AccountHoldResult>({ approved: true, holdId: 'hold-1' })),
    pushAccountHoldConfirm: () => Promise.resolve(ok(undefined)),
    releaseAccountHold: () => Promise.resolve(ok(undefined)),
    pushCashSession: () => Promise.resolve(ok(undefined)),
    ...overrides,
  };
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
  vi.unstubAllGlobals();
});

const sale: Sale = {
  id: 'sale-1',
  lines: [],
  payments: [],
  total: 0,
  status: 'closed',
  createdAt: now,
};

describe('syncOnce — push', () => {
  it('empuja los eventos pendientes en orden y los marca synced', async () => {
    await db.outbox.bulkAdd([
      {
        type: 'sale',
        sale,
        id: 'sale-1',
        status: 'pending',
        retries: 0,
        createdAt: now,
        nextAttemptAt: now,
      },
    ]);
    const pushSale = vi.fn().mockResolvedValue(ok(undefined));

    await syncOnce(fakeConnector({ pushSale }), now);

    expect(pushSale).toHaveBeenCalledWith(sale, 'sale-1');
    const event = await db.outbox.get('sale-1');
    expect(event?.status).toBe('synced');
  });

  it('respeta el orden por createdAt', async () => {
    await db.outbox.bulkAdd([
      {
        type: 'sale',
        sale,
        id: 'second',
        status: 'pending',
        retries: 0,
        createdAt: '2026-01-01T00:00:02.000Z',
        nextAttemptAt: now,
      },
      {
        type: 'sale',
        sale,
        id: 'first',
        status: 'pending',
        retries: 0,
        createdAt: '2026-01-01T00:00:01.000Z',
        nextAttemptAt: now,
      },
    ]);
    const order: string[] = [];
    const pushSale = vi.fn().mockImplementation((_s: Sale, key: string) => {
      order.push(key);
      return Promise.resolve(ok(undefined));
    });

    await syncOnce(fakeConnector({ pushSale }), now);

    expect(order).toEqual(['first', 'second']);
  });

  it('no empuja eventos cuyo nextAttemptAt todavía no llegó', async () => {
    await db.outbox.add({
      type: 'sale',
      sale,
      id: 'sale-1',
      status: 'pending',
      retries: 1,
      createdAt: now,
      nextAttemptAt: '2026-01-01T01:00:00.000Z', // futuro
    });
    const pushSale = vi.fn().mockResolvedValue(ok(undefined));

    await syncOnce(fakeConnector({ pushSale }), now);

    expect(pushSale).not.toHaveBeenCalled();
    const event = await db.outbox.get('sale-1');
    expect(event?.status).toBe('pending');
  });

  it('marca failed y calcula el próximo intento cuando el push falla', async () => {
    await db.outbox.add({
      type: 'sale',
      sale,
      id: 'sale-1',
      status: 'pending',
      retries: 0,
      createdAt: now,
      nextAttemptAt: now,
    });
    const pushSale = vi.fn().mockResolvedValue(err('sync/request-failed', { message: 'boom' }));

    await syncOnce(fakeConnector({ pushSale }), now);

    const event = await db.outbox.get('sale-1');
    expect(event?.status).toBe('pending');
    expect(event?.retries).toBe(1);
    expect(event?.lastError).toBe('sync/request-failed');
  });

  it('actualiza pendingOutboxCountSignal', async () => {
    await db.outbox.add({
      type: 'sale',
      sale,
      id: 'sale-1',
      status: 'pending',
      retries: 0,
      createdAt: now,
      nextAttemptAt: now,
    });

    await syncOnce(
      fakeConnector({
        pushSale: () => Promise.resolve(err('sync/request-failed', { message: 'x' })),
      }),
      now,
    );

    expect(pendingOutboxCountSignal.value).toBe(1);
    expect(syncStatusSignal.value).toBe('online-idle');
  });

  it('pasa a sync-error cuando un evento pendiente supera el umbral de reintentos', async () => {
    await db.outbox.add({
      type: 'sale',
      sale,
      id: 'sale-1',
      status: 'pending',
      retries: 5,
      createdAt: now,
      nextAttemptAt: now,
    });

    await syncOnce(
      fakeConnector({
        pushSale: () => Promise.resolve(err('sync/request-failed', { message: 'x' })),
      }),
      now,
    );

    expect(syncStatusSignal.value).toBe('sync-error');
  });
});

describe('syncOnce — pull', () => {
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
    const pullProducts = vi
      .fn<Connector['pullProducts']>()
      .mockResolvedValue(ok({ items: [product], nextCursor: 'cursor-2' }));

    await syncOnce(fakeConnector({ pullProducts }), now);

    const stored = await db.products.get('p1');
    expect(stored?.name).toBe('Arroz 1kg');
    expect(getProductsCursor()).toBe('cursor-2');
  });

  it('manda el cursor guardado como since en el próximo ciclo', async () => {
    const pullProducts = vi
      .fn<Connector['pullProducts']>()
      .mockResolvedValue(ok({ items: [product], nextCursor: 'cursor-2' }));
    await syncOnce(fakeConnector({ pullProducts }), now);

    await syncOnce(fakeConnector({ pullProducts }), now);

    expect(pullProducts).toHaveBeenLastCalledWith({ since: 'cursor-2' });
  });

  it('actualiza el stock recibido', async () => {
    const stockItem: StockItem = { productId: 'p1', quantity: 7, updatedAt: now };
    const pullStock = vi.fn<Connector['pullStock']>().mockResolvedValue(ok([stockItem]));

    await syncOnce(fakeConnector({ pullStock }), now);

    const stored = await db.stock.get('p1');
    expect(stored?.quantity).toBe(7);
  });

  it('si un pull falla: no rompe el ciclo, pasa a sync-error, guarda el motivo y no marca la sync como exitosa', async () => {
    lastSyncedAtSignal.value = null;
    const failure = err('sync/request-failed', { status: 401, message: 'x' });
    const pullProducts = vi.fn<Connector['pullProducts']>().mockResolvedValue(failure);

    const report = await syncOnce(fakeConnector({ pullProducts }), now);

    expect(report.pulls.products.ok).toBe(false);
    expect(syncStatusSignal.value).toBe('sync-error');
    expect(lastSyncFailureSignal.value).toEqual(failure);
    expect(lastSyncedAtSignal.value).toBeNull();
  });

  it.each([
    [
      'stock',
      { pullStock: () => Promise.resolve(err('sync/request-failed', { message: 'down' })) },
    ],
    [
      'clientes',
      { pullCustomers: () => Promise.resolve(err('sync/request-failed', { message: 'down' })) },
    ],
  ] as const)('un pull de %s fallido también es sync-error', async (_name, overrides) => {
    await syncOnce(fakeConnector(overrides), now);

    expect(syncStatusSignal.value).toBe('sync-error');
    expect(lastSyncFailureSignal.value).not.toBeNull();
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
    await syncOnce(
      fakeConnector({
        pullProducts: () => Promise.resolve(err('sync/request-failed', { message: 'down' })),
      }),
      now,
    );
    expect(lastSyncFailureSignal.value).not.toBeNull();

    const report = await syncOnce(fakeConnector(), now);

    expect(report.pulls.products.ok).toBe(true);
    expect(lastSyncFailureSignal.value).toBeNull();
    expect(localCatalogCountsSignal.value).toEqual({ products: 1, customers: 0 });
    expect(lastSyncedAtSignal.value).toBe(now);
  });
});

describe('syncOnce — pull de clientes', () => {
  const rawCustomer = { id: 'c1', name: 'Juan Pérez', creditLimit: 1000, margin: 0, balance: 100 };

  it('guarda customer y customerAccount, y avanza el cursor', async () => {
    const pullCustomers = vi
      .fn<Connector['pullCustomers']>()
      .mockResolvedValue(ok({ items: [rawCustomer], nextCursor: 'cursor-2' }));

    await syncOnce(fakeConnector({ pullCustomers }), now);

    const storedCustomer = await db.customers.get('c1');
    expect(storedCustomer?.name).toBe('Juan Pérez');
    const storedAccount = await db.customerAccounts.get('c1');
    expect(storedAccount?.balance).toBe(100);
    expect(getCustomersCursor()).toBe('cursor-2');
  });

  it('un cliente sin datos de cuenta no crea fila en customerAccounts', async () => {
    const pullCustomers = vi
      .fn<Connector['pullCustomers']>()
      .mockResolvedValue(ok({ items: [{ id: 'c2', name: 'Sin cuenta' }] }));

    await syncOnce(fakeConnector({ pullCustomers }), now);

    expect(await db.customerAccounts.get('c2')).toBeUndefined();
  });
});

describe('pushOne por tipo de evento', () => {
  it('llama pushStockMovement para un evento stock-movement', async () => {
    const movement: StockMovement = {
      id: 'm1',
      productId: 'p1',
      delta: -1,
      reason: 'sale',
      saleId: 'sale-1',
      createdAt: now,
    };
    await db.outbox.add({
      type: 'stock-movement',
      movement,
      id: 'm1',
      status: 'pending',
      retries: 0,
      createdAt: now,
      nextAttemptAt: now,
    });
    const pushStockMovement = vi.fn().mockResolvedValue(ok(undefined));

    await syncOnce(fakeConnector({ pushStockMovement }), now);

    expect(pushStockMovement).toHaveBeenCalledWith(movement, 'm1');
  });

  it('llama pushSaleVoid para un evento sale-void', async () => {
    await db.outbox.add({
      type: 'sale-void',
      saleId: 'sale-1',
      voidedAt: now,
      voidReason: 'error',
      id: 'void-1',
      status: 'pending',
      retries: 0,
      createdAt: now,
      nextAttemptAt: now,
    });
    const pushSaleVoid = vi.fn().mockResolvedValue(ok(undefined));

    await syncOnce(fakeConnector({ pushSaleVoid }), now);

    expect(pushSaleVoid).toHaveBeenCalledWith(
      { saleId: 'sale-1', voidedAt: now, voidReason: 'error' },
      'void-1',
    );
  });

  it('llama pushCustomer para un evento customer', async () => {
    await db.outbox.add({
      type: 'customer',
      customer: { id: 'c1', name: 'Juan Pérez', createdAt: now },
      id: 'c1',
      status: 'pending',
      retries: 0,
      createdAt: now,
      nextAttemptAt: now,
    });
    const pushCustomer = vi.fn().mockResolvedValue(ok(undefined));

    await syncOnce(fakeConnector({ pushCustomer }), now);

    expect(pushCustomer).toHaveBeenCalledWith({ id: 'c1', name: 'Juan Pérez', createdAt: now }, 'c1');
  });

  it('llama pushAccountHoldConfirm para un evento account-hold-confirm', async () => {
    await db.outbox.add({
      type: 'account-hold-confirm',
      holdId: 'hold-1',
      saleId: 'sale-1',
      id: 'confirm-1',
      status: 'pending',
      retries: 0,
      createdAt: now,
      nextAttemptAt: now,
    });
    const pushAccountHoldConfirm = vi.fn().mockResolvedValue(ok(undefined));

    await syncOnce(fakeConnector({ pushAccountHoldConfirm }), now);

    expect(pushAccountHoldConfirm).toHaveBeenCalledWith(
      { holdId: 'hold-1', saleId: 'sale-1' },
      'confirm-1',
    );
  });

  it('llama releaseAccountHold para un evento account-hold-release', async () => {
    await db.outbox.add({
      type: 'account-hold-release',
      holdId: 'hold-1',
      id: 'release-1',
      status: 'pending',
      retries: 0,
      createdAt: now,
      nextAttemptAt: now,
    });
    const releaseAccountHold = vi.fn().mockResolvedValue(ok(undefined));

    await syncOnce(fakeConnector({ releaseAccountHold }), now);

    expect(releaseAccountHold).toHaveBeenCalledWith({ holdId: 'hold-1' }, 'release-1');
  });

  it('llama pushCashSession para un evento cash-session', async () => {
    const session = { id: 'cs1', openedAt: now, openingAmount: 500, sales: ['s1'] };
    await db.outbox.add({
      type: 'cash-session',
      session,
      id: 'cs1',
      status: 'pending',
      retries: 0,
      createdAt: now,
      nextAttemptAt: now,
    });
    const pushCashSession = vi.fn().mockResolvedValue(ok(undefined));

    await syncOnce(fakeConnector({ pushCashSession }), now);

    expect(pushCashSession).toHaveBeenCalledWith(session, 'cs1');
  });
});

describe('runSyncCycle', () => {
  it('sin red, marca offline y no llama a fetch', async () => {
    setOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runSyncCycle();

    expect(syncStatusSignal.value).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con la sincronización pausada (/CONFIG abierto) no corre el ciclo ni llama a fetch', async () => {
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setSyncPaused(true);

    try {
      await runSyncCycle();
    } finally {
      setSyncPaused(false);
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncStatusSignal.value).not.toBe('syncing');
  });

  it('sin config guardada, marca syncConfigured en false', async () => {
    await runSyncCycle();

    expect(syncConfiguredSignal.value).toBe(false);
  });

  it('con una config sin verifiedAt (sin probar) no corre el ciclo ni llama a fetch', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runSyncCycle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncConfiguredSignal.value).toBe(false);
  });

  it('con config guardada, arma el conector real y corre un ciclo', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: '2026-01-01T00:00:00.000Z' });
    // Cada ruta con la forma real de su respuesta: `/stock` devuelve un array,
    // no `{ items }`. Desde #53 un pull con formato inesperado ya no se traga
    // en silencio (sería `sync-error`), así que el stub tiene que ser fiel.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve(new URL(url).pathname === '/stock' ? [] : { items: [] }),
        } as Response),
      ),
    );

    await runSyncCycle();

    expect(syncConfiguredSignal.value).toBe(true);
    expect(syncStatusSignal.value).toBe('online-idle');
  });

  it('con config de Google Sheets guardada, sincroniza contra el Web App (Etapa 2, #68)', async () => {
    const webAppUrl = 'https://script.google.com/macros/s/abc/exec';
    saveSyncConfig({ type: 'google-sheets', webAppUrl, verifiedAt: '2026-01-01T00:00:00.000Z' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ ok: true, data: { items: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await runSyncCycle();

    expect(syncConfiguredSignal.value).toBe(true);
    expect(syncStatusSignal.value).toBe('online-idle');
    expect(fetchMock).toHaveBeenCalled();
    for (const [url] of fetchMock.mock.calls) {
      expect(url).toBe(webAppUrl);
    }
  });

  it('no arranca un segundo ciclo si el anterior sigue en curso (issue #1)', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: '2026-01-01T00:00:00.000Z' });

    // Con latencia real controlada, a diferencia del resto de los tests de
    // este archivo (que resuelven al instante): es justo la condición bajo
    // la que aparece el bug de ciclos solapados. Solo el PRIMER fetch queda
    // colgado — el resto resuelve al toque, para no trabar el resto del
    // pull (products + stock) una vez que se libera.
    let callCount = 0;
    let resolveFirstFetch: (response: Response) => void = () => {
      throw new Error('resolveFirstFetch no fue asignado todavía');
    };
    const okResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ items: [] }),
    } as Response;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirstFetch = resolve;
        });
      }
      return Promise.resolve(okResponse);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = runSyncCycle();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // Mientras el primer ciclo sigue esperando su fetch (el pull de
    // products), un segundo disparo (setInterval/online//SINCRONIZAR) no
    // debería agregar ningún llamado nuevo.
    await runSyncCycle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirstFetch(okResponse);
    await first;

    // Con el primero terminado, un tercer disparo sí tiene que sincronizar.
    const callsAfterFirst = fetchMock.mock.calls.length;
    await runSyncCycle();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

describe('pushPendingEvents', () => {
  it('con ignoreBackoff empuja también los eventos cuyo nextAttemptAt todavía no llegó', async () => {
    await db.outbox.add({
      type: 'sale',
      sale,
      id: 'sale-1',
      status: 'pending',
      retries: 1,
      createdAt: now,
      nextAttemptAt: '2026-01-01T01:00:00.000Z', // futuro
    });
    const pushSale = vi.fn().mockResolvedValue(ok(undefined));

    const withoutFlag = await pushPendingEvents(fakeConnector({ pushSale }), now);
    expect(withoutFlag).toEqual({ attempted: 0, failed: 0 });

    const withFlag = await pushPendingEvents(fakeConnector({ pushSale }), now, {
      ignoreBackoff: true,
    });
    expect(withFlag).toEqual({ attempted: 1, failed: 0 });
    expect(pushSale).toHaveBeenCalledTimes(1);
  });

  it('cuenta los fallos', async () => {
    await db.outbox.add({
      type: 'sale',
      sale,
      id: 'sale-1',
      status: 'pending',
      retries: 0,
      createdAt: now,
      nextAttemptAt: now,
    });

    const summary = await pushPendingEvents(
      fakeConnector({
        pushSale: () => Promise.resolve(err('sync/request-failed', { message: 'x' })),
      }),
      now,
    );

    expect(summary).toEqual({ attempted: 1, failed: 1 });
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
    retries: 0,
    createdAt: now,
    nextAttemptAt: now,
  };
}

describe('pushOnce (ciclo de solo envío)', () => {
  it('empuja los pendientes sin pullear catálogo, stock ni clientes', async () => {
    await db.outbox.add(pendingSaleEvent());
    const pushSale = vi.fn().mockResolvedValue(ok(undefined));
    const pullProducts = vi.fn();
    const pullStock = vi.fn();
    const pullCustomers = vi.fn();

    const summary = await pushOnce(
      fakeConnector({ pushSale, pullProducts, pullStock, pullCustomers }),
      now,
    );

    expect(summary).toEqual({ attempted: 1, failed: 0 });
    expect(pushSale).toHaveBeenCalledWith(expect.objectContaining({ id: 'sale-1' }), 'sale-1');
    expect(pullProducts).not.toHaveBeenCalled();
    expect(pullStock).not.toHaveBeenCalled();
    expect(pullCustomers).not.toHaveBeenCalled();
    expect((await db.outbox.get('sale-1'))?.status).toBe('synced');
  });

  it('sin fallas pendientes deja online-idle, actualiza el conteo y no toca la última sync', async () => {
    lastSyncFailureSignal.value = null; // otros tests del archivo pueden dejarla puesta
    await db.outbox.add(pendingSaleEvent());
    const before = lastSyncedAtSignal.value;

    await pushOnce(fakeConnector(), now);

    expect(syncStatusSignal.value).toBe('online-idle');
    expect(pendingOutboxCountSignal.value).toBe(0);
    expect(lastSyncedAtSignal.value).toBe(before);
  });

  it('conserva sync-error si quedó una falla de pull sin resolver', async () => {
    lastSyncFailureSignal.value = { ok: false, error: 'sync/timeout', meta: { seconds: 20 } };

    try {
      await pushOnce(fakeConnector(), now);
      expect(syncStatusSignal.value).toBe('sync-error');
    } finally {
      lastSyncFailureSignal.value = null;
    }
  });

  it('un envío que falla deja el evento pendiente con su backoff y cuenta como fallido', async () => {
    await db.outbox.add(pendingSaleEvent());
    const pushSale = vi.fn().mockResolvedValue(err('sync/request-failed', { message: 'boom' }));

    const summary = await pushOnce(fakeConnector({ pushSale }), now);

    expect(summary).toEqual({ attempted: 1, failed: 1 });
    expect((await db.outbox.get('sale-1'))?.status).toBe('pending');
  });
});

describe('runSyncCycle({ pull: false })', () => {
  it('con config REST solo envía el outbox: ningún GET de catálogo, stock o clientes', async () => {
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.outbox.add(pendingSaleEvent());
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({}),
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);

    await runSyncCycle({ pull: false });

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][];
    expect(calls.map(([url, init]) => `${init?.method ?? 'GET'} ${new URL(url).pathname}`)).toEqual([
      'POST /sales',
    ]);
  });
});

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
 * real; `failures` = cuántos POST fallan (500) antes de andar.
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
      const fail = method === 'POST' && remaining > 0;
      if (fail) remaining -= 1;
      const body = path === '/stock' ? [] : method === 'GET' ? { items: [] } : {};
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

    expect(calls).toEqual(['POST /sales']);
  });

  it('un pedido más cercano adelanta al agendado', async () => {
    await db.outbox.add(pendingSaleEvent());
    const calls = stubRestFetch();

    requestPushSoon(5000);
    requestPushSoon(1000);
    await vi.advanceTimersByTimeAsync(1200);
    await settled();

    expect(calls).toEqual(['POST /sales']);
  });

  it('un pedido más lejano nunca posterga al agendado (un reintento no se demora por un evento)', async () => {
    await db.outbox.add(pendingSaleEvent());
    const calls = stubRestFetch();

    requestPushSoon(1000);
    requestPushSoon(5000);
    await vi.advanceTimersByTimeAsync(1200);
    await settled();

    expect(calls).toEqual(['POST /sales']);
  });

  it('tras un envío fallido, reintenta solo cuando vence el backoff y el evento queda synced', async () => {
    await db.outbox.add(pendingSaleEvent());
    const calls = stubRestFetch(1);

    await runSyncCycle({ pull: false });
    expect(calls).toEqual(['POST /sales']);
    expect((await db.outbox.get('sale-1'))?.status).toBe('pending');

    await vi.advanceTimersByTimeAsync(1500); // el backoff del primer reintento es de 2 s
    expect(calls).toEqual(['POST /sales']);
    await vi.advanceTimersByTimeAsync(1000);
    await settled();

    expect(calls).toEqual(['POST /sales', 'POST /sales']);
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
    vi.useRealTimers();
  });

  it('corre un ciclo completo al arrancar y después uno cada 5 minutos, no antes', async () => {
    const calls = stubRestFetch();

    stop = startSyncEngine();
    await settled();
    expect(calls).toContain('GET /products');
    calls.length = 0;

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    expect(calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(61 * 1000);
    await settled();
    expect(calls).toContain('GET /products');
  });

  it('un evento nuevo en el outbox dispara un envío a los ~2 s, sin traer catálogo', async () => {
    const calls = stubRestFetch();
    stop = startSyncEngine();
    await settled();
    calls.length = 0;

    await db.outbox.add(pendingSaleEvent());
    await vi.advanceTimersByTimeAsync(1900);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    await settled();

    expect(calls).toEqual(['POST /sales']);
    expect((await db.outbox.get('sale-1'))?.status).toBe('synced');
  });

  it('actualizar un evento existente (marcarlo synced, reintentarlo) no dispara otro envío', async () => {
    await db.outbox.add(pendingSaleEvent());
    const calls = stubRestFetch();
    stop = startSyncEngine();
    await settled();
    calls.length = 0;

    await vi.advanceTimersByTimeAsync(10_000);

    expect(calls).toEqual([]);
  });

  it('la función devuelta detiene el intervalo y el disparo por eventos', async () => {
    const calls = stubRestFetch();
    stop = startSyncEngine();
    await settled();
    calls.length = 0;

    stop();
    stop = undefined;
    await db.outbox.add(pendingSaleEvent());
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);

    expect(calls).toEqual([]);
  });
});

describe('foto completa y reconciliación de bajas', () => {
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

  type Backend = { products: Product[]; customers: { id: string; name: string }[]; failCustomers?: boolean };

  /** Backend REST de mentira; registra "MÉTODO /ruta?query" de cada request. */
  function stubBackend(state: Backend): string[] {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const target = new URL(url);
        calls.push(`${init?.method ?? 'GET'} ${target.pathname}${target.search}`);
        const failing = target.pathname === '/customers' && state.failCustomers === true;
        let body: unknown = {};
        if (target.pathname === '/products') body = { items: state.products, nextCursor: 'cur-p' };
        if (target.pathname === '/customers') body = { items: state.customers, nextCursor: 'cur-c' };
        if (target.pathname === '/stock') body = [];
        return Promise.resolve({
          ok: !failing,
          status: failing ? 500 : 200,
          statusText: failing ? 'Server Error' : 'OK',
          json: () => Promise.resolve(body),
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

  it('el primer ciclo de la sesión es una foto completa: sin since, borra lo que ya no viene y fija los cursores', async () => {
    await db.products.bulkPut([catalogProduct('p1'), catalogProduct('p2')]);
    setProductsCursor('cursor-viejo');
    const calls = stubBackend({ products: [catalogProduct('p1')], customers: [] });

    await runSyncCycle();

    expect(calls).toContain('GET /products');
    expect(calls.some((call) => call.includes('since'))).toBe(false);
    expect(await db.products.toCollection().primaryKeys()).toEqual(['p1']);
    expect(getProductsCursor()).toBe('cur-p');
    expect(getCustomersCursor()).toBe('cur-c');
    expect(getLastFullSyncAt()).toBeDefined();
    expect(syncStatusSignal.value).toBe('online-idle');
  });

  it('el segundo ciclo de la misma sesión, a menos de 1 hora, vuelve a ser un delta con since', async () => {
    const calls = stubBackend({ products: [catalogProduct('p1')], customers: [] });

    await runSyncCycle();
    calls.length = 0;
    await runSyncCycle();

    expect(calls).toContain('GET /products?since=cur-p');
    expect(calls).toContain('GET /customers?since=cur-c');
  });

  it('a la hora vuelve a hacer una foto completa', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const calls = stubBackend({ products: [catalogProduct('p1')], customers: [] });
      await runSyncCycle();

      vi.setSystemTime(Date.now() + 59 * 60 * 1000);
      calls.length = 0;
      await runSyncCycle();
      expect(calls).toContain('GET /products?since=cur-p');

      vi.setSystemTime(Date.now() + 2 * 60 * 1000);
      calls.length = 0;
      await runSyncCycle();
      expect(calls).toContain('GET /products');
      expect(calls.some((call) => call.includes('since'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pedido (full) fuerza la foto completa aunque la última sea reciente', async () => {
    const calls = stubBackend({ products: [catalogProduct('p1')], customers: [] });
    await runSyncCycle();
    calls.length = 0;

    await runSyncCycle({ full: true });

    expect(calls).toContain('GET /products');
    expect(calls.some((call) => call.includes('since'))).toBe(false);
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
        const items = body.action === 'pullProducts' ? [catalogProduct('p1')] : [];
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ ok: true, data: { items } }),
        } as Response);
      }),
    );

    await runSyncCycle();
    await db.products.put(catalogProduct('p-fantasma'));
    await runSyncCycle();

    expect(await db.products.toCollection().primaryKeys()).toEqual(['p1']);
    expect(requests.filter((request) => request.action === 'pullProducts')).toHaveLength(2);
    expect(JSON.stringify(requests)).not.toContain('since');
  });

  it('si una de las tres partes falla, no se aplica nada: ni upsert ni borrado, ni lastFullSyncAt', async () => {
    await db.products.bulkPut([catalogProduct('p1'), catalogProduct('p2')]);
    stubBackend({ products: [catalogProduct('p1')], customers: [], failCustomers: true });

    await runSyncCycle();

    expect(await db.products.toCollection().primaryKeys()).toEqual(['p1', 'p2']);
    expect(getLastFullSyncAt()).toBeUndefined();
    expect(syncStatusSignal.value).toBe('sync-error');
    expect(lastSyncFailureSignal.value).toMatchObject({ ok: false, error: 'sync/request-failed' });
  });

  it('un catálogo vacío con datos locales se conserva, se avisa y la foto queda pendiente', async () => {
    await db.products.bulkPut([catalogProduct('p1'), catalogProduct('p2')]);
    stubBackend({ products: [], customers: [] });

    await runSyncCycle();

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
