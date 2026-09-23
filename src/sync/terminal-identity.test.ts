import { beforeEach, describe, expect, it } from 'vitest';
import { saveSyncConfig } from './config.ts';
import { currentEventOrigin, DEVICE_ID_KEY, getDeviceId } from './terminal-identity.ts';

beforeEach(() => {
  localStorage.clear();
});

describe('getDeviceId', () => {
  it('genera un UUID una vez y lo reusa', () => {
    const first = getDeviceId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe(first);
    expect(getDeviceId()).toBe(first);
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
