import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Customer } from '../../domain/customer.ts';
import type { Product } from '../../domain/product.ts';
import type { Sale } from '../../domain/sale.ts';
import { createRestFetchConnector } from './rest-fetch-connector.ts';

const config = { baseUrl: 'https://api.example.com', apiKey: 'secret-key' };

function jsonResponse(body: unknown, init?: { status?: number; ok?: boolean }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: 'status text',
    json: () => Promise.resolve(body),
  } as Response;
}

const product: Product = {
  id: 'p1',
  sku: 'SKU-1',
  barcodes: ['111'],
  name: 'Arroz 1kg',
  price: 100,
  taxRate: 0.21,
  category: 'almacen',
  tracksStock: true,
};

const sale: Sale = {
  id: 'sale-1',
  lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }],
  payments: [{ method: 'cash', amount: 100 }],
  total: 100,
  status: 'closed',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const customer: Customer = { id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pushBatch', () => {
  it('hace POST a /sync/push con Idempotency-Key = idempotencyId y todos los items en el body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createRestFetchConnector(config);
    const items = [
      { type: 'sale' as const, id: 'sale-1', sale },
      { type: 'customer' as const, id: 'c1', customer },
    ];

    const result = await connector.pushBatch(items, 'lot-1');

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/sync/push');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Idempotency-Key': 'lot-1', Authorization: 'Bearer secret-key' });
    expect(init.body).toBe(JSON.stringify({ events: items }));
  });

  it('devuelve sync/request-failed con el status si el servidor responde error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 })));
    const connector = createRestFetchConnector(config);

    const result = await connector.pushBatch([{ type: 'sale', id: 'sale-1', sale }], 'lot-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toMatchObject({ status: 500 });
    }
  });

  it('devuelve sync/request-failed si fetch rechaza (sin red)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const connector = createRestFetchConnector(config);

    const result = await connector.pushBatch([{ type: 'sale', id: 'sale-1', sale }], 'lot-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.meta).toMatchObject({ message: 'network down' });
    }
  });
});

describe('pullBatch', () => {
  it('hace POST a /sync/pull con cursors y pendingLotIds en el body, y parsea la respuesta', async () => {
    const stockItem = { productId: 'p1', quantity: 5, updatedAt: '2026-01-01T00:00:00.000Z' };
    const rawCustomer = { id: 'c1', name: 'Juan Pérez', creditLimit: 1000, margin: 0, balance: 0 };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        products: { items: [product], nextCursor: 'cur-p' },
        customers: { items: [rawCustomer], nextCursor: 'cur-c' },
        stock: [stockItem],
        lots: { 'lot-1': { status: 'ok' } },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const connector = createRestFetchConnector(config);

    const result = await connector.pullBatch({ cursors: { products: 'cur-viejo' }, pendingLotIds: ['lot-1'] });

    expect(result).toEqual({
      ok: true,
      value: {
        products: { items: [product], nextCursor: 'cur-p' },
        customers: { items: [rawCustomer], nextCursor: 'cur-c' },
        stock: [stockItem],
        lots: { 'lot-1': { status: 'ok' } },
      },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/sync/pull');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      cursors: { products: 'cur-viejo' },
      pendingLotIds: ['lot-1'],
    });
  });

  it('propaga un lote con status issues tal cual', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          products: { items: [] },
          customers: { items: [] },
          stock: [],
          lots: { 'lot-1': { status: 'issues', issues: ['stock insuficiente'] } },
        }),
      ),
    );
    const connector = createRestFetchConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: ['lot-1'] });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        lots: { 'lot-1': { status: 'issues', issues: ['stock insuficiente'] } },
      }) as unknown,
    });
  });

  it('devuelve sync/invalid-payload si la respuesta no matchea el schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ products: { items: [{ id: 'p1' }] } })));
    const connector = createRestFetchConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });

  it('devuelve sync/request-failed si el servidor responde error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 401 })));
    const connector = createRestFetchConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toMatchObject({ status: 401 });
    }
  });
});

describe('requestAccountHold', () => {
  it('devuelve approved: true con el holdId si el backend aprueba', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ approved: true, holdId: 'hold-1' })),
    );
    const connector = createRestFetchConnector(config);

    const result = await connector.requestAccountHold({ customerId: 'c1', amount: 500 }, 'req-1');

    expect(result).toEqual({ ok: true, value: { approved: true, holdId: 'hold-1' } });
  });

  it('devuelve approved: false con el reasonCode si el backend rechaza', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ approved: false, reasonCode: 'over-limit' })),
    );
    const connector = createRestFetchConnector(config);

    const result = await connector.requestAccountHold({ customerId: 'c1', amount: 500 }, 'req-1');

    expect(result).toEqual({ ok: true, value: { approved: false, reasonCode: 'over-limit' } });
  });

  it('hace POST a /account-holds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ approved: true, holdId: 'hold-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createRestFetchConnector(config);

    await connector.requestAccountHold({ customerId: 'c1', amount: 500 }, 'req-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/account-holds',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
