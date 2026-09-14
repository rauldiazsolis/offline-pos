import { afterEach, describe, expect, it } from 'vitest';
import { loadSyncConfig, saveSyncConfig } from './config.ts';

afterEach(() => {
  localStorage.clear();
});

describe('saveSyncConfig / loadSyncConfig', () => {
  it('guarda y relee la config (round-trip)', () => {
    const saveResult = saveSyncConfig({ baseUrl: 'https://api.example.com', apiKey: 'secret' });
    expect(saveResult.ok).toBe(true);

    const loadResult = loadSyncConfig();
    expect(loadResult).toEqual({
      ok: true,
      value: { baseUrl: 'https://api.example.com', apiKey: 'secret' },
    });
  });

  it('guarda y relee locale', () => {
    saveSyncConfig({ baseUrl: 'https://api.example.com', locale: 'en-US' });

    const result = loadSyncConfig();
    expect(result).toEqual({
      ok: true,
      value: { baseUrl: 'https://api.example.com', locale: 'en-US' },
    });
  });

  it('apiKey es opcional', () => {
    saveSyncConfig({ baseUrl: 'https://api.example.com' });

    const result = loadSyncConfig();
    expect(result).toEqual({ ok: true, value: { baseUrl: 'https://api.example.com' } });
  });

  it('devuelve sync/config-missing si no hay nada guardado', () => {
    const result = loadSyncConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-missing');
    }
  });

  it('devuelve sync/config-invalid si el JSON guardado no matchea el schema', () => {
    localStorage.setItem('offline-pos:sync-config', JSON.stringify({ baseUrl: 'no-es-una-url' }));

    const result = loadSyncConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-invalid');
    }
  });

  it('devuelve sync/config-invalid si lo guardado no es JSON válido', () => {
    localStorage.setItem('offline-pos:sync-config', 'esto no es json{');

    const result = loadSyncConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-invalid');
    }
  });
});
