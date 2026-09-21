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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pushSale', () => {
  it('hace POST a /sales con Idempotency-Key y Authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createRestFetchConnector(config);

    const result = await connector.pushSale(sale, 'sale-1');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/sales');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Idempotency-Key': 'sale-1',
      Authorization: 'Bearer secret-key',
    });
    expect(init.body).toBe(JSON.stringify(sale));
  });

  it('devuelve sync/request-failed con el status si el servidor responde error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 })));
    const connector = createRestFetchConnector(config);

    const result = await connector.pushSale(sale, 'sale-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toMatchObject({ status: 500 });
    }
  });

  it('devuelve sync/request-failed si fetch rechaza (sin red)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const connector = createRestFetchConnector(config);

    const result = await connector.pushSale(sale, 'sale-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toMatchObject({ message: 'network down' });
    }
  });
});

describe('pushSaleVoid', () => {
  it('hace POST a /sales/{id}/void', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createRestFetchConnector(config);

    await connector.pushSaleVoid(
      { saleId: 'sale-1', voidedAt: '2026-01-02T00:00:00.000Z' },
      'void-1',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/sales/sale-1/void',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('pullProducts', () => {
  it('parsea la respuesta y arma el cursor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ items: [product], nextCursor: 'cursor-2' })),
    );
    const connector = createRestFetchConnector(config);

    const result = await connector.pullProducts({ since: 'cursor-1' });

    expect(result).toEqual({ ok: true, value: { items: [product], nextCursor: 'cursor-2' } });
  });

  it('manda el since como query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createRestFetchConnector(config);

    await connector.pullProducts({ since: 'cursor-1' });

    const calledUrl = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(calledUrl.searchParams.get('since')).toBe('cursor-1');
  });

  it('devuelve sync/invalid-payload si la respuesta no matchea el schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [{ id: 'p1' }] })));
    const connector = createRestFetchConnector(config);

    const result = await connector.pullProducts({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });
});

const customer: Customer = { id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' };

describe('pullCustomers', () => {
  it('parsea la respuesta y arma el cursor', async () => {
    const raw = { id: 'c1', name: 'Juan Pérez', creditLimit: 1000, margin: 0, balance: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ items: [raw], nextCursor: 'cursor-2' })),
    );
    const connector = createRestFetchConnector(config);

    const result = await connector.pullCustomers({ since: 'cursor-1' });

    expect(result).toEqual({ ok: true, value: { items: [raw], nextCursor: 'cursor-2' } });
  });

  it('devuelve sync/invalid-payload si la respuesta no matchea el schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [{ id: 'c1' }] })));
    const connector = createRestFetchConnector(config);

    const result = await connector.pullCustomers({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });
});

describe('pushCustomer', () => {
  it('hace POST a /customers con Idempotency-Key = id del cliente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createRestFetchConnector(config);

    await connector.pushCustomer(customer, 'c1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/customers');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Idempotency-Key': 'c1' });
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

describe('pushAccountHoldConfirm', () => {
  it('hace POST a /account-holds/{holdId}/confirm con el saleId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createRestFetchConnector(config);

    await connector.pushAccountHoldConfirm({ holdId: 'hold-1', saleId: 'sale-1' }, 'confirm-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/account-holds/hold-1/confirm');
    expect(init.body).toBe(JSON.stringify({ saleId: 'sale-1' }));
  });
});

describe('releaseAccountHold', () => {
  it('hace DELETE a /account-holds/{holdId}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createRestFetchConnector(config);

    await connector.releaseAccountHold({ holdId: 'hold-1' }, 'release-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/account-holds/hold-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('pushCashSession', () => {
  it('hace POST a /cash-sessions con el turno cerrado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createRestFetchConnector(config);
    const session = {
      id: 'cs1',
      openedAt: '2026-01-01T09:00:00.000Z',
      closedAt: '2026-01-01T20:00:00.000Z',
      openingAmount: 500,
      closingAmount: 600,
      sales: ['s1'],
    };

    await connector.pushCashSession(session, 'cs1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/cash-sessions');
    expect(init.body).toBe(JSON.stringify(session));
  });
});

describe('pullStock', () => {
  it('parsea un array de StockItem', async () => {
    const stockItem = { productId: 'p1', quantity: 5, updatedAt: '2026-01-01T00:00:00.000Z' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([stockItem])));
    const connector = createRestFetchConnector(config);

    const result = await connector.pullStock();

    expect(result).toEqual({ ok: true, value: [stockItem] });
  });
});
