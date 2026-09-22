import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOutboxEventForSale } from '../../domain/outbox.ts';
import type { Sale } from '../../domain/sale.ts';
import { db } from '../../storage/db.ts';
import { loadSyncConfig, saveSyncConfig } from '../../sync/config.ts';
import { cartSignal } from '../state/cart.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { connectionStateSignal, syncPausedSignal } from '../state/sync.ts';
import {
  configConfirmationSignal,
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configLocaleSignal,
  configPhaseSignal,
  configTypeSignal,
} from '../state/sync-config.ts';
import {
  backToEditing,
  cancelConfigScreen,
  confirmConfigChange,
  enterConfigScreen,
  handleConfigEscape,
  setConfigField,
  setConfigLocale,
  setConfigType,
  submitConfig,
} from './config-controller.ts';

// `applyAndFinish` dispara un ciclo de sync en background: seguiría corriendo
// después de que el test cierra la base. Se neutraliza solo el ciclo; el
// cerrojo y el resto del motor (que usa `applyConnection`) siguen siendo reales.
vi.mock('../../sync/engine.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runPushCycle: vi.fn(() => Promise.resolve()),
  runPullCycleNow: vi.fn(() => Promise.resolve()),
}));

// Los `it.skip` de este archivo prueban submitConfig()/probeConnection() contra un conector REST
// real (stubRestBackend) — dependen de que connectors/rest/rest-fetch-connector.ts hable el
// contrato batch (Task 14 del plan de Etapa 1, #87). Se verifican y se sacan del skip ahí.

const now = '2026-01-01T00:00:00.000Z';
const WEB_APP_URL = 'https://script.google.com/macros/s/abc/exec';

const product = {
  id: 'p1',
  sku: 'S1',
  barcodes: [],
  name: 'Arroz',
  price: 100,
  taxRate: 0.21,
  category: 'x',
  tracksStock: false,
};

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) } as Response;
}

