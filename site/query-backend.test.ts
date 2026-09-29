// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryBackend } from './query-backend.ts';

const NOW = new Date('2026-09-29T12:00:00.000Z');

const SESSION = {
  apiKey: 'k-123',
  branch: 'CENTRAL',
  pointOfSale: 'Caja 1',
  template: 'kiosco',
  onboarding: { url: 'https://erp.example.com/alta', label: 'Crear mi comercio' },
};

function stubFetch(info: unknown, session: unknown = SESSION) {
  const fetchMock = vi.fn((input: string) =>
    Promise.resolve(
      input.endsWith('/demo-sessions')
        ? new Response(JSON.stringify(session), { status: 201 })
        : new Response(JSON.stringify(info), { status: 200 }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('queryBackend (#148)', () => {
  it('pide una demo y con esa conexión consulta /info', async () => {
    const fetchMock = stubFetch({
      contractVersion: '4.4.0',
      status: 'ok',
      capabilities: ['demo-sessions', 'customer-payment-void'],
    });
    const facts = await queryBackend('https://erp.example.com', NOW);
    expect(facts).toEqual({
      contract: '4.4.0',
      capabilities: ['demo-sessions', 'customer-payment-void'],
      checkedAt: '2026-09-29T12:00:00.000Z',
    });
    const [infoUrl, infoInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(infoUrl).toBe('https://erp.example.com/info');
    expect(new Headers(infoInit.headers).get('Authorization')).toBe('Bearer k-123');
  });

  it('usa la baseUrl que devuelve la demo, si viene', async () => {
    const fetchMock = stubFetch(
      { contractVersion: '4.4.0', status: 'ok', capabilities: ['demo-sessions'] },
      { ...SESSION, baseUrl: 'https://tenant-1.erp.example.com' },
    );
    await queryBackend('https://erp.example.com', NOW);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://tenant-1.erp.example.com/info');
  });

  it('falla si el backend no contesta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );
    await expect(queryBackend('https://erp.example.com', NOW)).rejects.toThrow(
      /https:\/\/erp\.example\.com/,
    );
  });

  it('falla si no declara demo-sessions', async () => {
    stubFetch({ contractVersion: '4.4.0', status: 'ok' });
    await expect(queryBackend('https://erp.example.com', NOW)).rejects.toThrow(/demo-sessions/);
  });

  it('falla si /info no valida', async () => {
    stubFetch({ status: 'ok' });
    await expect(queryBackend('https://erp.example.com', NOW)).rejects.toThrow(/\/info/);
  });
});
