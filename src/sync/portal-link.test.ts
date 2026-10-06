import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestPortalLink } from './portal-link.ts';

const config = { type: 'rest' as const, baseUrl: 'https://b.x', apiKey: 'k1' };
const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestPortalLink (4.6.0, #179)', () => {
  it('201: devuelve la URL; manda la key y la versión, sin cuerpo', async () => {
    fetchMock.mockResolvedValue(
      json(201, { url: 'https://b.x/p/abc', expiresAt: '2026-10-04T12:01:00.000Z' }),
    );

    const result = await requestPortalLink(config);

    expect(result).toEqual({
      ok: true,
      value: { url: 'https://b.x/p/abc', expiresAt: '2026-10-04T12:01:00.000Z' },
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://b.x/portal-links');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer k1');
    expect(headers.get('X-POS-Contract-Version')).not.toBeNull();
  });

  it('también con el conector del minibackend de demo', async () => {
    fetchMock.mockResolvedValue(json(201, { url: 'http://localhost:4000/_demo/portal/abc' }));

    const result = await requestPortalLink({ ...config, type: 'rest-demo' });

    expect(result).toEqual({ ok: true, value: { url: 'http://localhost:4000/_demo/portal/abc' } });
  });

  it('expiresAt mal formado se ignora (es informativo)', async () => {
    fetchMock.mockResolvedValue(json(201, { url: 'https://b.x/p/abc', expiresAt: 3 }));

    expect(await requestPortalLink(config)).toEqual({
      ok: true,
      value: { url: 'https://b.x/p/abc' },
    });
  });

  it('una URL http a otro host es inválida', async () => {
    fetchMock.mockResolvedValue(json(201, { url: 'http://otro.x/p/abc' }));

    expect(await requestPortalLink(config)).toMatchObject({
      ok: false,
      error: 'sync/invalid-payload',
    });
  });

  it('401 → sync/request-failed con el status', async () => {
    fetchMock.mockResolvedValue(json(401, {}));

    expect(await requestPortalLink(config)).toMatchObject({
      ok: false,
      error: 'sync/request-failed',
      meta: { status: 401 },
    });
  });

  it('404 → portal/not-offered', async () => {
    fetchMock.mockResolvedValue(json(404, {}));

    expect(await requestPortalLink(config)).toMatchObject({ error: 'portal/not-offered' });
  });

  it('409 incompatible → sync/incompatible-contract', async () => {
    fetchMock.mockResolvedValue(
      json(409, { code: 'incompatible-contract', contractVersion: '5.0.0' }),
    );

    expect(await requestPortalLink(config)).toMatchObject({
      error: 'sync/incompatible-contract',
      meta: { backend: '5.0.0' },
    });
  });

  it('503 → mantenimiento, con el message si vino', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { code: 'maintenance', message: 'Migrando' }));
    expect(await requestPortalLink(config)).toEqual({
      ok: false,
      error: 'sync/backend-maintenance',
      meta: { message: 'Migrando' },
    });

    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    expect(await requestPortalLink(config)).toEqual({
      ok: false,
      error: 'sync/backend-maintenance',
      meta: {},
    });
  });

  it('sin red → sync/request-failed sin status', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await requestPortalLink(config)).toEqual({
      ok: false,
      error: 'sync/request-failed',
      meta: { message: 'Failed to fetch' },
    });
  });
});

describe('requestPortalLink con el puente de Google Sheets (4.6.0)', () => {
  const sheets = {
    type: 'google-sheets' as const,
    webAppUrl: 'https://script.google.com/macros/s/x/exec',
    sharedSecret: 's1',
  };

  it('pide la acción portalLink al puente, con el secreto, y devuelve la URL de la planilla', async () => {
    fetchMock.mockResolvedValue(
      json(200, { ok: true, data: { url: 'https://docs.google.com/spreadsheets/d/abc/edit' } }),
    );

    const result = await requestPortalLink(sheets);

    expect(result).toEqual({
      ok: true,
      value: { url: 'https://docs.google.com/spreadsheets/d/abc/edit' },
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(sheets.webAppUrl);
    expect(JSON.parse(init?.body as string)).toMatchObject({
      action: 'portalLink',
      sharedSecret: 's1',
    });
  });

  it('un error del puente llega con su mensaje', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: false, error: 'Secreto compartido inválido' }));

    expect(await requestPortalLink(sheets)).toEqual({
      ok: false,
      error: 'sync/remote-error',
      meta: { message: 'Secreto compartido inválido' },
    });
  });

  it('una URL que no es https es inválida', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, data: { url: 'http://otro.x/planilla' } }));

    expect(await requestPortalLink(sheets)).toMatchObject({ error: 'sync/invalid-payload' });
  });
});
