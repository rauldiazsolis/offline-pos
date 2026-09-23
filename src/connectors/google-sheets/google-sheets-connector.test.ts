import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CashSession } from '../../domain/cash-session.ts';
import type { Customer } from '../../domain/customer.ts';
import type { Sale } from '../../domain/sale.ts';
import type { OutboxBatchItem } from '../../sync/connector.ts';
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

const events: OutboxBatchItem[] = [
  { type: 'sale', id: 'sale-1', sale },
  { type: 'customer', id: 'c1', customer },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pullBatch', () => {
  it('llama a pullBatch en una sola request, con cursors y pendingLotIds, forzando tracksStock:false y unrestricted:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      bridgeOk({
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
            },
          ],
          nextCursor: '2026-01-01T00:00:00.000Z',
        },
        customers: { items: [{ id: 'c1', name: 'Ana', phone: '1155' }] },
        lots: { 'lot-1': { status: 'ok' } },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({
      cursors: { products: 'cursor-p', customers: 'cursor-c' },
      pendingLotIds: ['lot-1'],
    });

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
          nextCursor: '2026-01-01T00:00:00.000Z',
        },
        customers: { items: [{ id: 'c1', name: 'Ana', phone: '1155', unrestricted: true }] },
        stock: [],
        lots: { 'lot-1': { status: 'ok' } },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEnvelope(fetchMock, 0)).toEqual({
      action: 'pullBatch',
      payload: { cursors: { products: 'cursor-p', customers: 'cursor-c' }, pendingLotIds: ['lot-1'] },
    });
  });

  it('sin nextCursor en la respuesta, no lo agrega (exactOptionalPropertyTypes)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        bridgeOk({ products: { items: [] }, customers: { items: [] }, lots: {} }),
      ),
    );
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: [] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.products).toEqual({ items: [] });
      expect(result.value.customers).toEqual({ items: [] });
    }
  });

  it('pasa el estado de lote del puente tal cual, incluidas las issues', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        bridgeOk({
          products: { items: [] },
          customers: { items: [] },
          lots: { 'lot-1': { status: 'issues', issues: ['Venta no encontrada: x'] } },
        }),
      ),
    );
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: ['lot-1'] });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        lots: { 'lot-1': { status: 'issues', issues: ['Venta no encontrada: x'] } },
      }) as unknown,
    });
  });

  it('devuelve sync/invalid-payload si un producto no cumple el schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        bridgeOk({ products: { items: [{ id: 'p1' }] }, customers: { items: [] }, lots: {} }),
      ),
    );
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });

  it('propaga el error del puente', async () => {
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
  it('manda todo el lote en una sola request, con el idempotencyId del lote (no uno por ítem)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushBatch(events, 'lot-1');

    expect(result).toEqual({ ok: true, value: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEnvelope(fetchMock, 0)).toEqual({
      action: 'pushBatch',
      payload: { events },
      idempotencyKey: 'lot-1',
    });
  });

  it('manda los 7 tipos de evento tal cual, incluidos los que son no-ops del lado de Sheets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);
    const allEvents: OutboxBatchItem[] = [
      { type: 'sale', id: 'sale-1', sale },
      {
        type: 'sale-void',
        id: 'void-1',
        saleId: 'sale-1',
        voidedAt: '2026-01-02T00:00:00.000Z',
        voidReason: 'error de precio',
      },
      { type: 'customer', id: 'c1', customer },
      { type: 'account-hold-confirm', id: 'confirm-1', holdId: 'hold-1', saleId: 'sale-1' },
      { type: 'account-hold-release', id: 'release-1', holdId: 'hold-1' },
      { type: 'cash-session', id: 'cs-1', session: cashSession },
      {
        type: 'stock-movement',
        id: 'm1',
        movement: { id: 'm1', productId: 'p1', delta: -1, reason: 'sale', createdAt: '2026-01-01T00:00:00.000Z' },
      },
    ];

    await connector.pushBatch(allEvents, 'lot-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEnvelope(fetchMock, 0)).toEqual({
      action: 'pushBatch',
      payload: { events: allEvents },
      idempotencyKey: 'lot-1',
    });
  });

  it('propaga el error del puente sin reintentar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeError('Planilla ocupada'));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushBatch(events, 'lot-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/remote-error');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un push devuelve sync/request-failed si no hay red', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushBatch(events, 'lot-1');

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
