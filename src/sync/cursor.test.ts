import { afterEach, describe, expect, it } from 'vitest';
import {
  clearSyncCursors,
  getLastFullSyncAt,
  getProductsCursor,
  setLastFullSyncAt,
  setProductsCursor,
} from './cursor.ts';

afterEach(() => {
  localStorage.clear();
});

describe('getProductsCursor / setProductsCursor', () => {
  it('undefined si nunca se guardó nada', () => {
    expect(getProductsCursor()).toBeUndefined();
  });

  it('guarda y relee el cursor', () => {
    setProductsCursor('cursor-abc');
    expect(getProductsCursor()).toBe('cursor-abc');
  });
});

describe('getLastFullSyncAt / setLastFullSyncAt', () => {
  it('undefined si nunca hubo una foto completa', () => {
    expect(getLastFullSyncAt()).toBeUndefined();
  });

  it('guarda y relee la fecha', () => {
    setLastFullSyncAt('2026-01-01T10:00:00.000Z');
    expect(getLastFullSyncAt()).toBe('2026-01-01T10:00:00.000Z');
  });

  it('clearSyncCursors también la borra: tras cambiar de conexión toca una foto completa', () => {
    setLastFullSyncAt('2026-01-01T10:00:00.000Z');
    setProductsCursor('c');

    clearSyncCursors();

    expect(getLastFullSyncAt()).toBeUndefined();
    expect(getProductsCursor()).toBeUndefined();
  });
});
