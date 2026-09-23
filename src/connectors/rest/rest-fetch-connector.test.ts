import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Customer } from '../../domain/customer.ts';
import type { Sale } from '../../domain/sale.ts';
import type { ConnectorProduct, OutboxBatchItem } from '../../sync/connector.ts';
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

const now = '2026-01-01T00:00:00.000Z';

const product: ConnectorProduct = {
  id: 'p1',
  sku: 'SKU-1',
  barcodes: ['111'],
  name: 'Arroz 1kg',
  price: 100,
  taxRate: 0.21,
  category: 'almacen',
  tracksStock: true,
  createdAt: now,
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
    const batch = {
      deviceId: 'dev-1',
      events: [
        { type: 'sale', id: 'sale-1', createdAt: now, origin: {}, sale },
        { type: 'customer', id: 'c1', createdAt: now, origin: { branch: 'Centro' }, customer },
      ] satisfies OutboxBatchItem[],
    };

    const result = await connector.pushBatch(batch, 'lot-1');

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/sync/push');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Idempotency-Key': 'lot-1',
      Authorization: 'Bearer secret-key',
    });
    expect(JSON.parse(init.body as string)).toEqual(batch);
  });

  it('devuelve sync/request-failed con el status si el servidor responde error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 })));
    const connector = createRestFetchConnector(config);

    const result = await connector.pushBatch(
      {
        deviceId: 'dev-1',
        events: [{ type: 'sale', id: 'sale-1', createdAt: now, origin: {}, sale }],
      },
      'lot-1',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toMatchObject({ status: 500 });
    }
  });

  it('devuelve sync/request-failed si fetch rechaza (sin red)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const connector = createRestFetchConnector(config);

    const result = await connector.pushBatch(
      {
        deviceId: 'dev-1',
        events: [{ type: 'sale', id: 'sale-1', createdAt: now, origin: {}, sale }],
      },
      'lot-1',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.meta).toMatchObject({ message: 'network down' });
    }
  });
});

describe('pullBatch', () => {
  it('hace POST a /sync/pull con cursors y pendingLotIds en el body, y parsea la respuesta', async () => {
    const stockItem = { productId: 'p1', quantity: 5, updatedAt: '2026-01-01T00:00:00.000Z' };
    const rawCustomer = {
      id: 'c1',
      name: 'Juan Pérez',
      createdAt: now,
      blocked: { reason: 'Deuda' },
      creditLimit: 1000,
      margin: 0,
      balance: 0,
    };
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

    const result = await connector.pullBatch({
      deviceId: 'dev-1',
      cursors: { products: 'cur-viejo' },
      pendingLotIds: ['lot-1'],
    });

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
      deviceId: 'dev-1',
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
          lots: {
            'lot-1': {
              status: 'issues',
              issues: [{ message: 'stock insuficiente', eventId: 'm1' }],
            },
          },
        }),
      ),
    );
    const connector = createRestFetchConnector(config);

    const result = await connector.pullBatch({
      deviceId: 'dev-1',
      cursors: {},
      pendingLotIds: ['lot-1'],
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        lots: {
          'lot-1': { status: 'issues', issues: [{ message: 'stock insuficiente', eventId: 'm1' }] },
        },
      }) as unknown,
    });
  });

  it('acepta los estados queued/processing y un producto bloqueado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          products: { items: [{ ...product, blocked: { reason: 'Sin proveedor' } }] },
          customers: { items: [] },
          stock: [],
          lots: { 'lot-1': { status: 'processing' }, 'lot-2': { status: 'queued' } },
        }),
      ),
    );
    const connector = createRestFetchConnector(config);

    const result = await connector.pullBatch({
      deviceId: 'dev-1',
      cursors: {},
      pendingLotIds: ['lot-1', 'lot-2'],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        products: { items: [{ id: 'p1', blocked: { reason: 'Sin proveedor' } }] },
        lots: { 'lot-1': { status: 'processing' }, 'lot-2': { status: 'queued' } },
      },
    });
  });

  it.each([
    ['un lote con el estado viejo pending', { lots: { x: { status: 'pending' } } }],
    ['un issue como texto (v2)', { lots: { x: { status: 'issues', issues: ['texto'] } } }],
  ])('%s es payload inválido', async (_label, overrides) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          products: { items: [] },
          customers: { items: [] },
          stock: [],
          ...overrides,
        }),
      ),
    );
    const connector = createRestFetchConnector(config);

    const result = await connector.pullBatch({ deviceId: 'dev-1', cursors: {}, pendingLotIds: [] });

    expect(result).toMatchObject({ ok: false, error: 'sync/invalid-payload' });
  });

  it('un producto sin fecha de alta es payload inválido (contrato v3)', async () => {
    const { createdAt: _omit, ...withoutDate } = product;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          products: { items: [withoutDate] },
          customers: { items: [] },
          stock: [],
          lots: {},
        }),
      ),
    );
    const connector = createRestFetchConnector(config);

    const result = await connector.pullBatch({ deviceId: 'dev-1', cursors: {}, pendingLotIds: [] });

    expect(result).toMatchObject({ ok: false, error: 'sync/invalid-payload' });
  });

  it('devuelve sync/invalid-payload si la respuesta no matchea el schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ products: { items: [{ id: 'p1' }] } })),
    );
    const connector = createRestFetchConnector(config);

    const result = await connector.pullBatch({ deviceId: 'dev-1', cursors: {}, pendingLotIds: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });

  it('devuelve sync/request-failed si el servidor responde error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 401 })));
    const connector = createRestFetchConnector(config);

    const result = await connector.pullBatch({ deviceId: 'dev-1', cursors: {}, pendingLotIds: [] });

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
