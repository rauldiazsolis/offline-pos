import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetDemoBackend } from './demo-backend-reset.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resetDemoBackend', () => {
  it('hace POST a <baseUrl>/_demo/reset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resetDemoBackend('http://localhost:4000');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4000/_demo/reset', {
      method: 'POST',
    });
  });

  it('devuelve error si la respuesta no es ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const result = await resetDemoBackend('http://localhost:4000');

    expect(result).toEqual({
      ok: false,
      error: 'demo/backend-reset-failed',
      meta: { message: 'El backend respondió 500' },
    });
  });

  it('devuelve error si fetch lanza (backend no disponible)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const result = await resetDemoBackend('http://localhost:4000');

    expect(result).toEqual({
      ok: false,
      error: 'demo/backend-reset-failed',
      meta: { message: 'ECONNREFUSED' },
    });
  });
});
