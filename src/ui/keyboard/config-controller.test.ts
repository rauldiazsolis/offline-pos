import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOutboxEventForSale } from '../../domain/outbox.ts';
import type { Sale } from '../../domain/sale.ts';
import { db } from '../../storage/db.ts';
import { loadSyncConfig, saveSyncConfig } from '../../sync/config.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { connectionStateSignal, syncPausedSignal } from '../state/sync.ts';
import {
  configErrorFieldSignal,
  identityResetSignal,
  localChoiceSignal,
  probeOutcomeSignal,
  wizardAsyncSignal,
  wizardStepSignal,
} from '../state/sync-config.ts';
import {
  advance,
  applyWizard,
  backFromWipeConfirmation,
  chooseConnectorType,
  confirmWipe,
  enterConfigScreen,
  fastForward,
  goToStep,
  handleWizardEscape,
  jumpToStep,
  openRequiredWizard,
  setConfigField,
  setConfigTerminalField,
  setConfigType,
  setLocalChoice,
} from './config-controller.ts';

// `applyWizard` dispara un ciclo de sync en background: seguiría corriendo
// después de que el test cierra la base. Se neutraliza solo el ciclo; el
// cerrojo y el resto del motor (que usa `applyConnection`) siguen siendo reales.
vi.mock('../../sync/engine.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runPushThenPull: vi.fn(() => Promise.resolve()),
}));

const now = '2026-01-01T00:00:00.000Z';

const product = {
  id: 'p1',
  sku: 'S1',
  barcodes: [],
  name: 'Arroz',
  price: 100,
  taxRate: 0.21,
  category: 'x',
  tracksStock: false,
  createdAt: '2025-01-01T00:00:00.000Z',
};

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) } as Response;
}

/** Backend REST de mentira: /info responde 4.0.0, /sync/pull productos/clientes; cualquier otro POST da OK. */
function stubRestBackend(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string) => {
    const path = new URL(url).pathname;
    if (path === '/info') {
      return Promise.resolve(okResponse({ contractVersion: '4.0.0', status: 'ok' }));
    }
    if (path === '/sync/pull') {
      return Promise.resolve(
        okResponse({
          products: { items: [product] },
          customers: { items: [{ id: 'c1', name: 'Ana', createdAt: '2025-01-01T00:00:00.000Z' }] },
          stock: [],
          lots: {},
        }),
      );
    }
    return Promise.resolve(okResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function makeSale(id: string): Sale {
  return { id, lines: [], payments: [], total: 0, status: 'closed', createdAt: now };
}

beforeEach(async () => {
  await db.open();
  activeScreenSignal.value = 'sale';
  identityResetSignal.value = false;
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** Fetch que no responde hasta que el test lo suelta (para no dejar el cerrojo de sync tomado). */
function stubHangingFetch(): () => void {
  let fail: (reason: Error) => void = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          fail = reject;
        }),
    ),
  );
  return () => {
    fail(new Error('fin del test'));
  };
}

function fillTerminal(): void {
  setConfigTerminalField('branch', 'Centro');
  setConfigTerminalField('pointOfSale', 'Caja 1');
}

describe('wizard — instalación', () => {
  beforeEach(async () => {
    connectionStateSignal.value = 'unconfigured';
    await openRequiredWizard();
  });

  it('arranca en Terminal y pausa el sync; Enter sin sucursal marca el campo', () => {
    expect(wizardStepSignal.value).toBe('terminal');
    expect(syncPausedSignal.value).toBe(true);
    advance();
    expect(configErrorFieldSignal.value).toBe('branch');
    expect(wizardStepSignal.value).toBe('terminal');
  });

  it('recorrido completo: terminal → tipo → datos → probar (arranca solo) → revisar → aplicar', async () => {
    stubRestBackend();
    fillTerminal();
    advance();
    expect(wizardStepSignal.value).toBe('type');
    chooseConnectorType('rest');
    expect(wizardStepSignal.value).toBe('connector');
    setConfigField('baseUrl', 'http://a.test');
    advance();
    expect(wizardStepSignal.value).toBe('probe');
    await vi.waitFor(() => {
      expect(probeOutcomeSignal.value?.status).toBe('ok');
    });
    advance();
    expect(wizardStepSignal.value).toBe('review');
    await applyWizard();
    expect(activeScreenSignal.value).toBe('sale');
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value.branch).toBe('Centro');
    expect(saved.ok && saved.value.verifiedAt).toBeDefined();
    expect(connectionStateSignal.value).toBe('active');
    expect(syncPausedSignal.value).toBe(false);
  });

  it('una prueba fallida queda en Probar con el error y no guarda nada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    fillTerminal();
    setConfigType('rest');
    setConfigField('baseUrl', 'http://a.test');
    fastForward();
    expect(wizardStepSignal.value).toBe('probe');
    await vi.waitFor(() => {
      expect(probeOutcomeSignal.value?.status).toBe('failed');
    });
    expect(wizardAsyncSignal.value).toBe('idle');
    expect(loadSyncConfig().ok).toBe(false);
  });

  it('Esc probando cancela y queda en Probar con la prueba cancelada; el resultado tardío se descarta', async () => {
    const releaseFetch = stubHangingFetch();
    fillTerminal();
    setConfigType('rest');
    setConfigField('baseUrl', 'http://a.test');
    goToStep('probe');
    expect(wizardAsyncSignal.value).toBe('probing');
    handleWizardEscape();
    expect(wizardAsyncSignal.value).toBe('idle');
    expect(wizardStepSignal.value).toBe('probe');
    expect(probeOutcomeSignal.value?.status).toBe('cancelled');
    await vi.waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });
    releaseFetch();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(probeOutcomeSignal.value?.status).toBe('cancelled');
  });

  it('Esc en modo requerido fuera de una prueba no sale', () => {
    activeScreenSignal.value = 'config';
    handleWizardEscape();
    expect(activeScreenSignal.value).toBe('config');
  });

  it('no se puede saltar más allá del primer paso incompleto', () => {
    jumpToStep('review');
    expect(wizardStepSignal.value).toBe('terminal');
  });

  it('Ctrl+Enter se frena en el primer paso con error', () => {
    setConfigTerminalField('branch', 'Centro');
    fastForward();
    expect(wizardStepSignal.value).toBe('terminal');
    expect(configErrorFieldSignal.value).toBe('pointOfSale');
  });
});

