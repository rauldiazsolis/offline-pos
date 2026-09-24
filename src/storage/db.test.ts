import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db.ts';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('PosDatabase', () => {
  it('persiste y lee un producto', async () => {
    await db.products.add({
      id: 'p1',
      sku: 'SKU-1',
      barcodes: ['111'],
      name: 'Producto 1',
      price: 100,
      taxRate: 0.21,
      category: 'general',
      tracksStock: true,
    });

    const found = await db.products.get('p1');
    expect(found?.name).toBe('Producto 1');
  });

  it('persiste y lee una venta cerrada', async () => {
    await db.sales.add({
      id: 'sale-1',
      lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }],
      payments: [{ method: 'cash', amount: 100 }],
      total: 100,
      status: 'closed',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const found = await db.sales.get('sale-1');
    expect(found?.status).toBe('closed');
  });

  it('encuentra un producto por código de barras vía el índice multiEntry', async () => {
    await db.products.add({
      id: 'p1',
      sku: 'SKU-1',
      barcodes: ['111', '222'],
      name: 'Producto 1',
      price: 100,
      taxRate: 0.21,
      category: 'general',
      tracksStock: true,
    });

    const found = await db.products.where('barcodes').equals('222').first();
    expect(found?.id).toBe('p1');
  });

  it('persiste y lee un evento de outbox (tabla agregada en la migración v2)', async () => {
    await db.outbox.add({
      id: 'sale-1',
      type: 'sale',
      sale: {
        id: 'sale-1',
        lines: [],
        payments: [],
        total: 0,
        status: 'closed',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const found = await db.outbox.get('sale-1');
    expect(found?.status).toBe('pending');
  });

  it('encuentra eventos de outbox pendientes vía el índice status', async () => {
    await db.outbox.add({
      id: 'e1',
      type: 'account-hold-release',
      holdId: 'hold-1',
      status: 'pending',
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    const pending = await db.outbox.where('status').equals('pending').toArray();
    expect(pending).toHaveLength(1);
  });
});
