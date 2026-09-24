// src/storage/apply-pull.test.ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildOutboxEventForSale,
  buildOutboxEventsForStockMovements,
  markSynced,
} from '../domain/outbox.ts';
import type { Product } from '../domain/product.ts';
import type { Sale } from '../domain/sale.ts';
import type { PullBatchResult } from '../sync/connector.ts';
import { applyPull } from './apply-pull.ts';
import { db } from './db.ts';

const now = '2026-09-24T10:00:00.000Z';
const origin = { branch: 'b', pointOfSale: 'p' };

function product(id: string, name = `Producto ${id}`): Product {
  return {
    id,
    sku: `SKU-${id}`,
    barcodes: [],
    name,
    price: 100,
    taxRate: 0.21,
    category: 'x',
    tracksStock: true,
  };
}

function pull(overrides: Partial<PullBatchResult> = {}): PullBatchResult {
  return { products: { items: [] }, customers: { items: [] }, stock: [], lots: {}, ...overrides };
}

function saleEvents(id: string, productId: string, qty: number, customerId?: string) {
  const sale: Sale = {
    id,
    lines: [],
    payments: customerId !== undefined ? [{ method: 'account', amount: 100 }] : [],
    total: 100,
    status: 'closed',
    createdAt: now,
    ...(customerId !== undefined ? { customerId } : {}),
  };
  return [
    buildOutboxEventForSale(sale, { now, origin }),
    ...buildOutboxEventsForStockMovements(
      [{ id: `${id}-m`, productId, delta: -qty, reason: 'sale', saleId: id, createdAt: now }],
      { now, origin },
    ),
  ];
}

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
  vi.restoreAllMocks();
});

describe('applyPull — delta sin retener', () => {
  it('reaplica los pendientes del outbox sobre el stock del backend', async () => {
    await db.outbox.bulkAdd(saleEvents('s1', 'p1', 2));

    const report = await applyPull({
      full: false,
      result: pull({ stock: [{ productId: 'p1', quantity: 10, updatedAt: now }] }),
      retain: false,
      queuedEventIds: [],
      now,
    });

    expect(report).toEqual({ ok: true, value: { skipped: [], reappliedEvents: 2 } });
    expect((await db.stock.get('p1'))?.quantity).toBe(8);
  });

  it('reaplica los eventos de lotes en cola (ya synced) y no los cuenta dos veces', async () => {
    const events = saleEvents('s1', 'p1', 3).map(markSynced);
    await db.outbox.bulkAdd(events);

    await applyPull({
      full: false,
      result: pull({ stock: [{ productId: 'p1', quantity: 10, updatedAt: now }] }),
      retain: false,
      queuedEventIds: [...events.map((event) => event.id), events[1]?.id ?? ''],
      now,
    });

    expect((await db.stock.get('p1'))?.quantity).toBe(7);
  });

  it('suma al saldo del backend solo en los clientes que vinieron', async () => {
    await db.outbox.bulkAdd(saleEvents('s1', 'p1', 1, 'c1'));
    await db.customerAccounts.put({
      customerId: 'c2',
      creditLimit: 0,
      margin: 0,
      balance: 77,
      updatedAt: now,
    });

    await applyPull({
      full: false,
      result: pull({
        customers: {
          items: [
            { id: 'c1', name: 'Ana', createdAt: now, creditLimit: 1000, margin: 0, balance: 200 },
          ],
        },
      }),
      retain: false,
      queuedEventIds: [],
      now,
    });

    expect((await db.customerAccounts.get('c1'))?.balance).toBe(300);
    expect((await db.customerAccounts.get('c2'))?.balance).toBe(77);
  });

  it('un cliente sin cuenta no recibe una inventada', async () => {
    await db.outbox.bulkAdd(saleEvents('s1', 'p1', 1, 'c1'));
    await applyPull({
      full: false,
      result: pull({ customers: { items: [{ id: 'c1', name: 'Ana', createdAt: now }] } }),
      retain: false,
      queuedEventIds: [],
      now,
    });
    expect(await db.customerAccounts.get('c1')).toBeUndefined();
  });
});

