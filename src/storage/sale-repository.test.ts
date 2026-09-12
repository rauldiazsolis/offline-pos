import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Cart } from '../domain/cart.ts';
import { db } from './db.ts';
import { closeSaleAndPersist } from './sale-repository.ts';

beforeEach(async () => {
  await db.open();
  await db.products.add({
    id: 'p1',
    sku: 'SKU-1',
    barcodes: ['111'],
    name: 'Arroz 1kg',
    price: 100,
    taxRate: 0.21,
    category: 'almacen',
    tracksStock: true,
  });
  await db.stock.add({ productId: 'p1', quantity: 10, updatedAt: '2026-01-01T00:00:00.000Z' });
});

afterEach(async () => {
  db.close();
  await db.delete();
});

const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] };

describe('closeSaleAndPersist', () => {
  it('persiste la venta cerrada', async () => {
    const result = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const stored = await db.sales.get(result.value.id);
      expect(stored?.status).toBe('closed');
    }
  });

  it('descuenta el stock del producto vendido', async () => {
    await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });

    const stock = await db.stock.get('p1');
    expect(stock?.quantity).toBe(8);
  });

  it('registra un movimiento de stock con reason "sale"', async () => {
    const result = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });

    if (result.ok) {
      const movements = await db.stockMovements.where('saleId').equals(result.value.id).toArray();
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ productId: 'p1', delta: -2, reason: 'sale' });
    }
  });

  it('no persiste nada si el carrito está vacío', async () => {
    const result = await closeSaleAndPersist({ cart: { lines: [] }, payments: [] });

    expect(result.ok).toBe(false);
    await expect(db.sales.count()).resolves.toBe(0);
  });

  it('no genera movimientos de stock para productos que no lo trackean', async () => {
    await db.products.add({
      id: 'p2',
      sku: 'SKU-2',
      barcodes: [],
      name: 'Servicio',
      price: 500,
      taxRate: 0,
      category: 'servicios',
      tracksStock: false,
    });
    const cartWithService: Cart = {
      lines: [{ kind: 'product', productId: 'p2', qty: 1, unitPrice: 500 }],
    };

    const result = await closeSaleAndPersist({
      cart: cartWithService,
      payments: [{ method: 'cash', amount: 500 }],
    });

    if (result.ok) {
      const movements = await db.stockMovements.where('saleId').equals(result.value.id).toArray();
      expect(movements).toEqual([]);
    }
  });
});
