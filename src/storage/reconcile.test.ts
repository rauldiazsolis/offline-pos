import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildOutboxEventForCustomer } from '../domain/outbox.ts';
import type { Product } from '../domain/product.ts';
import type { Sale } from '../domain/sale.ts';
import type { StockItem } from '../domain/stock.ts';
import type { ProbeSnapshot } from '../sync/pull-snapshot.ts';
import { db } from './db.ts';
import { applySnapshotReconciled } from './reconcile.ts';

const now = '2026-01-01T00:00:00.000Z';

function product(id: string, name = `Producto ${id}`): Product {
  return {
    id,
    sku: `SKU-${id}`,
    barcodes: [],
    name,
    price: 100,
    taxRate: 0.21,
    category: 'x',
    tracksStock: false,
  };
}

function stockOf(productId: string, quantity = 5): StockItem {
  return { productId, quantity, updatedAt: now };
}

function snapshot(overrides: Partial<ProbeSnapshot> = {}): ProbeSnapshot {
  return { products: [], stock: [], customers: [], cursors: {}, ...overrides };
}

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

async function ids(
  table: 'products' | 'customers' | 'customerAccounts' | 'stock',
): Promise<unknown[]> {
  return (await db.table(table).toCollection().primaryKeys()).sort();
}

/** Lo mismo que hacía `reconcileSnapshot` (se sacó en #98): la reconciliación dentro de su transacción. */
async function reconcile(snap: ProbeSnapshot, params: { now: string; allowEmptyTables?: boolean }) {
  return db.transaction(
    'rw',
    [db.products, db.stock, db.customers, db.customerAccounts, db.outbox],
    () => applySnapshotReconciled(snap, params),
  );
}

describe('applySnapshotReconciled — bajas', () => {
  it('actualiza lo que llegó y borra los productos que ya no vienen', async () => {
    await db.products.bulkPut([product('p1'), product('p2'), product('p3')]);

    const result = await reconcile(
      snapshot({ products: [product('p1', 'Renombrado'), product('p2')] }),
      { now },
    );

    expect(result).toEqual({ skipped: [] });
    expect(await ids('products')).toEqual(['p1', 'p2']);
    expect((await db.products.get('p1'))?.name).toBe('Renombrado');
  });

  it('el stock de un producto ausente se borra por productId', async () => {
    await db.products.put(product('p1'));
    await db.stock.bulkPut([stockOf('p1'), stockOf('p9')]);

    await reconcile(snapshot({ products: [product('p1')], stock: [stockOf('p1', 7)] }), {
      now,
    });

    expect(await ids('stock')).toEqual(['p1']);
    expect((await db.stock.get('p1'))?.quantity).toBe(7);
  });

  it('borra los clientes ausentes y sus cuentas; conserva y actualiza los que vienen', async () => {
    await db.customers.bulkPut([
      { id: 'c1', name: 'Ana', createdAt: now },
      { id: 'c2', name: 'Beto', createdAt: now },
    ]);
    await db.customerAccounts.bulkPut([
      { customerId: 'c1', creditLimit: 100, margin: 0, balance: 0, updatedAt: now },
      { customerId: 'c2', creditLimit: 100, margin: 0, balance: 0, updatedAt: now },
    ]);

    await reconcile(
      snapshot({
        products: [product('p1')],
        customers: [
          { id: 'c1', name: 'Ana Gómez', createdAt: now, creditLimit: 500, margin: 0, balance: 10 },
        ],
      }),
      { now },
    );

    expect(await ids('customers')).toEqual(['c1']);
    expect((await db.customers.get('c1'))?.name).toBe('Ana Gómez');
    expect(await ids('customerAccounts')).toEqual(['c1']);
    expect((await db.customerAccounts.get('c1'))?.creditLimit).toBe(500);
  });

  it('una cuenta que el origen ya no informa se borra aunque el cliente siga', async () => {
    await db.customers.put({ id: 'c1', name: 'Ana', createdAt: now });
    await db.customerAccounts.put({
      customerId: 'c1',
      creditLimit: 100,
      margin: 0,
      balance: 0,
      updatedAt: now,
    });

    await reconcile(
      snapshot({
        products: [product('p1')],
        customers: [{ id: 'c1', name: 'Ana', createdAt: now }],
      }),
      { now },
    );

    expect(await ids('customers')).toEqual(['c1']);
    expect(await ids('customerAccounts')).toEqual([]);
  });
});

