import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initDemoMode,
  isDemoModeSignal,
  verifyAndConsumeWipeKey,
} from '../ui/state/demo-mode.ts';
import { handleUrlAutoConfig } from './url-auto-config.ts';
import type { LocalDataSummary } from '../storage/local-data.ts';
import { configFieldValuesSignal, configTerminalSignal, configTypeSignal } from '../ui/state/sync-config.ts';
import { loadSyncConfig } from './config.ts';
import type { ApplyConnectionParams } from './apply-connection.ts';

// Mock de probe y applyConnection
vi.mock('./connection.ts', () => ({
  probeConnection: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      cursors: { products: 'c_p1', customers: 'c_c1' },
      products: [],
      stock: [],
      customers: [],
    },
  }),
}));

vi.mock('./apply-connection.ts', () => ({
  applyConnection: vi.fn().mockImplementation(async (params: ApplyConnectionParams) => {
    // Simular guardado exitoso
    const { saveSyncConfig } = await import('./config.ts');
    saveSyncConfig({ ...params.candidate, verifiedAt: params.now });
    return { ok: true, value: undefined };
  }),
}));

describe('Gestión de Modo Demo y Handshake de Wipe', () => {
  beforeEach(() => {
    localStorage.clear();
    isDemoModeSignal.value = false;
    vi.restoreAllMocks();
  });

  it('permite activar modo demo si no hay datos de usuario', () => {
    // Simular URL con ?demo=true
    window.history.pushState(null, '', '/?demo=true');

    const activated = initDemoMode(false); // hasUserData: false
    expect(activated).toBe(true);
    expect(isDemoModeSignal.value).toBe(true);
    expect(localStorage.getItem('offline-pos:demo-mode')).toBe('true');
  });

  it('verifica y consume el wipe_key de un solo uso', () => {
    localStorage.setItem('offline-pos:pending-wipe-key', 'key_valid_123');
    localStorage.setItem('offline-pos:pending-wipe-time', Date.now().toString());

    // Con clave incorrecta falla y no consume
    expect(verifyAndConsumeWipeKey('key_incorrecta')).toBe(false);
    expect(localStorage.getItem('offline-pos:pending-wipe-key')).toBe('key_valid_123');

    // Con clave correcta pasa y consume
    expect(verifyAndConsumeWipeKey('key_valid_123')).toBe(true);
    expect(localStorage.getItem('offline-pos:pending-wipe-key')).toBeNull();
  });
});

describe('Configuración Automática vía URL (Onboarding & WhatsApp)', () => {
  const emptySummary: LocalDataSummary = {
    products: 0,
    customers: 0,
    sales: 0,
    cashSessions: 0,
    pendingOutbox: 0,
    pendingSales: 0,
    draftCartLines: 0,
  };

  const withSalesSummary: LocalDataSummary = {
    ...emptySummary,
    sales: 5,
    cashSessions: 1,
  };

  beforeEach(() => {
    localStorage.clear();
    configTypeSignal.value = null;
    configFieldValuesSignal.value = {
      rest: { baseUrl: '', apiKey: '' },
      'rest-demo': { baseUrl: '', apiKey: '' },
      'google-sheets': { webAppUrl: '', sharedSecret: '' },
    };
    configTerminalSignal.value = { locale: '', branch: '', pointOfSale: '' };
  });

  it('no hace nada si la URL no contiene parámetros de conexión', async () => {
    window.history.pushState(null, '', '/');
    const res = await handleUrlAutoConfig(emptySummary);
    expect(res.handled).toBe(false);
  });

  it('Enfoque 3 (Auto-wipe): aplica automáticamente si el wipe_key coincide con el handshake', async () => {
    localStorage.setItem('offline-pos:pending-wipe-key', 'wipe_token_abc');
    localStorage.setItem('offline-pos:pending-wipe-time', Date.now().toString());

    window.history.pushState(
      null,
      '',
      '/?connector_url=http%3A%2F%2Flocalhost%3A4100%2Fconnector&api_key=pos_live_key999&branch=SUC1&pos_terminal=Caja+2&wipe_key=wipe_token_abc',
    );

    // Incluso habiendo ventas previas, si el handshake coincide, el wipe está autorizado
    const res = await handleUrlAutoConfig(withSalesSummary);
    expect(res.handled).toBe(true);
    expect(res.success).toBe(true);
    expect(res.mode).toBe('auto-applied');

    // La config quedó guardada en el sistema
    const saved = loadSyncConfig();
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value.type).toBe('rest');
      expect((saved.value as { baseUrl: string }).baseUrl).toBe('http://localhost:4100/connector');
      expect((saved.value as { apiKey: string }).apiKey).toBe('pos_live_key999');
      expect(saved.value.branch).toBe('SUC1');
      expect(saved.value.pointOfSale).toBe('Caja 2');
    }
  });

  it('Enfoque 3 (Auto-wipe para WhatsApp): aplica automáticamente en dispositivo limpio sin datos previos', async () => {
    // Simula recibir un enlace por WhatsApp en una terminal/teléfono recién instalado
    window.history.pushState(
      null,
      '',
      '/?connector_url=http%3A%2F%2Flocalhost%3A4100%2Fconnector&api_key=pos_whatsapp_key&branch=CENTRAL&pos_terminal=Caja+1',
    );

    const res = await handleUrlAutoConfig(emptySummary); // Sin datos previos
    expect(res.handled).toBe(true);
    expect(res.success).toBe(true);
    expect(res.mode).toBe('auto-applied');
  });

  it('Enfoque 2 (Fallback seguro): si hay ventas reales previas y NO viene con wipe_key autorizado, NO borra y precarga wizard', async () => {
    // Simula abrir un enlace en un POS que ya tiene ventas locales reales pero no fue quien originó el handshake
    window.history.pushState(
      null,
      '',
      '/?connector_url=http%3A%2F%2Flocalhost%3A4100%2Fconnector&api_key=pos_unauthorized_key&branch=CENTRAL&pos_terminal=Caja+1',
    );

    const res = await handleUrlAutoConfig(withSalesSummary); // ¡Tiene ventas!
    expect(res.handled).toBe(true);
    expect(res.success).toBe(false);
    expect(res.mode).toBe('wizard-fallback');

    // Los campos quedaron precargados en el estado del wizard
    expect(configTypeSignal.value).toBe('rest');
    expect(configFieldValuesSignal.value.rest.baseUrl).toBe('http://localhost:4100/connector');
    expect(configFieldValuesSignal.value.rest.apiKey).toBe('pos_unauthorized_key');
    expect(configTerminalSignal.value.branch).toBe('CENTRAL');
    expect(configTerminalSignal.value.pointOfSale).toBe('Caja 1');
  });
});
