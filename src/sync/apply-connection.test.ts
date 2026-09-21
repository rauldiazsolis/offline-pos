import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOutboxEventForSale } from '../domain/outbox.ts';
import type { Product } from '../domain/product.ts';
import { ok } from '../domain/result.ts';
import type { Sale } from '../domain/sale.ts';
import { db } from '../storage/db.ts';
import { fakeConnector } from '../test/fake-connector.ts';
import { connectionStateSignal, syncStatusSignal } from '../ui/state/sync.ts';
import { applyConnection, flushPendingBeforeWipe } from './apply-connection.ts';
import { loadSyncConfig, saveSyncConfig, type SyncConfig } from './config.ts';
import type { ProbeSnapshot } from './connection.ts';
import { getCustomersCursor, getProductsCursor, setProductsCursor } from './cursor.ts';
import { tryAcquireSyncLock } from './engine.ts';

const now = '2026-01-01T00:00:00.000Z';

const product: Product = {
  id: 'p1',
  sku: 'S1',
  barcodes: [],
  name: 'Arroz',
  price: 100,
  taxRate: 0.21,
  category: 'x',
  tracksStock: false,
};

const snapshot: ProbeSnapshot = {
  products: [product],
  stock: [{ productId: 'p1', quantity: 5, updatedAt: now }],
  customers: [
    { id: 'c1', name: 'Ana' },
    { id: 'c2', name: 'Beto', creditLimit: 100, margin: 10, balance: 5 },
  ],
  cursors: { products: 'cur-p', customers: 'cur-c' },
};

const candidate: SyncConfig = { type: 'rest', baseUrl: 'https://nuevo.example.com' };
const oldConfig: SyncConfig = {
  type: 'rest',
  baseUrl: 'https://viejo.example.com',
  verifiedAt: '2025-12-01T00:00:00.000Z',
};

function makeSale(id: string): Sale {
  return { id, lines: [], payments: [], total: 0, status: 'closed', createdAt: now };
}

async function seedOldWorld(): Promise<void> {
  saveSyncConfig(oldConfig);
  setProductsCursor('cursor-viejo');
  await db.products.put({ ...product, id: 'viejo', name: 'Del backend viejo' });
  await db.sales.put(makeSale('s-vieja'));
  await db.outbox.put(buildOutboxEventForSale(makeSale('s-vieja'), { now }));
  await db.cashSessions.put({ id: 'cs1', openedAt: now, openingAmount: 0, sales: [] });
  await db.draftCart.put({
    id: 'current',
    cart: { lines: [{ kind: 'freeform', description: 'a', qty: 1, unitPrice: 1 }] },
  });
}

