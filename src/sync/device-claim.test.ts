import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestClaim } from './device-claim.ts';

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const claimed = {
  apiKey: 'key-caja-2',
  branch: 'CENTRAL',
  pointOfSale: 'Caja 2',
  register: { name: 'Caja de la esquina' },
  company: { name: 'Kiosco Ana' },
};

describe('requestClaim (4.7.0, #230)', () => {
  it('200: la conexión de la caja; POST /claim sin key, con la versión y X-Device-Id', async () => {
    fetchMock.mockResolvedValue(json(200, claimed));

    const result = await requestClaim('https://b.x', 'tok-1', 'dev-1');

    expect(result).toEqual({ ok: true, value: claimed });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://b.x/claim');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ claimToken: 'tok-1' }));
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('X-Device-Id')).toBe('dev-1');
    expect(headers.get('X-POS-Contract-Version')).toBe('4.7.0');
  });

  it('sin company ni register (o mal formados) sigue andando', async () => {
    fetchMock.mockResolvedValue(
      json(200, { apiKey: 'k', branch: 'B', pointOfSale: 'P', company: { name: '' } }),
    );

    expect(await requestClaim('https://b.x', 'tok-1', 'dev-1')).toEqual({
      ok: true,
      value: { apiKey: 'k', branch: 'B', pointOfSale: 'P' },
    });
  });

  it('200 mal formado → sync/invalid-payload', async () => {
    fetchMock.mockResolvedValue(json(200, { branch: 'B' }));

    expect(await requestClaim('https://b.x', 'tok-1', 'dev-1')).toMatchObject({
      ok: false,
      error: 'sync/invalid-payload',
    });
  });

  it('404 claim-not-found → claim/not-found', async () => {
    fetchMock.mockResolvedValue(json(404, { code: 'claim-not-found', message: 'No existe.' }));

    expect(await requestClaim('https://b.x', 'tok-1', 'dev-1')).toEqual({
      ok: false,
      error: 'claim/not-found',
      meta: undefined,
    });
  });

  it('404 sin cuerpo o con otro code → claim/not-offered (backend sin claim)', async () => {
    fetchMock.mockResolvedValueOnce(json(404));
    fetchMock.mockResolvedValueOnce(json(404, { code: 'not-found' }));
    fetchMock.mockResolvedValueOnce(new Response('<html>Not Found</html>', { status: 404 }));

    for (let index = 0; index < 3; index++) {
      expect(await requestClaim('https://b.x', 'tok-1', 'dev-1')).toMatchObject({
        ok: false,
        error: 'claim/not-offered',
      });
    }
  });

  it('410 claim-expired → claim/expired (expired); claim-used → (used); otro → expired', async () => {
    fetchMock.mockResolvedValueOnce(json(410, { code: 'claim-expired' }));
    fetchMock.mockResolvedValueOnce(json(410, { code: 'claim-used' }));
    fetchMock.mockResolvedValueOnce(json(410, { code: 'otra-cosa' }));

    expect(await requestClaim('https://b.x', 't', 'd')).toEqual({
      ok: false,
      error: 'claim/expired',
      meta: { reason: 'expired' },
    });
    expect(await requestClaim('https://b.x', 't', 'd')).toEqual({
      ok: false,
      error: 'claim/expired',
      meta: { reason: 'used' },
    });
    expect(await requestClaim('https://b.x', 't', 'd')).toEqual({
      ok: false,
      error: 'claim/expired',
      meta: { reason: 'expired' },
    });
  });

  it('400 → sync/request-failed con el status y el message del backend', async () => {
    fetchMock.mockResolvedValue(
      json(400, { code: 'invalid-request', message: 'Falta el header X-Device-Id' }),
    );

    expect(await requestClaim('https://b.x', 't', 'd')).toEqual({
      ok: false,
      error: 'sync/request-failed',
      meta: { status: 400, message: 'Falta el header X-Device-Id' },
    });
  });

  it('409 de contrato → sync/incompatible-contract', async () => {
    fetchMock.mockResolvedValue(
      json(409, { code: 'incompatible-contract', contractVersion: '5.0.0' }),
    );

    expect(await requestClaim('https://b.x', 't', 'd')).toEqual({
      ok: false,
      error: 'sync/incompatible-contract',
      meta: { backend: '5.0.0', pos: '4.7.0' },
    });
  });

  it('503 → sync/backend-maintenance con el message', async () => {
    fetchMock.mockResolvedValue(json(503, { code: 'maintenance', message: 'Volvemos enseguida.' }));

    expect(await requestClaim('https://b.x', 't', 'd')).toEqual({
      ok: false,
      error: 'sync/backend-maintenance',
      meta: { message: 'Volvemos enseguida.' },
    });
  });

  it('sin red → sync/request-failed sin status, sin reintentar', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await requestClaim('https://b.x', 't', 'd')).toEqual({
      ok: false,
      error: 'sync/request-failed',
      meta: { message: 'Failed to fetch' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
