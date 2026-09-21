import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAccountHoldNow } from './account-hold.ts';
import { saveSyncConfig } from './config.ts';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('requestAccountHoldNow', () => {
  it('sin config guardada, devuelve sync/config-missing sin llamar a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestAccountHoldNow({
      customerId: 'c1',
      amount: 100,
      idempotencyKey: 'req-1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-missing');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con config guardada, arma el conector real y pide el hold', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ approved: true, holdId: 'hold-1' }),
      }),
    );

    const result = await requestAccountHoldNow({
      customerId: 'c1',
      amount: 100,
      idempotencyKey: 'req-1',
    });

    expect(result).toEqual({ ok: true, value: { approved: true, holdId: 'hold-1' } });
  });

  it('con config de Google Sheets, aprueba el hold localmente sin llamar a fetch', async () => {
    saveSyncConfig({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestAccountHoldNow({
      customerId: 'c1',
      amount: 100,
      idempotencyKey: 'req-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.approved).toBe(true);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