beforeEach(async () => {
  await db.open();
  connectionStateSignal.value = 'unconfigured';
  syncStatusSignal.value = 'offline';
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('applyConnection', () => {
  it('sobre una terminal vacía: carga el snapshot, guarda la config con verifiedAt y deja la conexión activa', async () => {
    const result = await applyConnection({ candidate, snapshot, wipe: true, now });

    expect(result).toEqual({ ok: true, value: undefined });
    await expect(db.products.count()).resolves.toBe(1);
    await expect(db.stock.count()).resolves.toBe(1);
    await expect(db.customers.count()).resolves.toBe(2);
    await expect(db.customerAccounts.count()).resolves.toBe(1);
    expect(loadSyncConfig()).toEqual({ ok: true, value: { ...candidate, verifiedAt: now } });
    expect(connectionStateSignal.value).toBe('active');
    expect(syncStatusSignal.value).toBe('online-idle');
  });

  it('con wipe: borra ventas, outbox, turnos y venta en curso, y deja solo lo del snapshot', async () => {
    await seedOldWorld();

    const result = await applyConnection({ candidate, snapshot, wipe: true, now });

    expect(result.ok).toBe(true);
    await expect(db.products.toArray()).resolves.toEqual([product]);
    await expect(db.sales.count()).resolves.toBe(0);
    await expect(db.outbox.count()).resolves.toBe(0);
    await expect(db.cashSessions.count()).resolves.toBe(0);
    await expect(db.draftCart.count()).resolves.toBe(0);
  });

  it('sin wipe (mismo origen): conserva lo local y suma el snapshot', async () => {
    await seedOldWorld();

    const result = await applyConnection({ candidate, snapshot, wipe: false, now });

    expect(result.ok).toBe(true);
    await expect(db.sales.count()).resolves.toBe(1);
    await expect(db.outbox.count()).resolves.toBe(1);
    await expect(db.products.count()).resolves.toBe(2);
  });

  it('reinicia los cursores y fija los del snapshot', async () => {
    await seedOldWorld();

    await applyConnection({ candidate, snapshot, wipe: true, now });

    expect(getProductsCursor()).toBe('cur-p');
    expect(getCustomersCursor()).toBe('cur-c');
  });

  it('si el snapshot no trae cursor, no queda ninguno (ni el viejo)', async () => {
    await seedOldWorld();

    await applyConnection({
      candidate,
      snapshot: { ...snapshot, cursors: {} },
      wipe: true,
      now,
    });

    expect(getProductsCursor()).toBeUndefined();
  });

  it('si la transacción falla no cambia nada: ni los datos, ni la config, ni el estado', async () => {
    await seedOldWorld();
    connectionStateSignal.value = 'active';
    const broken: ProbeSnapshot = {
      ...snapshot,
      // Una clave inválida de IndexedDB hace fallar el bulkPut a mitad de la transacción.
      products: [{ ...product, id: null as unknown as string }],
    };

    const result = await applyConnection({ candidate, snapshot: broken, wipe: true, now });

    expect(result).toMatchObject({ ok: false, error: 'connection/apply-failed' });
    await expect(db.sales.count()).resolves.toBe(1);
    await expect(db.products.get('viejo')).resolves.not.toBeUndefined();
    expect(loadSyncConfig()).toEqual({ ok: true, value: oldConfig });
    expect(getProductsCursor()).toBe('cursor-viejo');
    expect(connectionStateSignal.value).toBe('active');
  });

  it('no se intercala con un ciclo de sync: si el cerrojo sigue tomado, falla sin tocar nada', async () => {
    await seedOldWorld();
    const release = tryAcquireSyncLock();

    const result = await applyConnection({ candidate, snapshot, wipe: true, now, lockWaitMs: 40 });

    expect(result).toMatchObject({ ok: false, error: 'connection/apply-failed' });
    await expect(db.sales.count()).resolves.toBe(1);
    expect(loadSyncConfig()).toEqual({ ok: true, value: oldConfig });
    release?.();
  });

  it('libera el cerrojo al terminar', async () => {
    await applyConnection({ candidate, snapshot, wipe: true, now });

    const release = tryAcquireSyncLock();
    expect(release).not.toBeUndefined();
    release?.();
  });
});

describe('flushPendingBeforeWipe', () => {
  it('empuja los pendientes al conector actual ignorando el backoff', async () => {
    await db.outbox.put({
      ...buildOutboxEventForSale(makeSale('s1'), { now }),
      retries: 2,
      nextAttemptAt: '2099-01-01T00:00:00.000Z',
    });
    const pushSale = vi.fn().mockResolvedValue(ok(undefined));

    await flushPendingBeforeWipe(oldConfig, { connector: fakeConnector({ pushSale }) });

    expect(pushSale).toHaveBeenCalledTimes(1);
    await expect(db.outbox.get(makeSale('s1').id)).resolves.toMatchObject({ status: 'synced' });
  });

  it('si el conector se cuelga, vuelve igual (tope de tiempo) y libera el cerrojo', async () => {
    await db.outbox.put(buildOutboxEventForSale(makeSale('s1'), { now }));
    const connector = fakeConnector({ pushSale: () => new Promise<never>(() => undefined) });

    await flushPendingBeforeWipe(oldConfig, { connector, timeoutMs: 40 });

    const release = tryAcquireSyncLock();
    expect(release).not.toBeUndefined();
    release?.();
  });

  it('si el cerrojo sigue tomado y vence la espera, no empuja nada', async () => {
    await db.outbox.put(buildOutboxEventForSale(makeSale('s1'), { now }));
    const pushSale = vi.fn().mockResolvedValue(ok(undefined));
    const release = tryAcquireSyncLock();

    await flushPendingBeforeWipe(oldConfig, {
      connector: fakeConnector({ pushSale }),
      timeoutMs: 40,
    });

    expect(pushSale).not.toHaveBeenCalled();
    release?.();
  });
});