describe('applyPull — reteniendo', () => {
  it('aplica datos maestros y bloqueos, conserva stock y saldo locales', async () => {
    await db.products.put(product('p1', 'Viejo'));
    await db.stock.put({ productId: 'p1', quantity: 4, updatedAt: '2026-09-23T00:00:00.000Z' });
    await db.customerAccounts.put({
      customerId: 'c1',
      creditLimit: 1000,
      margin: 0,
      balance: 50,
      updatedAt: now,
    });
    await db.outbox.bulkAdd(saleEvents('s1', 'p1', 1, 'c1'));

    const report = await applyPull({
      full: false,
      result: pull({
        products: {
          items: [{ ...product('p1', 'Nuevo'), createdAt: now, blocked: { reason: 'revisar' } }],
        },
        customers: {
          items: [
            { id: 'c1', name: 'Ana', createdAt: now, creditLimit: 2000, margin: 0, balance: 999 },
          ],
        },
        stock: [{ productId: 'p1', quantity: 99, updatedAt: now }],
      }),
      retain: true,
      queuedEventIds: [],
      now,
    });

    expect(report).toEqual({ ok: true, value: { skipped: [], reappliedEvents: 0 } });
    const saved = await db.products.get('p1');
    expect(saved?.name).toBe('Nuevo');
    expect(saved?.blocked).toEqual({ reason: 'revisar' });
    expect((await db.stock.get('p1'))?.quantity).toBe(4);
    const account = await db.customerAccounts.get('c1');
    expect(account?.balance).toBe(50);
    expect(account?.creditLimit).toBe(2000);
  });

  it('una foto completa reteniendo reconcilia productos pero no borra stock local', async () => {
    await db.products.bulkPut([product('p1'), product('p2')]);
    await db.stock.put({ productId: 'p2', quantity: 4, updatedAt: now });

    const report = await applyPull({
      full: true,
      result: pull({ products: { items: [{ ...product('p1'), createdAt: now }] } }),
      retain: true,
      queuedEventIds: [],
      now,
    });

    expect(report.ok).toBe(true);
    expect(await db.products.get('p2')).toBeUndefined();
    expect((await db.stock.get('p2'))?.quantity).toBe(4);
  });
});

describe('applyPull — foto completa sin retener', () => {
  it('reconcilia bajas y reaplica los pendientes', async () => {
    await db.products.bulkPut([product('p1'), product('p2')]);
    await db.stock.bulkPut([
      { productId: 'p1', quantity: 1, updatedAt: now },
      { productId: 'p2', quantity: 1, updatedAt: now },
    ]);
    await db.outbox.bulkAdd(saleEvents('s1', 'p1', 2));

    await applyPull({
      full: true,
      result: pull({
        products: { items: [{ ...product('p1'), createdAt: now }] },
        stock: [{ productId: 'p1', quantity: 10, updatedAt: now }],
      }),
      retain: false,
      queuedEventIds: [],
      now,
    });

    expect(await db.products.get('p2')).toBeUndefined();
    expect(await db.stock.get('p2')).toBeUndefined();
    expect((await db.stock.get('p1'))?.quantity).toBe(8);
  });

  it('si Dexie falla devuelve sync/reconcile-failed sin cambiar nada', async () => {
    await db.products.put(product('p1', 'Viejo'));
    vi.spyOn(db.products, 'bulkPut').mockRejectedValueOnce(new Error('boom'));

    const report = await applyPull({
      full: true,
      result: pull({ products: { items: [{ ...product('p1', 'Nuevo'), createdAt: now }] } }),
      retain: false,
      queuedEventIds: [],
      now,
    });

    expect(report).toEqual({
      ok: false,
      error: 'sync/reconcile-failed',
      meta: { message: 'boom' },
    });
    expect((await db.products.get('p1'))?.name).toBe('Viejo');
  });
});
