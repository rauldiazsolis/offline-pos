import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSyncConfig, saveSyncConfig } from '../../sync/config.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { syncConfiguredSignal } from '../state/sync.ts';
import {
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configLocaleSignal,
  configTypeSignal,
} from '../state/sync-config.ts';
import {
  cancelConfigScreen,
  enterConfigScreen,
  setConfigField,
  setConfigLocale,
  setConfigType,
  submitConfig,
} from './config-controller.ts';

const WEB_APP_URL = 'https://script.google.com/macros/s/abc/exec';

beforeEach(() => {
  activeScreenSignal.value = 'sale';
  syncConfiguredSignal.value = false;
  enterConfigScreen();
});

afterEach(() => {
  localStorage.clear();
});

describe('enterConfigScreen', () => {
  it('cambia a la pantalla config, en REST y sin error', () => {
    expect(activeScreenSignal.value).toBe('config');
    expect(configTypeSignal.value).toBe('rest');
    expect(configErrorSignal.value).toBeNull();
  });

  it('sin config guardada, precarga los defaults del minibackend de demo (URL y API key)', () => {
    expect(configFieldValuesSignal.value.rest).toEqual({
      baseUrl: 'http://localhost:4000',
      apiKey: 'demo-token',
    });
    expect(configLocaleSignal.value).toBe('');
  });

  it('con una config REST guardada, precarga esos valores en vez de los defaults', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', locale: 'es-AR' });

    enterConfigScreen();

    expect(configTypeSignal.value).toBe('rest');
    // apiKey guardada como ausente: se muestra vacía, no el default del demo.
    expect(configFieldValuesSignal.value.rest).toEqual({
      baseUrl: 'https://api.example.com',
      apiKey: '',
    });
    expect(configLocaleSignal.value).toBe('es-AR');
  });

  it('con una config de Google Sheets guardada, abre en ese tipo con sus valores', () => {
    saveSyncConfig({ type: 'google-sheets', webAppUrl: WEB_APP_URL, sharedSecret: 's3cr3t' });

    enterConfigScreen();

    expect(configTypeSignal.value).toBe('google-sheets');
    expect(configFieldValuesSignal.value['google-sheets']).toEqual({
      webAppUrl: WEB_APP_URL,
      sharedSecret: 's3cr3t',
    });
  });

  it('con una config guardada sin type (formato anterior a la Etapa 2), la precarga como REST', () => {
    localStorage.setItem(
      'offline-pos:sync-config',
      JSON.stringify({ baseUrl: 'https://api.example.com', apiKey: 'vieja' }),
    );

    enterConfigScreen();

    expect(configTypeSignal.value).toBe('rest');
    expect(configFieldValuesSignal.value.rest).toEqual({
      baseUrl: 'https://api.example.com',
      apiKey: 'vieja',
    });
  });
});

describe('setConfigType', () => {
  it('cambia el tipo activo sin perder lo tipeado en el otro', () => {
    setConfigField('baseUrl', 'https://api.example.com');
    setConfigType('google-sheets');
    setConfigField('webAppUrl', WEB_APP_URL);
    setConfigType('rest');

    expect(configTypeSignal.value).toBe('rest');
    expect(configFieldValuesSignal.value.rest.baseUrl).toBe('https://api.example.com');
    expect(configFieldValuesSignal.value['google-sheets'].webAppUrl).toBe(WEB_APP_URL);
  });

  it('limpia el error visible', () => {
    setConfigField('baseUrl', '');
    submitConfig();
    expect(configErrorSignal.value).not.toBeNull();

    setConfigType('google-sheets');

    expect(configErrorSignal.value).toBeNull();
    expect(configErrorFieldSignal.value).toBeNull();
  });
});

describe('submitConfig — REST', () => {
  it('guarda la config completa (con apiKey y locale) y vuelve a la venta', () => {
    setConfigField('baseUrl', 'https://api.example.com');
    setConfigField('apiKey', 'secret-key');
    setConfigLocale('en-US');

    submitConfig();

    expect(activeScreenSignal.value).toBe('sale');
    expect(syncConfiguredSignal.value).toBe(true);
    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: {
        type: 'rest',
        baseUrl: 'https://api.example.com',
        apiKey: 'secret-key',
        locale: 'en-US',
      },
    });
  });

  it('apiKey y locale vacíos son válidos y quedan sin guardar', () => {
    setConfigField('baseUrl', 'https://api.example.com');
    setConfigField('apiKey', '');
    setConfigLocale('');

    submitConfig();

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'rest', baseUrl: 'https://api.example.com' },
    });
  });

  it('recorta los espacios de los valores', () => {
    setConfigField('baseUrl', '  https://api.example.com  ');
    setConfigField('apiKey', '');

    submitConfig();

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'rest', baseUrl: 'https://api.example.com' },
    });
  });

  it('rechaza una URL vacía: error sobre ese campo, se queda en la pantalla y no guarda', () => {
    setConfigField('baseUrl', '');

    submitConfig();

    expect(configErrorSignal.value).toBe('Completá «URL del sistema externo».');
    expect(configErrorFieldSignal.value).toBe('baseUrl');
    expect(activeScreenSignal.value).toBe('config');
    expect(loadSyncConfig().ok).toBe(false);
  });

  it('rechaza una URL inválida con un mensaje sobre ese campo', () => {
    setConfigField('baseUrl', 'no-es-una-url');

    submitConfig();

    expect(configErrorSignal.value).toBe('«URL del sistema externo» no es válido.');
    expect(configErrorFieldSignal.value).toBe('baseUrl');
    expect(activeScreenSignal.value).toBe('config');
  });
});

describe('submitConfig — Google Sheets', () => {
  beforeEach(() => {
    setConfigType('google-sheets');
  });

  it('guarda solo los campos de Sheets (sin restos de REST) más locale', () => {
    // Se tipea una URL en REST y se vuelve a Sheets: esos valores no deben viajar.
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');
    setConfigType('google-sheets');
    setConfigField('webAppUrl', WEB_APP_URL);
    setConfigField('sharedSecret', 's3cr3t');
    setConfigLocale('es-AR');

    submitConfig();

    expect(activeScreenSignal.value).toBe('sale');
    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: {
        type: 'google-sheets',
        webAppUrl: WEB_APP_URL,
        sharedSecret: 's3cr3t',
        locale: 'es-AR',
      },
    });
  });

  it('el secreto compartido es opcional', () => {
    setConfigField('webAppUrl', WEB_APP_URL);

    submitConfig();

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'google-sheets', webAppUrl: WEB_APP_URL },
    });
  });

  it('rechaza una Web App URL inválida, señalando ese campo', () => {
    setConfigField('webAppUrl', 'no-es-una-url');

    submitConfig();

    expect(configErrorSignal.value).toBe('«URL del Web App de Google Apps Script» no es válido.');
    expect(configErrorFieldSignal.value).toBe('webAppUrl');
    expect(activeScreenSignal.value).toBe('config');
  });

  it('rechaza una Web App URL vacía', () => {
    submitConfig();

    expect(configErrorSignal.value).toBe('Completá «URL del Web App de Google Apps Script».');
    expect(configErrorFieldSignal.value).toBe('webAppUrl');
  });
});

describe('cancelConfigScreen', () => {
  it('vuelve a la venta sin guardar nada', () => {
    setConfigField('baseUrl', 'https://api.example.com');

    cancelConfigScreen();

    expect(activeScreenSignal.value).toBe('sale');
    expect(loadSyncConfig().ok).toBe(false);
  });
});
