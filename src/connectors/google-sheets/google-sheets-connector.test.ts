import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Customer } from '../../domain/customer.ts';
import type { Sale } from '../../domain/sale.ts';
import type { OutboxBatchItem, PushBatch } from '../../sync/connector.ts';
import type { GoogleSheetsConfig } from './config.ts';
import { createGoogleSheetsConnector } from './google-sheets-connector.ts';

const config: GoogleSheetsConfig = {
  type: 'google-sheets',
  webAppUrl: 'https://script.google.com/macros/s/abc/exec',
};

const now = '2026-01-01T00:00:00.000Z';

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
  createdAt: now,
};

const customer: Customer = { id: 'c1', name: 'Ana', createdAt: now };

const batch: PushBatch = {
  deviceId: 'dev-1',
  events: [
    { type: 'sale', id: 'sale-1', createdAt: now, origin: { branch: 'Centro' }, sale },
    { type: 'customer', id: 'c1', createdAt: now, origin: {}, customer },
  ],
};

const bridgeProduct = {
  id: 'p1',
  sku: 'SKU-1',
  barcodes: ['111'],
  name: 'Arroz 1kg',
  price: 100,
  taxRate: 0.21,
  category: 'almacen',
  createdAt: now,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pullBatch', () => {
  it('llama a pullBatch en una sola request, con deviceId, cursors y pendingLotIds, forzando tracksStock:false y unrestricted:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      bridgeOk({
        products: { items: [bridgeProduct], nextCursor: '2026-01-01T00:00:00.000Z' },
        customers: { items: [{ id: 'c1', name: 'Ana', phone: '1155', createdAt: now }] },
        lots: { 'lot-1': { status: 'ok' } },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({
      deviceId: 'dev-1',
      cursors: { products: 'cursor-p', customers: 'cursor-c' },
      pendingLotIds: ['lot-1'],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        products: {
          items: [{ ...bridgeProduct, tracksStock: false }],
          nextCursor: '2026-01-01T00:00:00.000Z',
        },
        customers: {
          items: [{ id: 'c1', name: 'Ana', phone: '1155', createdAt: now, unrestricted: true }],
        },
        stock: [],
        lots: { 'lot-1': { status: 'ok' } },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEnvelope(fetchMock, 0)).toEqual({
      action: 'pullBatch',
      contractVersion: '4.0.0',
      payload: {
        deviceId: 'dev-1',
        cursors: { products: 'cursor-p', customers: 'cursor-c' },
        pendingLotIds: ['lot-1'],
      },
    });
  });

  it('sin nextCursor en la respuesta, no lo agrega (exactOptionalPropertyTypes)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          bridgeOk({ products: { items: [] }, customers: { items: [] }, lots: {} }),
        ),
    );
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ deviceId: 'dev-1', cursors: {}, pendingLotIds: [] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.products).toEqual({ items: [] });
      expect(result.value.customers).toEqual({ items: [] });
    }
  });

  it('trae alta, bloqueo (con motivo vacío) e issues con eventId (contrato v3)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        bridgeOk({
          products: { items: [{ ...bridgeProduct, blocked: { reason: '' } }] },
          customers: { items: [] },
          lots: {
            'lot-1': {
              status: 'issues',
              issues: [{ message: 'Venta no encontrada: x', eventId: 'e1' }, { message: 'y' }],
            },
          },
        }),
      ),
    );
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({
      deviceId: 'dev-1',
      cursors: {},
      pendingLotIds: ['lot-1'],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        products: { items: [{ tracksStock: false, createdAt: now, blocked: { reason: '' } }] },
        lots: {
          'lot-1': {
            status: 'issues',
            issues: [{ message: 'Venta no encontrada: x', eventId: 'e1' }, { message: 'y' }],
          },
        },
      },
    });
  });

  it('devuelve sync/invalid-payload si un producto no trae su fecha de alta', async () => {
    const { createdAt: _omit, ...withoutDate } = bridgeProduct;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          bridgeOk({ products: { items: [withoutDate] }, customers: { items: [] }, lots: {} }),
        ),
    );
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ deviceId: 'dev-1', cursors: {}, pendingLotIds: [] });

    expect(result).toMatchObject({ ok: false, error: 'sync/invalid-payload' });
  });

  it('devuelve sync/invalid-payload si un producto no cumple el schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          bridgeOk({ products: { items: [{ id: 'p1' }] }, customers: { items: [] }, lots: {} }),
        ),
    );
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ deviceId: 'dev-1', cursors: {}, pendingLotIds: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });

  it('propaga el error del puente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeError('Planilla ocupada'));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ deviceId: 'dev-1', cursors: {}, pendingLotIds: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/remote-error');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('pushBatch', () => {
  it('manda todo el lote en una sola request, con deviceId y el idempotencyId del lote', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushBatch(batch, 'lot-1');

    expect(result).toEqual({ ok: true, value: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEnvelope(fetchMock, 0)).toEqual({
      action: 'pushBatch',
      contractVersion: '4.0.0',
      payload: batch,
      idempotencyKey: 'lot-1',
    });
  });

  it('manda los 8 tipos de evento v3 tal cual, incluidos los que son no-ops del lado de Sheets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);
    const envelope = { createdAt: now, origin: {} };
    const allEvents: OutboxBatchItem[] = [
      { type: 'sale', id: 'sale-1', ...envelope, sale },
      { type: 'customer', id: 'c1', ...envelope, customer },
      {
        type: 'account-hold-confirm',
        id: 'confirm-1',
        ...envelope,
        holdId: 'hold-1',
        saleId: 'sale-1',
      },
      { type: 'account-hold-release', id: 'release-1', ...envelope, holdId: 'hold-1' },
      {
        type: 'stock-movement',
        id: 'm1',
        ...envelope,
        movement: { id: 'm1', productId: 'p1', delta: -1, reason: 'sale', createdAt: now },
      },
      {
        type: 'cash-movement',
        id: 'cm1',
        ...envelope,
        movement: {
          id: 'cm1',
          direction: 'out',
          amount: 50,
          concept: 'Flete',
          source: 'manual',
          createdAt: now,
        },
      },
      {
        type: 'customer-payment',
        id: 'cp1',
        ...envelope,
        payment: {
          id: 'cp1',
          customerId: 'c1',
          payments: [{ method: 'cash', amount: 10 }],
          total: 10,
          createdAt: now,
        },
      },
    ];

    await connector.pushBatch({ deviceId: 'dev-1', events: allEvents }, 'lot-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEnvelope(fetchMock, 0)).toEqual({
      action: 'pushBatch',
      contractVersion: '4.0.0',
      payload: { deviceId: 'dev-1', events: allEvents },
      idempotencyKey: 'lot-1',
    });
  });

  it('propaga el error del puente sin reintentar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeError('Planilla ocupada'));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushBatch(batch, 'lot-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/remote-error');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un push devuelve sync/request-failed si no hay red', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushBatch(batch, 'lot-1');

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

describe('getInfo (#99)', () => {
  it('llama la acción info y devuelve la versión y el estado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      bridgeOk({
        contractVersion: '4.0.0',
        status: 'ok',
        backend: { name: 'pos-sheets-bridge', version: '4.0.0' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createGoogleSheetsConnector(config).getInfo();

    expect(result).toEqual({
      ok: true,
      value: {
        contractVersion: '4.0.0',
        status: 'ok',
        backend: { name: 'pos-sheets-bridge', version: '4.0.0' },
      },
    });
    expect(sentEnvelope(fetchMock, 0)).toMatchObject({ action: 'info', contractVersion: '4.0.0' });
  });
});