/** Backend REST de mentira: productos, stock y clientes responden; cualquier POST/DELETE da OK. */
function stubRestBackend(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string) => {
    const path = new URL(url).pathname;
    if (path === '/products') return Promise.resolve(okResponse({ items: [product] }));
    if (path === '/stock') return Promise.resolve(okResponse([]));
    if (path === '/customers') {
      return Promise.resolve(okResponse({ items: [{ id: 'c1', name: 'Ana' }] }));
    }
    return Promise.resolve(okResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function makeSale(id: string): Sale {
  return { id, lines: [], payments: [], total: 0, status: 'closed', createdAt: now };
}

async function seedUserDataFor(config: Parameters<typeof saveSyncConfig>[0]): Promise<void> {
  saveSyncConfig(config);
  await db.sales.put(makeSale('s1'));
  await db.outbox.put(buildOutboxEventForSale(makeSale('s1'), { now }));
}

beforeEach(async () => {
  await db.open();
  activeScreenSignal.value = 'sale';
  connectionStateSignal.value = 'unconfigured';
  enterConfigScreen();
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('enterConfigScreen', () => {
  it('cambia a la pantalla config, sin tipo elegido, con los campos vacíos y sin error', () => {
    expect(activeScreenSignal.value).toBe('config');
    expect(configTypeSignal.value).toBeNull();
    expect(configFieldValuesSignal.value.rest).toEqual({ baseUrl: '', apiKey: '' });
    expect(configFieldValuesSignal.value['google-sheets']).toEqual({
      webAppUrl: '',
      sharedSecret: '',
    });
    expect(configLocaleSignal.value).toBe('');
    expect(configErrorSignal.value).toBeNull();
    expect(configPhaseSignal.value).toBe('editing');
  });

  it('con una config REST guardada, precarga esos valores', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', locale: 'es-AR' });

    enterConfigScreen();

    expect(configTypeSignal.value).toBe('rest');
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
    expect(configFieldValuesSignal.value.rest.apiKey).toBe('vieja');
  });
});

describe('sincronización mientras /CONFIG está abierto', () => {
  it('se pausa al abrir /CONFIG y se reanuda al cancelar', () => {
    enterConfigScreen();
    expect(syncPausedSignal.value).toBe(true);

    connectionStateSignal.value = 'active';
    cancelConfigScreen();

    expect(syncPausedSignal.value).toBe(false);
  });

  it.skip('se reanuda al aplicar una conexión nueva', async () => {
    stubRestBackend();
    enterConfigScreen();
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');

    await submitConfig();

    expect(activeScreenSignal.value).toBe('sale');
    expect(syncPausedSignal.value).toBe(false);
  });

  it.skip('sigue pausada si la prueba falla (el formulario sigue abierto)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    enterConfigScreen();
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');

    await submitConfig();

    expect(activeScreenSignal.value).toBe('config');
    expect(syncPausedSignal.value).toBe(true);
  });
});

describe('edición del formulario', () => {
  it('cambiar el tipo no pierde lo tipeado en el otro', () => {
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');
    setConfigType('google-sheets');
    setConfigField('webAppUrl', WEB_APP_URL);
    setConfigType('rest');

    expect(configFieldValuesSignal.value.rest.baseUrl).toBe('https://api.example.com');
    expect(configFieldValuesSignal.value['google-sheets'].webAppUrl).toBe(WEB_APP_URL);
  });

  it('volver a "sin tipo" también es válido', () => {
    setConfigType('rest');
    setConfigType(null);

    expect(configTypeSignal.value).toBeNull();
  });

  it('editar limpia el error visible', async () => {
    setConfigType('rest');
    await submitConfig();
    expect(configErrorSignal.value).not.toBeNull();

    setConfigField('baseUrl', 'x');

    expect(configErrorSignal.value).toBeNull();
    expect(configErrorFieldSignal.value).toBeNull();
  });
});

describe('submitConfig — validación (antes de probar)', () => {
  it('sin tipo elegido pide elegir uno y no prueba nada', async () => {
    const fetchMock = stubRestBackend();

    await submitConfig();

    expect(configErrorSignal.value).toBe('Elegí un tipo de conexión.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('una URL vacía señala ese campo', async () => {
    setConfigType('rest');

    await submitConfig();

    expect(configErrorSignal.value).toBe('Completá «URL del sistema externo».');
    expect(configErrorFieldSignal.value).toBe('baseUrl');
    expect(configPhaseSignal.value).toBe('editing');
  });

  it('una URL inválida señala ese campo y no prueba nada', async () => {
    const fetchMock = stubRestBackend();
    setConfigType('rest');
    setConfigField('baseUrl', 'no-es-una-url');

    await submitConfig();

    expect(configErrorSignal.value).toBe('«URL del sistema externo» no es válido.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('submitConfig — primer arranque (sin datos locales)', () => {
  it.skip('prueba, aplica y deja la conexión activa con la config guardada con verifiedAt', async () => {
    stubRestBackend();
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');
    setConfigField('apiKey', 'secreto');
    setConfigLocale('es-AR');

    await submitConfig();

    expect(activeScreenSignal.value).toBe('sale');
    expect(connectionStateSignal.value).toBe('active');
    expect(configPhaseSignal.value).toBe('editing');
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value).toMatchObject({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      apiKey: 'secreto',
      locale: 'es-AR',
    });
    expect(saved.ok && saved.value.verifiedAt).toBeTruthy();
    await expect(db.products.count()).resolves.toBe(1);
    await expect(db.customers.count()).resolves.toBe(1);
  });

  it.skip('si la prueba falla: mensaje legible, el formulario queda como estaba y no cambia nada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');

    await submitConfig();

    expect(configErrorSignal.value).toBe(
      'No se pudo conectar con el servidor (Failed to fetch). ¿Está en línea y corriendo?',
    );
    expect(configPhaseSignal.value).toBe('editing');
    expect(activeScreenSignal.value).toBe('config');
    expect(configFieldValuesSignal.value.rest.baseUrl).toBe('https://api.example.com');
    expect(loadSyncConfig().ok).toBe(false);
    expect(connectionStateSignal.value).toBe('unconfigured');
    await expect(db.products.count()).resolves.toBe(0);
  });
});

describe('submitConfig — cambio de conexión con datos locales', () => {
  const oldConfig = {
    type: 'rest' as const,
    baseUrl: 'https://viejo.example.com',
    verifiedAt: '2025-12-01T00:00:00.000Z',
  };

  it.skip('mismo origen (cambia solo la API key): no pide confirmación y conserva los datos', async () => {
    stubRestBackend();
    await seedUserDataFor(oldConfig);
    connectionStateSignal.value = 'active';
    enterConfigScreen();
    setConfigField('apiKey', 'nueva');

    await submitConfig();

    expect(configPhaseSignal.value).toBe('editing');
    expect(activeScreenSignal.value).toBe('sale');
    await expect(db.sales.count()).resolves.toBe(1);
  });

  it.skip('origen distinto: envía lo pendiente al conector actual y pide confirmación con los conteos', async () => {
    const fetchMock = stubRestBackend();
    await seedUserDataFor(oldConfig);
    connectionStateSignal.value = 'active';
    enterConfigScreen();
    setConfigField('baseUrl', 'https://nuevo.example.com');

    await submitConfig();

    expect(configPhaseSignal.value).toBe('confirming');
    expect(activeScreenSignal.value).toBe('config');
    expect(configConfirmationSignal.value).toMatchObject({ sales: 1 });
    // El último intento de envío fue contra el backend VIEJO.
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain('https://viejo.example.com/sales');
    // Nada cambió todavía.
    await expect(db.sales.count()).resolves.toBe(1);
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value.type === 'rest' && saved.value.baseUrl).toBe(
      'https://viejo.example.com',
    );
  });

  it.skip('confirmar borra lo local, carga lo del backend nuevo y vacía la venta en curso', async () => {
    stubRestBackend();
    await seedUserDataFor(oldConfig);
    connectionStateSignal.value = 'active';
    cartSignal.value = { lines: [{ kind: 'freeform', description: 'x', qty: 1, unitPrice: 1 }] };
    enterConfigScreen();
    setConfigField('baseUrl', 'https://nuevo.example.com');
    await submitConfig();

    await confirmConfigChange();

    expect(activeScreenSignal.value).toBe('sale');
    await expect(db.sales.count()).resolves.toBe(0);
    await expect(db.outbox.count()).resolves.toBe(0);
    await expect(db.products.count()).resolves.toBe(1);
    expect(cartSignal.value).toEqual({ lines: [] });
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value.type === 'rest' && saved.value.baseUrl).toBe(
      'https://nuevo.example.com',
    );
  });

  it.skip('Esc en la confirmación vuelve a editar sin borrar nada', async () => {
    stubRestBackend();
    await seedUserDataFor(oldConfig);
    connectionStateSignal.value = 'active';
    enterConfigScreen();
    setConfigField('baseUrl', 'https://nuevo.example.com');
    await submitConfig();

    handleConfigEscape();

    expect(configPhaseSignal.value).toBe('editing');
    expect(configConfirmationSignal.value).toBeNull();
    await expect(db.sales.count()).resolves.toBe(1);
  });

  it.skip('backToEditing hace lo mismo que Esc en la confirmación', async () => {
    stubRestBackend();
    await seedUserDataFor(oldConfig);
    connectionStateSignal.value = 'active';
    enterConfigScreen();
    setConfigField('baseUrl', 'https://nuevo.example.com');
    await submitConfig();

    backToEditing();

    expect(configPhaseSignal.value).toBe('editing');
  });
});

describe('Esc', () => {
  it('con la conexión activa y editando, cancela y vuelve a la venta sin guardar', () => {
    connectionStateSignal.value = 'active';

    handleConfigEscape();

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('modo requerido (conexión sin activar): Esc no sale de la pantalla', () => {
    connectionStateSignal.value = 'unconfigured';

    handleConfigEscape();

    expect(activeScreenSignal.value).toBe('config');
  });

  it.skip('durante la prueba cancela la prueba: el resultado tardío se descarta', async () => {
    let resolveFirst: (response: Response) => void = () => undefined;
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        calls += 1;
        if (calls === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(okResponse(new URL(url).pathname === '/stock' ? [] : { items: [] }));
      }),
    );
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');
    const pending = submitConfig();
    expect(configPhaseSignal.value).toBe('probing');

    handleConfigEscape();
    expect(configPhaseSignal.value).toBe('editing');
    // La prueba toma el cerrojo de sync antes de tocar la red: el primer fetch sale un instante después.
    await vi.waitFor(() => {
      expect(calls).toBe(1);
    });
    resolveFirst(okResponse({ items: [] }));
    await pending;

    expect(configPhaseSignal.value).toBe('editing');
    expect(activeScreenSignal.value).toBe('config');
    expect(loadSyncConfig().ok).toBe(false);
  });
});

describe('cancelConfigScreen', () => {
  it('vuelve a la venta sin guardar nada', () => {
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');

    cancelConfigScreen();

    expect(activeScreenSignal.value).toBe('sale');
    expect(loadSyncConfig().ok).toBe(false);
  });
});
