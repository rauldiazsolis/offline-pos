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
      value: { baseUrl: 'https://api.example.com', apiKey: 'secret-key', locale: 'en-US' },
    });
  });

  it('apiKey y locale vacíos son válidos (quedan sin guardar)', () => {
    configBufferSignal.value = 'https://api.example.com';
    submitConfigStep();
    configBufferSignal.value = '';
    submitConfigStep();
    configBufferSignal.value = '';
    submitConfigStep();

    expect(loadSyncConfig()).toEqual({ ok: true, value: { baseUrl: 'https://api.example.com' } });
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
