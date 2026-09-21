import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CashSession } from '../../domain/cash-session.ts';
import type { Customer } from '../../domain/customer.ts';
import type { Sale } from '../../domain/sale.ts';
import type { StockMovement } from '../../domain/stock.ts';
import type { GoogleSheetsConfig } from './config.ts';
import { createGoogleSheetsConnector } from './google-sheets-connector.ts';

const config: GoogleSheetsConfig = {
  type: 'google-sheets',
  webAppUrl: 'https://script.google.com/macros/s/abc/exec',
};

function bridgeOk(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ ok: true, data }),
  } as Response;
}

function bridgeError(error: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ ok: false, error }),
  } as Response;
}

/** Devuelve el envelope enviado en la llamada `index` del mock de fetch. */
function sentEnvelope(fetchMock: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

const sale: Sale = {
  id: 'sale-1',
  lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }],
  payments: [{ method: 'cash', amount: 100 }],
  total: 100,
  status: 'closed',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const customer: Customer = { id: 'c1', name: 'Ana', createdAt: '2026-01-01T00:00:00.000Z' };

const cashSession: CashSession = {
  id: 'cs-1',
  openedAt: '2026-01-01T08:00:00.000Z',
  closedAt: '2026-01-01T20:00:00.000Z',
  openingAmount: 1000,
  closingAmount: 1100,
  sales: ['sale-1'],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pullProducts', () => {
  it('llama a la acción pullProducts con since y fuerza tracksStock: false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      bridgeOk({
        items: [
          {
            id: 'p1',
            sku: 'SKU-1',
            barcodes: ['111'],
            name: 'Arroz 1kg',
            price: 100,
            taxRate: 0.21,
            category: 'almacen',
            tracksStock: true, // aunque el puente mande true, el conector lo pisa
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullProducts({ since: 'cursor-1' });

    expect(sentEnvelope(fetchMock)).toEqual({
      action: 'pullProducts',
      payload: { since: 'cursor-1' },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        items: [
          {
            id: 'p1',
            sku: 'SKU-1',
            barcodes: ['111'],
            name: 'Arroz 1kg',
            price: 100,
            taxRate: 0.21,
            category: 'almacen',
            tracksStock: false,
          },
        ],
      },
    });
  });

  it('no manda since si no hay, y nunca devuelve nextCursor (pull completo)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullProducts({});

    expect(sentEnvelope(fetchMock)).toEqual({ action: 'pullProducts', payload: {} });
    expect(result).toEqual({ ok: true, value: { items: [] } });
  });

  it('devuelve sync/invalid-payload si un producto no cumple el schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bridgeOk({ items: [{ id: 'p1' }] })));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullProducts({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });

  it('propaga el error del puente', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bridgeError('Planilla ocupada')));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullProducts({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toEqual({ message: 'Planilla ocupada' });
    }
  });
});

describe('pullCustomers', () => {
  it('llama a la acción pullCustomers y devuelve los clientes tal cual (sin unrestricted, eso es Etapa 3)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(bridgeOk({ items: [{ id: 'c1', name: 'Ana', phone: '1155' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullCustomers({});

    expect(sentEnvelope(fetchMock)).toEqual({ action: 'pullCustomers', payload: {} });
    expect(result).toEqual({
      ok: true,
      value: { items: [{ id: 'c1', name: 'Ana', phone: '1155' }] },
    });
  });

  it('devuelve sync/invalid-payload si un cliente no tiene name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bridgeOk({ items: [{ id: 'c1' }] })));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullCustomers({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });
});

describe('operaciones locales (sin red)', () => {
  it('requestAccountHold aprueba siempre con un holdId nuevo y no llama a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const first = await connector.requestAccountHold({ customerId: 'c1', amount: 500 }, 'k1');
    const second = await connector.requestAccountHold({ customerId: 'c1', amount: 500 }, 'k2');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.approved).toBe(true);
      expect(second.value.approved).toBe(true);
      if (first.value.approved && second.value.approved) {
        expect(first.value.holdId.length).toBeGreaterThan(0);
        expect(first.value.holdId).not.toBe(second.value.holdId);
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('releaseAccountHold, pullStock y pushStockMovement son no-ops sin red', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);
    const movement: StockMovement = {
      id: 'm1',
      productId: 'p1',
      delta: -1,
      reason: 'sale',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    expect(await connector.releaseAccountHold({ holdId: 'h1' }, 'k')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await connector.pullStock()).toEqual({ ok: true, value: [] });
    expect(await connector.pushStockMovement(movement, 'k')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('pushes', () => {
  it('pushSale manda { sale } con la idempotencyKey del motor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushSale(sale, 'sale-1');

    expect(result).toEqual({ ok: true, value: undefined });
    expect(sentEnvelope(fetchMock)).toEqual({
      action: 'pushSale',
      payload: { sale },
      idempotencyKey: 'sale-1',
    });
  });

  it('pushSaleVoid manda { saleId, voidedAt, voidReason } con su propia key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);
    const params = {
      saleId: 'sale-1',
      voidedAt: '2026-01-02T00:00:00.000Z',
      voidReason: 'error de precio',
    };

    const result = await connector.pushSaleVoid(params, 'void-key-1');

    expect(result).toEqual({ ok: true, value: undefined });
    expect(sentEnvelope(fetchMock)).toEqual({
      action: 'pushSaleVoid',
      payload: params,
      idempotencyKey: 'void-key-1',
    });
  });

  it('pushCustomer manda { customer }', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushCustomer(customer, 'c1');

    expect(result).toEqual({ ok: true, value: undefined });
    expect(sentEnvelope(fetchMock)).toEqual({
      action: 'pushCustomer',
      payload: { customer },
      idempotencyKey: 'c1',
    });
  });

  it('pushAccountHoldConfirm manda solo { holdId, saleId } (el puente deriva cliente y monto)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushAccountHoldConfirm(
      { holdId: 'hold-1', saleId: 'sale-1' },
      'confirm-key-1',
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(sentEnvelope(fetchMock)).toEqual({
      action: 'pushAccountHoldConfirm',
      payload: { holdId: 'hold-1', saleId: 'sale-1' },
      idempotencyKey: 'confirm-key-1',
    });
  });

  it('pushCashSession manda { session }', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushCashSession(cashSession, 'cs-1');

    expect(result).toEqual({ ok: true, value: undefined });
    expect(sentEnvelope(fetchMock)).toEqual({
      action: 'pushCashSession',
      payload: { session: cashSession },
      idempotencyKey: 'cs-1',
    });
  });

  it('un push propaga el error del puente como sync/request-failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bridgeError('Venta no encontrada: sale-1')));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushAccountHoldConfirm({ holdId: 'h', saleId: 'sale-1' }, 'k');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toEqual({ message: 'Venta no encontrada: sale-1' });
    }
  });

  it('un push devuelve sync/request-failed si no hay red', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushSale(sale, 'sale-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toMatchObject({ message: 'network down' });
    }
  });
});
