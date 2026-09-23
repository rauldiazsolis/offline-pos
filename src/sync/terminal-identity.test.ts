import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../storage/db.ts';
import { loadSyncConfig, saveSyncConfig } from './config.ts';
import { getProductsCursor, setProductsCursor } from './cursor.ts';
import {
  currentEventOrigin,
  DEVICE_ID_KEY,
  getDeviceId,
  peekDeviceId,
  resolveDeviceIdentity,
  setDeviceIdForTests,
} from './terminal-identity.ts';

beforeEach(async () => {
  localStorage.clear();
  setDeviceIdForTests(undefined);
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('resolveDeviceIdentity', () => {
  it('con id guardado lo reusa y no toca nada', async () => {
    localStorage.setItem(DEVICE_ID_KEY, 'abc');
    await db.sales.put({
      id: 's1',
      lines: [],
      payments: [],
      total: 0,
      status: 'closed',
      createdAt: 'x',
    });
    expect(await resolveDeviceIdentity()).toEqual({ status: 'existing' });
    expect(getDeviceId()).toBe('abc');
    expect(await db.sales.count()).toBe(1);
  });

  it('instalación nueva: crea el id sin avisar', async () => {
    expect(await resolveDeviceIdentity()).toEqual({ status: 'created', wipedLocalData: false });
    expect(getDeviceId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe(getDeviceId());
  });

  it('sin id con datos: borra todo, conserva la config sin verifiedAt y avisa', async () => {
    await db.sales.put({
      id: 's1',
      lines: [],
      payments: [],
      total: 0,
      status: 'closed',
      createdAt: 'x',
    });
    setProductsCursor('c1');
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'http://x',
      branch: 'Centro',
      pointOfSale: 'Caja 1',
      verifiedAt: 'y',
    });

    expect(await resolveDeviceIdentity()).toEqual({ status: 'created', wipedLocalData: true });

    expect(await db.sales.count()).toBe(0);
    expect(getProductsCursor()).toBeUndefined();
    const config = loadSyncConfig();
    expect(config.ok && config.value).toEqual({
      type: 'rest',
      baseUrl: 'http://x',
      branch: 'Centro',
      pointOfSale: 'Caja 1',
    });
  });

  it('sin id y solo con config (sin datos): igual avisa', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'http://x', verifiedAt: 'y' });
    expect(await resolveDeviceIdentity()).toEqual({ status: 'created', wipedLocalData: true });
  });
});

describe('getDeviceId', () => {
  it('nunca crea un id: sin resolver es un bug', () => {
    expect(() => getDeviceId()).toThrow();
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull();
  });

  it('borrar la clave a mitad de sesión no cambia el id en memoria', async () => {
    await resolveDeviceIdentity();
    const id = getDeviceId();
    localStorage.removeItem(DEVICE_ID_KEY);
    expect(getDeviceId()).toBe(id);
  });
});

describe('peekDeviceId', () => {
  it('null antes de resolver', () => {
    expect(peekDeviceId()).toBeNull();
  });
});

describe('currentEventOrigin', () => {
  it('sin config, vacío', () => {
    expect(currentEventOrigin()).toEqual({});
  });
  it('toma sucursal y punto de venta de la config', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'http://x', branch: 'Centro', pointOfSale: 'Caja 1' });
    expect(currentEventOrigin()).toEqual({ branch: 'Centro', pointOfSale: 'Caja 1' });
  });
});
