import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { Sale } from '../domain/sale.ts';
import { PosDatabase } from './db.ts';
import {
  clearTrainingKeys,
  copyOperationalStateToTraining,
  prepareTrainingDatabase,
} from './training-copy.ts';
import { TRAINING_MARK_KEY } from './training-mode.ts';

const now = '2026-10-04T12:00:00.000Z';
const REAL = 'test-real';
const TARGET = 'test-real#entrenamiento';
const real = new PosDatabase(REAL);

const sale: Sale = { id: 's1', lines: [], payments: [], total: 0, status: 'closed', createdAt: now };

afterEach(async () => {
  real.close();
  await Dexie.delete(REAL);
  await Dexie.delete(TARGET);
  localStorage.clear();
});

async function seedReal(): Promise<void> {
  await real.open();
  await real.products.put({
    id: 'p1',
    sku: 'A',
    barcodes: [],
    name: 'Arroz',
    price: 100,
    taxRate: 0,
    category: 'almacen',
    tracksStock: true,
  });
  await real.stock.put({ productId: 'p1', quantity: 40, updatedAt: now });
  await real.customers.put({ id: 'c1', name: 'Ana', createdAt: now });
  await real.customerBalances.put({ customerId: 'c1', balance: 500, updatedAt: now });
  await real.sales.put(sale);
  await real.outbox.put({ type: 'sale', sale, id: 's1', status: 'pending', createdAt: now });
  await real.cashCounts.put({ id: 'k1', expected: 0, counted: 0, createdAt: now });
}

async function withTraining<T>(read: (training: PosDatabase) => Promise<T>): Promise<T> {
  const training = new PosDatabase(TARGET);
  try {
    await training.open();
    return await read(training);
  } finally {
    training.close();
  }
}

describe('copia al entrar al entrenamiento (#177)', () => {
  it('copia catálogo, stock, clientes y saldos; nunca ventas, outbox ni caja', async () => {
    await seedReal();

    await prepareTrainingDatabase(real, TARGET);

    await withTraining(async (training) => {
      expect(await training.products.count()).toBe(1);
      expect((await training.stock.get('p1'))?.quantity).toBe(40);
      expect(await training.customers.count()).toBe(1);
      expect((await training.customerBalances.get('c1'))?.balance).toBe(500);
      expect(await training.sales.count()).toBe(0);
      expect(await training.outbox.count()).toBe(0);
      expect(await training.cashCounts.count()).toBe(0);
    });
    // La real no se tocó.
    expect(await real.sales.count()).toBe(1);
    expect(await real.outbox.count()).toBe(1);
  });

  it('borra una base de entrenamiento vieja antes de copiar', async () => {
    await seedReal();
    await withTraining(async (old) => {
      await old.sales.put({ ...sale, id: 'vieja' });
    });

    await prepareTrainingDatabase(real, TARGET);

    await withTraining(async (training) => {
      expect(await training.sales.count()).toBe(0);
    });
  });
});

describe('claves del entrenamiento (#177)', () => {
  it('copia los cursores reales a sus claves de entrenamiento', () => {
    localStorage.setItem('offline-pos:sync-cursor:products', 'cp');
    localStorage.setItem('offline-pos:sync:last-full', now);

    copyOperationalStateToTraining();

    expect(localStorage.getItem('offline-pos:training:sync-cursor:products')).toBe('cp');
    expect(localStorage.getItem('offline-pos:training:sync:last-full')).toBe(now);
    expect(localStorage.getItem('offline-pos:training:sync-cursor:customers')).toBeNull();
  });

  it('al salir borra la marca y todas las training:*, sin tocar las reales', () => {
    localStorage.setItem(TRAINING_MARK_KEY, JSON.stringify({ startedAt: now }));
    localStorage.setItem('offline-pos:training:ticket-counter', '{}');
    localStorage.setItem('offline-pos:training:sync:push-lot', '{}');
    localStorage.setItem('offline-pos:ticket-counter', 'real');

    clearTrainingKeys();

    expect(localStorage.getItem(TRAINING_MARK_KEY)).toBeNull();
    expect(localStorage.getItem('offline-pos:training:ticket-counter')).toBeNull();
    expect(localStorage.getItem('offline-pos:training:sync:push-lot')).toBeNull();
    expect(localStorage.getItem('offline-pos:ticket-counter')).toBe('real');
  });
});