describe('applySnapshotReconciled — salvaguardas', () => {
  it('conserva un cliente creado acá cuyo alta todavía está pendiente en el outbox', async () => {
    const local = { id: 'c-local', name: 'Nuevo', createdAt: now };
    await db.customers.bulkPut([local, { id: 'c-viejo', name: 'Viejo', createdAt: now }]);
    await db.outbox.add(buildOutboxEventForCustomer(local, { now, origin: {} }));

    await reconcile(
      snapshot({
        products: [product('p1')],
        customers: [{ id: 'c1', name: 'Ana', createdAt: now }],
      }),
      { now },
    );

    expect(await ids('customers')).toEqual(['c-local', 'c1']);
  });

  it('un cliente cuyo alta ya se envió (synced) y no vuelve en la foto sí se borra', async () => {
    const local = { id: 'c-local', name: 'Nuevo', createdAt: now };
    await db.customers.put(local);
    await db.outbox.add({
      ...buildOutboxEventForCustomer(local, { now, origin: {} }),
      status: 'synced',
    });

    await reconcile(
      snapshot({
        products: [product('p1')],
        customers: [{ id: 'c1', name: 'Ana', createdAt: now }],
      }),
      { now },
    );

    expect(await ids('customers')).toEqual(['c1']);
  });

  it('un snapshot vacío con datos locales no borra nada y lo informa como omitido', async () => {
    await db.products.bulkPut([product('p1'), product('p2')]);

    const result = await reconcile(snapshot(), { now });

    expect(result).toEqual({ skipped: ['products'] });
    expect(await ids('products')).toEqual(['p1', 'p2']);
  });

  it('omite solo la tabla vacía y reconcilia el resto', async () => {
    await db.products.bulkPut([product('p1'), product('p2')]);
    await db.customers.bulkPut([
      { id: 'c1', name: 'Ana', createdAt: now },
      { id: 'c2', name: 'Beto', createdAt: now },
    ]);

    const result = await reconcile(
      snapshot({ products: [], customers: [{ id: 'c1', name: 'Ana', createdAt: now }] }),
      { now },
    );

    expect(result).toEqual({ skipped: ['products'] });
    expect(await ids('products')).toEqual(['p1', 'p2']);
    expect(await ids('customers')).toEqual(['c1']);
  });

  it('tablas vacías sin nada local que borrar no cuentan como omitidas', async () => {
    const result = await reconcile(snapshot({ products: [product('p1')] }), { now });

    expect(result).toEqual({ skipped: [] });
    expect(await ids('products')).toEqual(['p1']);
  });

  it('stock vacío con stock local: se conserva y se informa (un backend sin stock nunca lo tuvo)', async () => {
    await db.stock.put(stockOf('p1'));

    const result = await reconcile(snapshot({ products: [product('p1')] }), { now });

    expect(result).toEqual({ skipped: ['stock'] });
    expect(await ids('stock')).toEqual(['p1']);
  });

  it('nunca toca ventas, turnos, movimientos, el outbox ni la venta en curso', async () => {
    const sale: Sale = {
      id: 's1',
      lines: [],
      payments: [],
      total: 0,
      status: 'closed',
      createdAt: now,
    };
    await db.sales.put(sale);
    await db.outbox.add({
      type: 'sale',
      sale,
      id: 's1',
      status: 'pending',
      createdAt: now,
    });

    await reconcile(snapshot({ products: [product('p1')] }), { now });

    await expect(db.sales.count()).resolves.toBe(1);
    await expect(db.outbox.count()).resolves.toBe(1);
  });
});

describe('applySnapshotReconciled', () => {
  it('con allowEmptyTables, una tabla que llega vacía borra lo local', async () => {
    await db.products.put(product('p1'));
    await db.transaction('rw', db.tables, () =>
      applySnapshotReconciled(snapshot({ products: [] }), { now, allowEmptyTables: true }),
    );
    expect(await db.products.count()).toBe(0);
  });
});
