import { beforeEach, describe, expect, it } from 'vitest';
import { storageKey } from '../storage/storage-namespace.ts';
import { deviceRevokedSignal } from '../ui/state/sync.ts';
import { clearDeviceRevoked, markDeviceRevoked, restoreDeviceRevoked } from './device-revoked.ts';

const KEY = storageKey('device-revoked');

beforeEach(() => {
  localStorage.clear();
  deviceRevokedSignal.value = undefined;
});

describe('caja vinculada en otro dispositivo (4.7.0, #230)', () => {
  it('markDeviceRevoked prende el signal y lo persiste, con el mensaje si vino', () => {
    markDeviceRevoked('2026-11-19T10:00:00.000Z', 'La caja se vinculó en otro equipo.');

    expect(deviceRevokedSignal.value).toEqual({
      at: '2026-11-19T10:00:00.000Z',
      message: 'La caja se vinculó en otro equipo.',
    });
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({
      at: '2026-11-19T10:00:00.000Z',
      message: 'La caja se vinculó en otro equipo.',
    });
  });

  it('sin mensaje, la marca no lo lleva', () => {
    markDeviceRevoked('2026-11-19T10:00:00.000Z');

    expect(deviceRevokedSignal.value).toEqual({ at: '2026-11-19T10:00:00.000Z' });
  });

  it('una segunda marca conserva la primera fecha (desde cuándo está revocada)', () => {
    markDeviceRevoked('2026-11-19T10:00:00.000Z');
    markDeviceRevoked('2026-11-19T11:00:00.000Z', 'otra vez');

    expect(deviceRevokedSignal.value).toEqual({
      at: '2026-11-19T10:00:00.000Z',
      message: 'otra vez',
    });
  });

  it('restoreDeviceRevoked la vuelve a leer al arrancar', () => {
    markDeviceRevoked('2026-11-19T10:00:00.000Z', 'x');
    deviceRevokedSignal.value = undefined;

    restoreDeviceRevoked();

    expect(deviceRevokedSignal.value).toEqual({ at: '2026-11-19T10:00:00.000Z', message: 'x' });
  });

  it('una marca rota cuenta como ausente', () => {
    localStorage.setItem(KEY, '{roto');
    restoreDeviceRevoked();
    expect(deviceRevokedSignal.value).toBeUndefined();

    localStorage.setItem(KEY, JSON.stringify({ at: 3 }));
    restoreDeviceRevoked();
    expect(deviceRevokedSignal.value).toBeUndefined();
  });

  it('clearDeviceRevoked borra el signal y la clave', () => {
    markDeviceRevoked('2026-11-19T10:00:00.000Z');

    clearDeviceRevoked();

    expect(deviceRevokedSignal.value).toBeUndefined();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
