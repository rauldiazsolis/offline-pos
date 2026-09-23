import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Cart } from '../domain/cart.ts';
import {
  closeCashSessionAndPersist,
  getCurrentOpenCashSession,
  openCashSessionAndPersist,
} from './cash-session-repository.ts';
import { saveSyncConfig } from '../sync/config.ts';
import { db } from './db.ts';
import { closeSaleAndPersist, voidSaleAndPersist } from './sale-repository.ts';

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
  // Fase 6: closeSaleAndPersist exige un turno de caja abierto — se abre uno
  // acá para no repetirlo en cada test; el test de "sin turno abierto" lo
  // cierra explícitamente antes de ejercitar el caso que le interesa.
  await openCashSessionAndPersist({ openingAmount: 0 });
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

  it('escribe un evento de outbox por la venta y uno por cada movimiento de stock', async () => {
    const result = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });
    if (!result.ok) throw new Error('setup falló');

    const events = await db.outbox.toArray();
    expect(events).toHaveLength(2);

    const saleEvent = events.find((event) => event.type === 'sale');
    expect(saleEvent?.id).toBe(result.value.id); // el id de la venta es la Idempotency-Key
    expect(saleEvent?.status).toBe('pending');

    const movementEvent = events.find((event) => event.type === 'stock-movement');
    expect(movementEvent?.status).toBe('pending');
  });

  it('estampa en cada evento la sucursal de la config actual (contrato v3)', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'http://x', branch: 'Centro' });
    try {
      await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });
      const events = await db.outbox.toArray();
      expect(events.map((event) => event.origin)).toEqual([
        { branch: 'Centro' },
        { branch: 'Centro' },
      ]);
    } finally {
      localStorage.clear();
    }
  });

  it('con un pago account, registra el movimiento y descuenta el balance cacheado', async () => {
    await db.customers.add({ id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' });
    await db.customerAccounts.add({
      customerId: 'c1',
      creditLimit: 1000,
      margin: 0,
      balance: 100,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await closeSaleAndPersist({
      cart,
      payments: [{ method: 'account', amount: 200, reference: 'hold-1' }],
      customerId: 'c1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const movements = await db.accountMovements.where('saleId').equals(result.value.id).toArray();
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ customerId: 'c1', amount: 200, holdId: 'hold-1' });

      const account = await db.customerAccounts.get('c1');
      expect(account?.balance).toBe(300);
    }
  });

  it('con un pago account sin CustomerAccount cacheada, no la inventa', async () => {
    await db.customers.add({ id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' });

    await closeSaleAndPersist({
      cart,
      payments: [{ method: 'account', amount: 200 }],
      customerId: 'c1',
    });

    expect(await db.customerAccounts.get('c1')).toBeUndefined();
  });

  it('con pendingHold, encola también un evento account-hold-confirm', async () => {
    await db.customers.add({ id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' });

    const result = await closeSaleAndPersist({
      cart,
      payments: [{ method: 'account', amount: 200, reference: 'hold-1' }],
      customerId: 'c1',
      pendingHold: { holdId: 'hold-1' },
    });
    if (!result.ok) throw new Error('setup falló');

    const confirmEvent = (await db.outbox.toArray()).find(
      (event) => event.type === 'account-hold-confirm',
    );
    expect(confirmEvent).toMatchObject({ holdId: 'hold-1', saleId: result.value.id });
  });

  it('rechaza cerrar la venta sin un turno de caja abierto', async () => {
    await closeCashSessionAndPersist({ closingAmount: 0 }); // cierra el turno que abrió el beforeEach

    const result = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });

    expect(result).toEqual({ ok: false, error: 'cash-session/none-open', meta: undefined });
  });

  it('agrega el id de la venta al turno de caja abierto', async () => {
    const result = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });
    if (!result.ok) throw new Error('setup falló');

    const session = await getCurrentOpenCashSession();
    expect(session?.sales).toContain(result.value.id);
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

describe('voidSaleAndPersist', () => {
  it('anula la venta y revierte el stock', async () => {
    const closed = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });
    if (!closed.ok) throw new Error('setup falló');

    const result = await voidSaleAndPersist(closed.value.id, { reason: 'error de cobro' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('voided');
      expect(result.value.voidReason).toBe('error de cobro');
    }
    const stock = await db.stock.get('p1');
    expect(stock?.quantity).toBe(10);
  });

  it('no modifica lines/payments/total/createdAt de la venta original', async () => {
    const closed = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });
    if (!closed.ok) throw new Error('setup falló');

    const result = await voidSaleAndPersist(closed.value.id);

    if (result.ok) {
      expect(result.value.lines).toEqual(closed.value.lines);
      expect(result.value.payments).toEqual(closed.value.payments);
      expect(result.value.total).toBe(closed.value.total);
      expect(result.value.createdAt).toBe(closed.value.createdAt);
    }
  });

  it('registra un movimiento de stock nuevo con reason "sale-void", sin editar el original', async () => {
    const closed = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });
    if (!closed.ok) throw new Error('setup falló');

    await voidSaleAndPersist(closed.value.id);

    const movements = await db.stockMovements.where('saleId').equals(closed.value.id).toArray();
    expect(movements).toHaveLength(2);
    expect(movements.find((m) => m.reason === 'sale')?.delta).toBe(-2);
    expect(movements.find((m) => m.reason === 'sale-void')?.delta).toBe(2);
  });

  it('escribe un evento sale-void con id propio, distinto del id de la venta, más un evento por movimiento', async () => {
    const closed = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });
    if (!closed.ok) throw new Error('setup falló');

    await voidSaleAndPersist(closed.value.id, { reason: 'error de cobro' });

    const events = await db.outbox.toArray();
    const voidEvent = events.find((event) => event.type === 'sale-void');
    expect(voidEvent).toBeDefined();
    expect(voidEvent?.id).not.toBe(closed.value.id);
    if (voidEvent?.type === 'sale-void') {
      expect(voidEvent.saleId).toBe(closed.value.id);
      expect(voidEvent.voidReason).toBe('error de cobro');
    }

    const movementEvents = events.filter(
      (event) => event.type === 'stock-movement' && event.movement.reason === 'sale-void',
    );
    expect(movementEvents).toHaveLength(1);
  });

  it('rechaza anular una venta inexistente', async () => {
    const result = await voidSaleAndPersist('no-existe');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sale/not-found');
    }
  });

  it('rechaza anular una venta ya anulada', async () => {
    const closed = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });
    if (!closed.ok) throw new Error('setup falló');
    await voidSaleAndPersist(closed.value.id);

    const result = await voidSaleAndPersist(closed.value.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sale/already-voided');
    }
  });
});
