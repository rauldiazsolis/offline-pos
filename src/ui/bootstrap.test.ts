import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../storage/db.ts';
import { saveSyncConfig } from '../sync/config.ts';
import { DEVICE_ID_KEY, setDeviceIdForTests } from '../sync/terminal-identity.ts';
import { bootstrap } from './bootstrap.ts';
import { activeConnectorTypeSignal, connectionStateSignal } from './state/sync.ts';
import {
  configFieldValuesSignal,
  configTypeSignal,
  identityResetSignal,
} from './state/sync-config.ts';

// Con una config activa, `startSyncEngine` arrancaría un ciclo real que sigue
// corriendo después de que el test cierra la base; se neutraliza solo el arranque.
vi.mock('../sync/engine.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  startSyncEngine: vi.fn(),
}));

beforeEach(async () => {
  // Terminal con identidad: sin esto `resolveDeviceIdentity` trataría cada
  // test como una terminal que perdió su id y borraría la config sembrada.
  localStorage.setItem(DEVICE_ID_KEY, 'test-device-id');
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
});

describe('bootstrap', () => {
  it('sin id de dispositivo con datos: borra y prende el aviso de identidad', async () => {
    setDeviceIdForTests(undefined);
    localStorage.removeItem(DEVICE_ID_KEY);
    await db.sales.put({
      id: 's1',
      lines: [],
      payments: [],
      total: 0,
      status: 'closed',
      createdAt: 'x',
    });
    await bootstrap();
    expect(await db.sales.count()).toBe(0);
    expect(identityResetSignal.value).toBe(true);
  });

  it('no siembra catálogo ni clientes localmente — una terminal nueva arranca vacía hasta el primer sync', async () => {
    await bootstrap();

    await expect(db.products.count()).resolves.toBe(0);
    await expect(db.customers.count()).resolves.toBe(0);
  });

  it('sin config guardada: la conexión queda unconfigured', async () => {
    await bootstrap();

    expect(connectionStateSignal.value).toBe('unconfigured');
  });

  it('con una config sin verifiedAt (por ejemplo, la guardada antes de la Etapa 2b): unverified y el formulario queda precargado', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });

    await bootstrap();

    expect(connectionStateSignal.value).toBe('unverified');
    expect(configTypeSignal.value).toBe('rest');
    expect(configFieldValuesSignal.value.rest.baseUrl).toBe('https://api.example.com');
  });

  it('con una config con verifiedAt: active', async () => {
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });

    await bootstrap();

    expect(connectionStateSignal.value).toBe('active');
  });

  it('el conector activo sale de la config guardada, y solo si está verificada', async () => {
    await bootstrap();
    expect(activeConnectorTypeSignal.value).toBeNull();

    saveSyncConfig({ type: 'rest-demo', baseUrl: 'http://localhost:4000' });
    await bootstrap();
    expect(activeConnectorTypeSignal.value).toBeNull();

    saveSyncConfig({
      type: 'rest-demo',
      baseUrl: 'http://localhost:4000',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });
    await bootstrap();
    expect(activeConnectorTypeSignal.value).toBe('rest-demo');
  });
});
