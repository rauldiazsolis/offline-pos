import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../storage/db.ts';
import { backendCapabilitiesSignal, deviceRevokedSignal } from '../ui/state/sync.ts';
import { requestCashSnapshot, retakeCashFromSnapshot } from './cash-snapshot.ts';
import type { ConnectorConfig } from './connector-registry.ts';
import { getReceiptCounter, setReceiptCounter } from './receipt-counter.ts';
import { getTicketCounter, setTicketCounter } from './ticket-counter.ts';

const config: ConnectorConfig = { type: 'rest', baseUrl: 'https://b.x', apiKey: 'k1' };
const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

const wire = {
  generatedAt: '2026-11-19T15:00:00.000Z',
  lastTicket: { date: '2026-11-19', number: 12 },
  lastReceipt: { date: '2026-11-19', number: 3 },
  recentSales: [
    {
      id: 's1',
      lines: [{ kind: 'freeform', description: 'Algo', qty: 1, unitPrice: 100 }],
      payments: [{ method: 'cash', amount: 100 }],
      total: 100,
      status: 'closed',
      createdAt: '2026-11-19T11:00:00.000Z',
      ticket: { date: '2026-11-19', number: 12 },
      origin: { branch: 'CENTRAL', pointOfSale: 'Caja 1' },
    },
  ],
  recentCustomerPayments: [],
  cashAnchor: { countedAt: '2026-11-19T10:00:00.000Z', amount: 500 },
  cashMovements: [],
};

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  await db.open();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  backendCapabilitiesSignal.value = undefined;
  deviceRevokedSignal.value = undefined;
  db.close();
  await db.delete();
  localStorage.clear();
});

describe('requestCashSnapshot (4.7.0, #230)', () => {
  it('200: la foto en tipos del dominio; GET /snapshot con la key', async () => {
    fetchMock.mockResolvedValue(json(200, wire));

    const result = await requestCashSnapshot(config);

    expect(result.ok && result.value?.recentSales[0]?.id).toBe('s1');
    expect(result.ok && result.value?.cashAnchor).toEqual(wire.cashAnchor);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://b.x/snapshot');
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer k1');
  });

  it('X-Device-Id solo con device-claim', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, wire)));

    backendCapabilitiesSignal.value = ['device-claim', 'cash-snapshot'];
    await requestCashSnapshot(config);
    backendCapabilitiesSignal.value = ['cash-snapshot'];
    await requestCashSnapshot(config);

    const deviceIds = fetchMock.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('X-Device-Id'),
    );
    expect(deviceIds).toEqual(['test-device-id', null]);
  });

  it('404 → sin foto (ok undefined)', async () => {
    fetchMock.mockResolvedValue(json(404, { code: 'snapshot-not-available' }));

    expect(await requestCashSnapshot(config)).toEqual({ ok: true, value: undefined });
  });

  it('mal formada → sync/invalid-payload; 500 → sync/request-failed', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { recentSales: 'no' }));
    fetchMock.mockResolvedValueOnce(json(500, {}));

    expect(await requestCashSnapshot(config)).toMatchObject({ error: 'sync/invalid-payload' });
    expect(await requestCashSnapshot(config)).toMatchObject({
      error: 'sync/request-failed',
      meta: { status: 500 },
    });
  });

  it('409 device-revoked marca la caja', async () => {
    fetchMock.mockResolvedValue(json(409, { code: 'device-revoked' }));

    expect(await requestCashSnapshot(config)).toMatchObject({ error: 'sync/device-revoked' });
    expect(deviceRevokedSignal.value).not.toBeUndefined();
  });

  it('Google Sheets no tiene foto: no pide nada', async () => {
    const result = await requestCashSnapshot({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/x/exec',
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('retakeCashFromSnapshot (4.7.0, #230)', () => {
  it('sin la capacidad no pide nada', async () => {
    expect(await retakeCashFromSnapshot(config, ['device-claim'])).toEqual({ kind: 'not-offered' });
    expect(await retakeCashFromSnapshot(config, undefined)).toEqual({ kind: 'not-offered' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hidrata y sube los contadores', async () => {
    fetchMock.mockResolvedValue(json(200, wire));

    const outcome = await retakeCashFromSnapshot(config, ['cash-snapshot']);

    expect(outcome).toEqual({
      kind: 'applied',
      hydration: {
        kind: 'hydrated',
        sales: 1,
        customerPayments: 0,
        cashMovements: 0,
        cashCount: true,
      },
    });
    expect(await db.sales.count()).toBe(1);
    expect(getTicketCounter()).toEqual({ date: '2026-11-19', last: 12 });
    expect(getReceiptCounter()).toEqual({ date: '2026-11-19', last: 3 });
  });

  it('nunca baja un contador local más alto', async () => {
    setTicketCounter({ date: '2026-11-19', last: 20 });
    setReceiptCounter({ date: '2026-11-20', last: 1 });
    fetchMock.mockResolvedValue(json(200, wire));

    await retakeCashFromSnapshot(config, ['cash-snapshot']);

    expect(getTicketCounter()).toEqual({ date: '2026-11-19', last: 20 });
    expect(getReceiptCounter()).toEqual({ date: '2026-11-20', last: 1 });
  });

  it('un 404 o un fallo no cortan nada: la terminal arranca como una caja nueva', async () => {
    fetchMock.mockResolvedValueOnce(json(404));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect(await retakeCashFromSnapshot(config, ['cash-snapshot'])).toEqual({ kind: 'none' });
    expect(await retakeCashFromSnapshot(config, ['cash-snapshot'])).toEqual({
      kind: 'failed',
      error: 'sync/request-failed',
    });
    expect(await db.sales.count()).toBe(0);
  });
});
