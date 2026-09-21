import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildOutboxEventForSale, markSynced } from '../domain/outbox.ts';
import type { Sale } from '../domain/sale.ts';
import { db } from './db.ts';
import {
  clearAllTables,
  countLocalCatalog,
  hasUserData,
  summarizeLocalData,
  type LocalDataSummary,
} from './local-data.ts';

const now = '2026-01-01T00:00:00.000Z';

const product = {
  id: 'p1',
  sku: 'S1',
  barcodes: [],
  name: 'Arroz',
  price: 100,
  taxRate: 0.21,
  category: 'x',
  tracksStock: false,
};

function makeSale(id: string): Sale {
  return { id, lines: [], payments: [], total: 0, status: 'closed', createdAt: now };
}

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

async function seedEverything(): Promise<void> {
  await db.products.put(product);
  await db.customers.put({ id: 'c1', name: 'Ana', createdAt: now });
  await db.sales.bulkPut([makeSale('s1'), makeSale('s2')]);
  await db.cashSessions.put({ id: 'cs1', openedAt: now, openingAmount: 0, sales: [] });
  await db.outbox.put(buildOutboxEventForSale(makeSale('s1'), { now }));
  await db.outbox.put(markSynced(buildOutboxEventForSale(makeSale('s2'), { now })));
  await db.draftCart.put({
    id: 'current',
    cart: {
      lines: [
        { kind: 'freeform', description: 'a', qty: 1, unitPrice: 1 },
        { kind: 'freeform', description: 'b', qty: 1, unitPrice: 2 },
      ],
    },
  });
}

describe('summarizeLocalData', () => {
  it('terminal vacía: todo en cero y sin datos del usuario', async () => {
    const summary = await summarizeLocalData();

    expect(summary).toEqual({
      products: 0,
      customers: 0,
      sales: 0,
      cashSessions: 0,
      pendingOutbox: 0,
      pendingSales: 0,
      draftCartLines: 0,
    });
    expect(hasUserData(summary)).toBe(false);
  });

  it('cuenta lo que hay, distinguiendo pendientes de sincronizados', async () => {
    await seedEverything();

    expect(await summarizeLocalData()).toEqual({
      products: 1,
      customers: 1,
      sales: 2,
      cashSessions: 1,
      pendingOutbox: 1,
      pendingSales: 1,
      draftCartLines: 2,
    });
  });
});

describe('hasUserData', () => {
  const empty: LocalDataSummary = {
    products: 10,
    customers: 10,
    sales: 0,
    cashSessions: 0,
    pendingOutbox: 0,
    pendingSales: 0,
    draftCartLines: 0,
  };

  it('un catálogo y clientes solos no son datos del usuario', () => {
    expect(hasUserData(empty)).toBe(false);
  });

  it.each(['sales', 'cashSessions', 'pendingOutbox', 'draftCartLines'] as const)(
    '%s > 0 sí lo son',
    (field) => {
      expect(hasUserData({ ...empty, [field]: 1 })).toBe(true);
    },
  );
});

describe('countLocalCatalog', () => {
  it('cuenta productos y clientes', async () => {
    await seedEverything();

    expect(await countLocalCatalog()).toEqual({ products: 1, customers: 1 });
  });
});

describe('clearAllTables', () => {
  it('deja vacías todas las tablas de la base', async () => {
    await seedEverything();

    await db.transaction('rw', db.tables, clearAllTables);

    for (const table of db.tables) {
      await expect(table.count()).resolves.toBe(0);
    }
  });
});
