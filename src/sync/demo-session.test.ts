import { afterEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '../domain/result.ts';
import { requestDemoSession } from './demo-session.ts';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status text',
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
  } as Response;
}

const session = {
  apiKey: 'demo-api-key',
  branch: 'CENTRAL',
  pointOfSale: 'Caja 1',
  template: 'almacen',
  onboarding: { url: 'https://b.x/alta', label: 'Crear mi comercio' },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestDemoSession (#128)', () => {
  it('201 válido: POST sin Authorization, con el header de versión y el template', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(session, 201));
    vi.stubGlobal('fetch', fetchMock);

    expect(await requestDemoSession('https://b.x', 'almacen')).toEqual(ok(session));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://b.x/demo-sessions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-POS-Contract-Version']).toBe('4.6.0');
    expect(headers).not.toHaveProperty('Authorization');
    expect(init.body).toBe('{"template":"almacen"}');
  });

  it('sin template manda {} y conserva baseUrl si viene', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ...session, baseUrl: 'https://api.b.x' }, 201));
    vi.stubGlobal('fetch', fetchMock);

    expect(await requestDemoSession('https://b.x')).toEqual(
      ok({ ...session, baseUrl: 'https://api.b.x' }),
    );
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].body).toBe('{}');
  });

  it('422 unknown-template → demo/unknown-template con la lista', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ code: 'unknown-template', templates: ['kiosco'] }, 422)),
    );
    expect(await requestDemoSession('https://b.x', 'nope')).toEqual(
      err('demo/unknown-template', { template: 'nope', templates: ['kiosco'] }),
    );
  });

  it('404 → demo/not-offered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 404)));
    expect(await requestDemoSession('https://b.x')).toEqual(err('demo/not-offered', undefined));
  });

  it('429 → demo/rate-limited con los segundos de Retry-After (4.6.0)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ code: 'rate-limited' }, 429, { 'Retry-After': '600' })),
    );
    expect(await requestDemoSession('https://b.x')).toEqual(
      err('demo/rate-limited', { retryAfterSeconds: 600 }),
    );
  });

  it('429 sin Retry-After, o con una fecha HTTP → demo/rate-limited sin segundos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(undefined, 429)));
    expect(await requestDemoSession('https://b.x')).toEqual(err('demo/rate-limited', {}));

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(undefined, 429, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }),
        ),
    );
    expect(await requestDemoSession('https://b.x')).toEqual(err('demo/rate-limited', {}));
  });

  it('503 demo-capacity → demo/capacity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 'demo-capacity', message: 'lleno' }, 503)),
    );
    expect(await requestDemoSession('https://b.x')).toEqual(err('demo/capacity', undefined));
  });

  it('503 maintenance → sync/backend-maintenance con su mensaje; sin cuerpo, sin mensaje', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: 'maintenance', message: 'Migrando' }, 503, { 'Retry-After': '30' }),
        ),
    );
    expect(await requestDemoSession('https://b.x')).toEqual(
      err('sync/backend-maintenance', { message: 'Migrando' }),
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(undefined, 503)));
    expect(await requestDemoSession('https://b.x')).toEqual(err('sync/backend-maintenance', {}));
  });

  it('500 → sync/request-failed con status; fetch que rechaza → sin status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    expect(await requestDemoSession('https://b.x')).toEqual(
      err('sync/request-failed', { status: 500, message: 'status text' }),
    );

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await requestDemoSession('https://b.x')).toEqual(
      err('sync/request-failed', { message: 'Failed to fetch' }),
    );
  });

  it('onboarding.url inseguro → sync/invalid-payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ ...session, onboarding: { url: 'http://b.x/alta', label: 'Crear' } }, 201),
        ),
    );
    const result = await requestDemoSession('https://b.x');
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toBe('sync/invalid-payload');
  });
});
