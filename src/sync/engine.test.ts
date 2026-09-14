import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '../domain/result.ts';
import { db } from '../storage/db.ts';
import { setCatalogRepository } from '../ui/state/catalog.ts';
import {
  pendingOutboxCountSignal,
  syncConfiguredSignal,
  syncStatusSignal,
} from '../ui/state/sync.ts';
import type { AccountHoldResult, Connector, ConnectorCustomer, ConnectorPullResult } from './connector.ts';
import { saveSyncConfig } from './config.ts';
import { getCustomersCursor, getProductsCursor } from './cursor.ts';
import { runSyncCycle, syncOnce } from './engine.ts';
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

  it('no rompe el ciclo si el pull falla', async () => {
    const pullProducts = vi
      .fn<Connector['pullProducts']>()
      .mockResolvedValue(err('sync/request-failed', { message: 'down' }));

    await expect(syncOnce(fakeConnector({ pullProducts }), now)).resolves.toBeUndefined();
    expect(syncStatusSignal.value).toBe('online-idle');
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

  it('sin config guardada, marca syncConfigured en false', async () => {
    await runSyncCycle();

    expect(syncConfiguredSignal.value).toBe(false);
  });

  it('con config guardada, arma el conector real y corre un ciclo', async () => {
    saveSyncConfig({ baseUrl: 'https://api.example.com' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ items: [] }),
      }),
    );

    await runSyncCycle();

    expect(syncConfiguredSignal.value).toBe(true);
    expect(syncStatusSignal.value).toBe('online-idle');
  });

  it('no arranca un segundo ciclo si el anterior sigue en curso (issue #1)', async () => {
    saveSyncConfig({ baseUrl: 'https://api.example.com' });

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