describe('wizard — identidad perdida', () => {
  it('con la config precargada, abre en Terminal para mostrar el aviso', async () => {
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'http://a.test',
      branch: 'Centro',
      pointOfSale: 'Caja 1',
    });
    identityResetSignal.value = true;
    connectionStateSignal.value = 'unverified';
    await openRequiredWizard();
    expect(wizardStepSignal.value).toBe('terminal');
  });
});

describe('wizard — terminal activa', () => {
  beforeEach(() => {
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'http://a.test',
      branch: 'Centro',
      pointOfSale: 'Caja 1',
      verifiedAt: now,
    });
    connectionStateSignal.value = 'active';
    enterConfigScreen();
  });

  async function changeOriginAndProbe(): Promise<void> {
    goToStep('connector');
    setConfigField('baseUrl', 'http://b.test');
    advance(); // → probe (arranca solo)
    await vi.waitFor(() => {
      expect(probeOutcomeSignal.value?.status).toBe('ok');
    });
    advance(); // → local-data
  }

  it('abre en Revisar y pausa el sync', () => {
    expect(activeScreenSignal.value).toBe('config');
    expect(wizardStepSignal.value).toBe('review');
    expect(syncPausedSignal.value).toBe(true);
  });

  it('cambiar solo la sucursal guarda sin probar', async () => {
    const fetchMock = stubRestBackend();
    goToStep('terminal');
    setConfigTerminalField('branch', 'Norte');
    fastForward();
    expect(wizardStepSignal.value).toBe('review');
    await applyWizard();
    expect(fetchMock).not.toHaveBeenCalled();
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value).toMatchObject({ branch: 'Norte', verifiedAt: now });
    expect(activeScreenSignal.value).toBe('sale');
    expect(syncPausedSignal.value).toBe(false);
  });

  it('Esc sale sin guardar', () => {
    goToStep('terminal');
    setConfigTerminalField('branch', 'Norte');
    handleWizardEscape();
    expect(activeScreenSignal.value).toBe('sale');
    expect(syncPausedSignal.value).toBe(false);
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value.branch).toBe('Centro');
  });

  it('cambiar de origen con ventas: pasa por Datos locales; Mantener conserva las ventas', async () => {
    stubRestBackend();
    await db.sales.put(makeSale('s1'));
    await changeOriginAndProbe();
    expect(wizardStepSignal.value).toBe('local-data');
    expect(localChoiceSignal.value).toBe('keep');
    advance(); // confirma Mantener → review
    expect(wizardStepSignal.value).toBe('review');
    await applyWizard();
    expect(await db.sales.count()).toBe(1);
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value).toMatchObject({ baseUrl: 'http://b.test' });
  });

  it('Borrar: envía lo pendiente al backend actual, pide confirmar y borra', async () => {
    const fetchMock = stubRestBackend();
    await db.sales.put(makeSale('s1'));
    await db.outbox.put(buildOutboxEventForSale(makeSale('s1'), { now, origin: {} }));
    await changeOriginAndProbe();
    setLocalChoice('wipe');
    advance();
    await vi.waitFor(() => {
      expect(wizardAsyncSignal.value).toBe('confirming-wipe');
    });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).startsWith('http://a.test/sync/push')),
    ).toBe(true);
    await confirmWipe();
    expect(await db.sales.count()).toBe(0);
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('Esc en la confirmación de borrado vuelve a las opciones sin borrar', async () => {
    stubRestBackend();
    await db.sales.put(makeSale('s1'));
    await changeOriginAndProbe();
    setLocalChoice('wipe');
    advance();
    await vi.waitFor(() => {
      expect(wizardAsyncSignal.value).toBe('confirming-wipe');
    });
    handleWizardEscape();
    expect(wizardAsyncSignal.value).toBe('idle');
    expect(wizardStepSignal.value).toBe('local-data');
    expect(await db.sales.count()).toBe(1);
    backFromWipeConfirmation(); // sin confirmación en curso: no hace nada
    expect(activeScreenSignal.value).toBe('config');
  });
});
