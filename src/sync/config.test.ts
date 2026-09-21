import { afterEach, describe, expect, it } from 'vitest';
import { loadSyncConfig, saveSyncConfig } from './config.ts';

const STORAGE_KEY = 'offline-pos:sync-config';

afterEach(() => {
  localStorage.clear();
});

describe('saveSyncConfig / loadSyncConfig', () => {
  it('guarda y relee una config REST (round-trip)', () => {
    const saveResult = saveSyncConfig({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      apiKey: 'secret',
    });
    expect(saveResult.ok).toBe(true);

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'rest', baseUrl: 'https://api.example.com', apiKey: 'secret' },
    });
  });

  it('guarda y relee locale', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', locale: 'en-US' });

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'rest', baseUrl: 'https://api.example.com', locale: 'en-US' },
    });
  });

  it('apiKey es opcional', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'rest', baseUrl: 'https://api.example.com' },
    });
  });

  it('guarda y relee una config de Google Sheets con locale', () => {
    saveSyncConfig({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      sharedSecret: 's3cr3t',
      locale: 'es-AR',
    });

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: {
        type: 'google-sheets',
        webAppUrl: 'https://script.google.com/macros/s/abc/exec',
        sharedSecret: 's3cr3t',
        locale: 'es-AR',
      },
    });
  });

  it('descarta claves de otro conector (una config de Sheets no arrastra baseUrl)', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        type: 'google-sheets',
        webAppUrl: 'https://script.google.com/macros/s/abc/exec',
        baseUrl: 'https://api.example.com',
      }),
    );

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'google-sheets', webAppUrl: 'https://script.google.com/macros/s/abc/exec' },
    });
  });

  it('devuelve sync/config-missing si no hay nada guardado', () => {
    const result = loadSyncConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-missing');
    }
  });

  it('devuelve sync/config-invalid si el JSON guardado no matchea el schema', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ type: 'rest', baseUrl: 'no-es-una-url' }));

    const result = loadSyncConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-invalid');
    }
  });

  it('devuelve sync/config-invalid si el type es desconocido', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ type: 'csv', path: 'x' }));

    const result = loadSyncConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-invalid');
    }
  });

  it('devuelve sync/config-invalid si lo guardado no es JSON válido', () => {
    localStorage.setItem(STORAGE_KEY, 'esto no es json{');

    const result = loadSyncConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-invalid');
    }
  });
});

// Antes de la Etapa 2 (#68) la config guardada no tenía `type`: solo existía
// el conector REST. Sin esta lectura, toda terminal ya configurada quedaría
// "sin configurar" al actualizar y el sync se cortaría en silencio.
describe('loadSyncConfig — config guardada por una versión anterior (sin type)', () => {
  it('se lee como REST, con todos sus campos', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ baseUrl: 'https://api.example.com', apiKey: 'vieja', locale: 'es-AR' }),
    );

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: {
        type: 'rest',
        baseUrl: 'https://api.example.com',
        apiKey: 'vieja',
        locale: 'es-AR',
      },
    });
  });

  it('una config vieja inválida sigue siendo sync/config-invalid', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl: 'no-es-una-url' }));

    const result = loadSyncConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/config-invalid');
    }
  });
});
