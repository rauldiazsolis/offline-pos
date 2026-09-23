import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../domain/product.ts';
import { db } from '../storage/db.ts';
import { setSyncPaused, syncPausedSignal } from '../ui/state/sync.ts';
import { tryAcquireSyncLock } from './engine.ts';
import { exportLocalData, RESET_LOCK_WAIT_MS, resetTerminal } from './terminal-data.ts';

const product: Product = {
  id: 'p1',
  sku: 'SKU-1',
  barcodes: [],
  name: 'Yerba',
  price: 1000,
  taxRate: 0.21,
  category: 'Almacén',
  tracksStock: true,
};

beforeEach(async () => {
  localStorage.clear();
  setSyncPaused(false);
  await db.transaction('rw', db.tables, () => Promise.all(db.tables.map((table) => table.clear())));
});

afterEach(() => {
  localStorage.clear();
});

describe('exportLocalData', () => {
  it('vuelca todas las tablas y las claves offline-pos:*, sin claves ajenas', async () => {
    await db.products.add(product);
    localStorage.setItem('offline-pos:sync-cursor:products', 'cursor-opaco');
    localStorage.setItem('otra-app:algo', 'no va');

    const dump = await exportLocalData('2026-09-23T12:00:00.000Z');

    expect(dump.exportedAt).toBe('2026-09-23T12:00:00.000Z');
    expect(Object.keys(dump.indexedDb).sort()).toEqual(db.tables.map((table) => table.name).sort());
    expect(dump.indexedDb['products']).toEqual([product]);
    expect(dump.localStorage).toEqual({ 'offline-pos:sync-cursor:products': 'cursor-opaco' });
  });

  it('oculta las credenciales de la config de cualquier conector', async () => {
    localStorage.setItem(
      'offline-pos:sync-config',
      JSON.stringify({ type: 'rest', baseUrl: 'http://x', apiKey: 'secreta' }),
    );
    localStorage.setItem(
      'offline-pos:otra-config',
      JSON.stringify({ type: 'google-sheets', webAppUrl: 'http://y', sharedSecret: 's3' }),
    );

    const dump = await exportLocalData();

    expect(dump.localStorage['offline-pos:sync-config']).toEqual({
      type: 'rest',
      baseUrl: 'http://x',
      apiKey: '***',
    });
    expect(dump.localStorage['offline-pos:otra-config']).toEqual({
      type: 'google-sheets',
      webAppUrl: 'http://y',
      sharedSecret: '***',
    });
  });
});

describe('resetTerminal', () => {
  it('borra todas las tablas y las claves offline-pos:* (config incluida), y no toca claves ajenas', async () => {
    await db.products.add(product);
    localStorage.setItem(
      'offline-pos:sync-config',
      JSON.stringify({ type: 'rest', baseUrl: 'http://x' }),
    );
    localStorage.setItem('offline-pos:sync:push-lot', '{}');
    localStorage.setItem('otra-app:algo', 'queda');

    const result = await resetTerminal();

    expect(result.ok).toBe(true);
    for (const table of db.tables) {
      expect(await table.count()).toBe(0);
    }
    expect(localStorage.getItem('offline-pos:sync-config')).toBeNull();
    expect(localStorage.getItem('offline-pos:sync:push-lot')).toBeNull();
    expect(localStorage.getItem('otra-app:algo')).toBe('queda');
  });

  it('libera el cerrojo y pausa el sync al terminar (la página se recarga después)', async () => {
    const result = await resetTerminal();

    expect(result.ok).toBe(true);
    expect(syncPausedSignal.value).toBe(true);
    const release = tryAcquireSyncLock();
    expect(release).toBeDefined();
    release?.();
  });

  it('con un ciclo de sync que no termina, no borra nada y avisa', async () => {
    await db.products.add(product);
    localStorage.setItem('offline-pos:sync-config', '{}');
    const release = tryAcquireSyncLock();
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      const pending = resetTerminal();
      await vi.advanceTimersByTimeAsync(RESET_LOCK_WAIT_MS + 100);
      const result = await pending;
      expect(result).toEqual({ ok: false, error: 'connection/sync-busy', meta: undefined });
    } finally {
      vi.useRealTimers();
      release?.();
    }
    expect(await db.products.count()).toBe(1);
    expect(localStorage.getItem('offline-pos:sync-config')).toBe('{}');
    expect(syncPausedSignal.value).toBe(false);
  });
});
