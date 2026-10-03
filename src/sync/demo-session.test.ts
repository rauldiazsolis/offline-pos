import { afterEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '../domain/result.ts';
import { requestDemoSession } from './demo-session.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status text',
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
    expect(headers['X-POS-Contract-Version']).toBe('4.5.0');
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
