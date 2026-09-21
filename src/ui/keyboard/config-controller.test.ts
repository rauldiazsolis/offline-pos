import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSyncConfig } from '../../sync/config.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { syncConfiguredSignal } from '../state/sync.ts';
import { configBufferSignal, configErrorSignal, configStepSignal } from '../state/sync-config.ts';
import { cancelConfigScreen, enterConfigScreen, submitConfigStep } from './config-controller.ts';

beforeEach(() => {
  activeScreenSignal.value = 'sale';
  syncConfiguredSignal.value = false;
  enterConfigScreen();
});

afterEach(() => {
  localStorage.clear();
});

describe('enterConfigScreen', () => {
  it('cambia a la pantalla config y arranca en el paso baseUrl', () => {
    expect(activeScreenSignal.value).toBe('config');
    expect(configStepSignal.value).toBe('baseUrl');
  });

  it('precarga la URL del minibackend de demo como default editable', () => {
    expect(configBufferSignal.value).toBe('http://localhost:4000');
  });
});

describe('submitConfigStep', () => {
  it('rechaza una URL vacía', () => {
    configBufferSignal.value = '';
    submitConfigStep();

    expect(configErrorSignal.value).not.toBeNull();
    expect(configStepSignal.value).toBe('baseUrl');
  });

  it('rechaza una URL inválida', () => {
    configBufferSignal.value = 'no-es-una-url';
    submitConfigStep();

    expect(configErrorSignal.value).not.toBeNull();
    expect(configStepSignal.value).toBe('baseUrl');
  });

  it('avanza a apiKey con una URL válida', () => {
    configBufferSignal.value = 'https://api.example.com';
    submitConfigStep();

    expect(configStepSignal.value).toBe('apiKey');
    expect(configErrorSignal.value).toBeNull();
  });

  // El minibackend de demo exige `Authorization: Bearer <token no vacío>` en
  // toda ruta (`demo-backend/src/router.ts::hasValidBearerToken`). Sin este
  // default, aceptar la URL precargada y confirmar "opcional" en blanco deja
  // el catálogo vacío por un 401 silencioso (`sync/engine.ts` traga errores
  // de pull) — ver hallazgo de la revisión final de Fase 7.
  it('precarga un apiKey default editable al confirmar la URL', () => {
    configBufferSignal.value = 'https://api.example.com';
    submitConfigStep();

    expect(configBufferSignal.value).toBe('demo-token');
  });

  it('avanza a locale tras confirmar el apiKey', () => {
    configBufferSignal.value = 'https://api.example.com';
    submitConfigStep();
    configBufferSignal.value = 'secret-key';
    submitConfigStep();

    expect(configStepSignal.value).toBe('locale');
  });

  it('guarda la config completa (con apiKey y locale) y vuelve a la venta', () => {
    configBufferSignal.value = 'https://api.example.com';
    submitConfigStep();
    configBufferSignal.value = 'secret-key';
    submitConfigStep();
    configBufferSignal.value = 'en-US';
    submitConfigStep();

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

  it('apiKey y locale vacíos son válidos (quedan sin guardar)', () => {
    configBufferSignal.value = 'https://api.example.com';
    submitConfigStep();
    configBufferSignal.value = '';
    submitConfigStep();
    configBufferSignal.value = '';
    submitConfigStep();

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'rest', baseUrl: 'https://api.example.com' },
    });
  });
});

describe('cancelConfigScreen', () => {
  it('vuelve a la venta sin guardar nada', () => {
    configBufferSignal.value = 'https://api.example.com';
    submitConfigStep();

    cancelConfigScreen();

    expect(activeScreenSignal.value).toBe('sale');
    expect(loadSyncConfig().ok).toBe(false);
  });
});
