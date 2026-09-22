import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CashSession } from '../../domain/cash-session.ts';
import type { Customer } from '../../domain/customer.ts';
import type { Sale } from '../../domain/sale.ts';
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

describe('pullBatch', () => {
  it('llama a pullProducts y pullCustomers, fuerza tracksStock:false y unrestricted:true', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { action: string };
      if (body.action === 'pullProducts') {
        return Promise.resolve(
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
                tracksStock: true,
              },
            ],
          }),
        );
      }
      return Promise.resolve(bridgeOk({ items: [{ id: 'c1', name: 'Ana', phone: '1155' }] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: [] });

    expect(result).toEqual({
      ok: true,
      value: {
        products: {
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
        customers: { items: [{ id: 'c1', name: 'Ana', phone: '1155', unrestricted: true }] },
        stock: [],
        lots: {},
      },
    });
    expect(sentEnvelope(fetchMock, 0)).toEqual({ action: 'pullProducts', payload: {} });
    expect(sentEnvelope(fetchMock, 1)).toEqual({ action: 'pullCustomers', payload: {} });
  });

  it('informa ok para cada pendingLotId pedido, sin llamar a ningún endpoint de estado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bridgeOk({ items: [] })));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: ['lot-1', 'lot-2'] });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ lots: { 'lot-1': { status: 'ok' }, 'lot-2': { status: 'ok' } } }),
    });
  });

  it('devuelve sync/invalid-payload si un producto no cumple el schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bridgeOk({ items: [{ id: 'p1' }] })));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });

  it('propaga el error del puente y corta sin llamar a pullCustomers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeError('Planilla ocupada'));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/remote-error');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('pushBatch', () => {
  it('manda cada ítem al puente con su propia idempotencyKey, en orden', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushBatch(
      [
        { type: 'sale', id: 'sale-1', sale },
        { type: 'customer', id: 'c1', customer },
      ],
      'lot-1', // el lot id no se usa contra el puente — cada ítem sigue con el suyo propio
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(sentEnvelope(fetchMock, 0)).toEqual({ action: 'pushSale', payload: { sale }, idempotencyKey: 'sale-1' });
    expect(sentEnvelope(fetchMock, 1)).toEqual({
      action: 'pushCustomer',
      payload: { customer },
      idempotencyKey: 'c1',
    });
  });

  it('sale-void, account-hold-confirm y cash-session mandan la misma forma que antes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);
    const voidParams = { saleId: 'sale-1', voidedAt: '2026-01-02T00:00:00.000Z', voidReason: 'error de precio' };

    await connector.pushBatch(
      [
        { type: 'sale-void', id: 'void-1', ...voidParams },
        { type: 'account-hold-confirm', id: 'confirm-1', holdId: 'hold-1', saleId: 'sale-1' },
        { type: 'cash-session', id: 'cs-1', session: cashSession },
      ],
      'lot-2',
    );

    expect(sentEnvelope(fetchMock, 0)).toEqual({
      action: 'pushSaleVoid',
      payload: voidParams,
      idempotencyKey: 'void-1',
    });
    expect(sentEnvelope(fetchMock, 1)).toEqual({
      action: 'pushAccountHoldConfirm',
      payload: { holdId: 'hold-1', saleId: 'sale-1' },
      idempotencyKey: 'confirm-1',
    });
    expect(sentEnvelope(fetchMock, 2)).toEqual({
      action: 'pushCashSession',
      payload: { session: cashSession },
      idempotencyKey: 'cs-1',
    });
  });

  it('stock-movement y account-hold-release son no-ops: no llaman al puente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushBatch(
      [
        {
          type: 'stock-movement',
          id: 'm1',
          movement: { id: 'm1', productId: 'p1', delta: -1, reason: 'sale', createdAt: '2026-01-01T00:00:00.000Z' },
        },
        { type: 'account-hold-release', id: 'release-1', holdId: 'hold-1' },
      ],
      'lot-3',
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('corta en el primer error del puente, sin mandar los ítems siguientes', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(bridgeError('Venta no encontrada'));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushBatch(
      [
        { type: 'sale', id: 'sale-1', sale },
        { type: 'customer', id: 'c1', customer },
      ],
      'lot-4',
    );

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un push devuelve sync/request-failed si no hay red', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushBatch([{ type: 'sale', id: 'sale-1', sale }], 'lot-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toMatchObject({ message: 'network down' });
    }
  });
});

describe('requestAccountHold (sin red)', () => {
  it('aprueba siempre con un holdId nuevo y no llama a fetch', async () => {
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
        expect(first.value.holdId).not.toBe(second.value.holdId);
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
