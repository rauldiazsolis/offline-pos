import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../storage/db.ts';
import { storageKey } from '../storage/storage-namespace.ts';
import { setTrainingModeForTests } from '../storage/training-mode.ts';
import {
  backendCapabilitiesSignal,
  backendCompanySignal,
  backendNoticesSignal,
  backendPortalSignal,
  connectionStateSignal,
  deviceRevokedSignal,
  setConnectionState,
  terminalIdentitySignal,
} from '../ui/state/sync.ts';
import { saveBackendCapabilities } from './backend-capabilities.ts';
import { saveBackendCompany } from './backend-company.ts';
import { saveBackendNotices } from './backend-notices.ts';
import { saveBackendPortal } from './backend-portal.ts';
import { loadSyncConfig, saveSyncConfig } from './config.ts';
import { getProductsCursor, setProductsCursor } from './cursor.ts';
import { markDeviceRevoked } from './device-revoked.ts';
import { tryAcquireSyncLock } from './engine.ts';
import {
  getAwaitingLots,
  getCurrentPushLot,
  addAwaitingLot,
  setCurrentPushLot,
} from './push-lot.ts';
import { getTicketCounter, setTicketCounter } from './ticket-counter.ts';
import { unlinkTerminal } from './unlink-terminal.ts';

const NOW = '2026-11-19T15:00:00.000Z';
const DEVICE_ID_KEY = storageKey('device-id');
const PRINTER_KEY = storageKey('printer');

beforeEach(async () => {
  await db.open();
  saveSyncConfig({
    type: 'rest',
    baseUrl: 'https://b.x',
    apiKey: 'k',
    branch: 'CENTRAL',
    pointOfSale: 'Caja 1',
    verifiedAt: NOW,
  });
  setConnectionState('active');
  terminalIdentitySignal.value = { branch: 'CENTRAL', pointOfSale: 'Caja 1' };
  localStorage.setItem(DEVICE_ID_KEY, 'test-device-id');
  localStorage.setItem(PRINTER_KEY, JSON.stringify({ format: '80mm', onCheckout: 'print' }));
  setProductsCursor('c-1');
  setCurrentPushLot({ id: 'l1', eventIds: ['s1'], createdAt: NOW, retries: 1, nextAttemptAt: NOW });
  addAwaitingLot({ id: 'l0', sentAt: NOW, eventIds: [] });
  setTicketCounter({ date: '2026-11-19', last: 12 });
  saveBackendCapabilities(['device-claim']);
  saveBackendCompany({ name: 'Kiosco' });
  saveBackendPortal({ command: 'PANEL', label: 'Panel' });
  saveBackendNotices([{ id: 'n1', severity: 'info', message: 'Hola' }]);
  markDeviceRevoked(NOW, 'Otro equipo.');
  await db.outbox.add({
    type: 'sale',
    sale: { id: 's1', lines: [], payments: [], total: 0, status: 'closed', createdAt: NOW },
    id: 's1',
    status: 'pending',
    createdAt: NOW,
  });
  await db.products.add({
    id: 'p1',
    sku: 'S',
    barcodes: [],
    name: 'Arroz',
    price: 1,
    taxRate: 0,
    category: 'x',
    tracksStock: false,
  });
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
});

describe('unlinkTerminal (4.7.0, #230)', () => {
  it('deja la terminal sin conexión ni datos, y sin la marca de caja revocada', async () => {
    const result = await unlinkTerminal();

    expect(result).toEqual({ ok: true, value: undefined });
    expect(loadSyncConfig()).toMatchObject({ ok: false, error: 'sync/config-missing' });
    expect(connectionStateSignal.value).toBe('unconfigured');
    expect(terminalIdentitySignal.value).toBeNull();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.products.count()).toBe(0);
    expect(getProductsCursor()).toBeUndefined();
    expect(getCurrentPushLot()).toBeUndefined();
    expect(getAwaitingLots()).toEqual([]);
    expect(backendCapabilitiesSignal.value).toBeUndefined();
    expect(backendCompanySignal.value).toBeUndefined();
    expect(backendPortalSignal.value).toBeUndefined();
    expect(backendNoticesSignal.value).toEqual([]);
    expect(deviceRevokedSignal.value).toBeUndefined();
    expect(localStorage.getItem(storageKey('device-revoked'))).toBeNull();
  });

  it('conserva el id de dispositivo, los contadores y la impresora', async () => {
    await unlinkTerminal();

    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe('test-device-id');
    expect(getTicketCounter()).toEqual({ date: '2026-11-19', last: 12 });
    expect(localStorage.getItem(PRINTER_KEY)).not.toBeNull();
  });

  it('suelta el cerrojo de sync al terminar', async () => {
    await unlinkTerminal();

    const release = tryAcquireSyncLock();
    expect(release).not.toBeUndefined();
    release?.();
  });

  it('en entrenamiento no hace nada', async () => {
    setTrainingModeForTests({ startedAt: NOW });
    try {
      expect(await unlinkTerminal()).toEqual({
        ok: false,
        error: 'terminal/unlink-in-training',
        meta: undefined,
      });
      expect(loadSyncConfig().ok).toBe(true);
    } finally {
      setTrainingModeForTests(null);
    }
  });
});
