import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { GoogleSheetsConfig } from './config.ts';
import { callBridge } from './bridge-client.ts';

const config: GoogleSheetsConfig = {
  type: 'google-sheets',
  webAppUrl: 'https://script.google.com/macros/s/abc/exec',
  sharedSecret: 's3cr3t',
};

const configWithoutSecret: GoogleSheetsConfig = {
  type: 'google-sheets',
  webAppUrl: 'https://script.google.com/macros/s/abc/exec',
};

function jsonResponse(body: unknown, init?: { status?: number; ok?: boolean }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: 'status text',
    json: () => Promise.resolve(body),
  } as Response;
}

const dataSchema = z.object({ value: z.number() });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callBridge — request', () => {
  it('hace POST a webAppUrl con Content-Type text/plain y el envelope completo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { value: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await callBridge(
      config,
      { action: 'pushSale', payload: { sale: { id: 's1' } }, idempotencyKey: 's1' },
      dataSchema,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://script.google.com/macros/s/abc/exec');
    expect(init.method).toBe('POST');
    // Exactamente este header y ningún otro: cualquier header custom dispara preflight OPTIONS.
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' });
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'pushSale',
      payload: { sale: { id: 's1' } },
      idempotencyKey: 's1',
      sharedSecret: 's3cr3t',
    });
  });

  it('omite idempotencyKey y sharedSecret si no hay, y payload default es {}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { value: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await callBridge(configWithoutSecret, { action: 'pullProducts' }, dataSchema);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ action: 'pullProducts', payload: {} });
  });
});

describe('callBridge — response', () => {
  it('devuelve data validada cuando el puente responde ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { value: 7 } })),
    );

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result).toEqual({ ok: true, value: { value: 7 } });
  });

  it('mapea { ok: false, error } del puente a sync/remote-error con el mensaje', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: 'Venta no encontrada' })),
    );

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/remote-error');
      expect(result.meta).toEqual({ message: 'Venta no encontrada' });
    }
  });

  it('devuelve sync/request-failed con el status si el HTTP no es ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 })));

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toMatchObject({ status: 500 });
    }
  });

  it('devuelve sync/request-failed si fetch rechaza (sin red)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toMatchObject({ message: 'network down' });
    }
  });

  it('si el body no es JSON, devuelve sync/remote-error con una pista de qué revisar', async () => {
    const badJson = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    } as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(badJson));

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/remote-error');
      expect(result.meta).toMatchObject({
        message: expect.stringContaining('Cualquier persona') as unknown,
      });
    }
  });

  it('devuelve sync/invalid-payload si el envelope no tiene la forma esperada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hola: 'mundo' })));

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });

  it('devuelve sync/invalid-payload si data no cumple el schema pedido', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { value: 'no-es-numero' } })),
    );

    const result = await callBridge(config, { action: 'x' }, dataSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
      expect(result.meta).toMatchObject({ issues: [{ path: 'value' }] });
    }
  });
});
