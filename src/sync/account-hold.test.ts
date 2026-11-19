import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceRevokedSignal } from '../ui/state/sync.ts';
import { requestAccountHoldNow } from './account-hold.ts';
import { saveSyncConfig } from './config.ts';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  deviceRevokedSignal.value = undefined;
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

describe('requestAccountHoldNow con la caja vinculada en otro dispositivo (4.7.0, #230)', () => {
  it('con la marca no pide nada y devuelve sync/device-revoked', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });
    deviceRevokedSignal.value = { at: '2026-11-19T10:00:00.000Z', message: 'Otro equipo.' };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestAccountHoldNow({
      customerId: 'c1',
      amount: 1,
      idempotencyKey: 'k',
    });

    expect(result).toEqual({
      ok: false,
      error: 'sync/device-revoked',
      meta: { message: 'Otro equipo.' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un 409 device-revoked marca la caja', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ code: 'device-revoked' }), { status: 409 })),
      ),
    );

    const result = await requestAccountHoldNow({
      customerId: 'c1',
      amount: 1,
      idempotencyKey: 'k',
    });

    expect(result).toMatchObject({ ok: false, error: 'sync/device-revoked' });
    expect(deviceRevokedSignal.value).not.toBeUndefined();
  });
});
