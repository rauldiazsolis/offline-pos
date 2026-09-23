import type { DatabaseSync } from 'node:sqlite';
import productsFixture from './fixtures/products.json' with { type: 'json' };
import customersFixture from './fixtures/customers.json' with { type: 'json' };

type ProductFixtureEntry = {
  id: string;
  sku: string;
  barcodes: string[];
  name: string;
  price: number;
  taxRate: number;
  category: string;
  tracksStock: boolean;
  createdAt: string;
  blocked?: { reason: string };
  initialStock: number;
};

type CustomerFixtureEntry = {
  id: string;
  name: string;
  document?: string;
  phone?: string;
  creditLimit?: number;
  margin?: number;
  balance?: number;
  createdAt: string;
  blocked?: { reason: string };
};

function insertSeedRows(db: DatabaseSync, now: string): void {
  const insertProduct = db.prepare(
    'INSERT INTO products (id, payload, updated_at) VALUES (?, ?, ?)',
  );
  const insertStock = db.prepare(
    'INSERT INTO stock (product_id, quantity, updated_at) VALUES (?, ?, ?)',
  );
  for (const entry of productsFixture as ProductFixtureEntry[]) {
    const { initialStock, ...product } = entry;
    insertProduct.run(entry.id, JSON.stringify(product), now);
    insertStock.run(entry.id, initialStock, now);
  }

  const insertCustomer = db.prepare(
    'INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)',
  );
  for (const entry of customersFixture as CustomerFixtureEntry[]) {
    insertCustomer.run(entry.id, JSON.stringify(entry), 'seed', now);
  }
}

/** Siembra desde el fixture local solo si `products` está vacía — mismo criterio que `seedCatalogIfEmpty` del POS. */
export function seedIfEmpty(db: DatabaseSync, now: string): void {
  const row = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
  if (row.count > 0) {
    return;
  }
  insertSeedRows(db, now);
}

/** Vacía todas las tablas de datos (nunca `idempotency_keys` a medias — se borra también) y vuelve a sembrar. Usado por `POST /_demo/reset`. */
export function resetToSeed(db: DatabaseSync, now: string): void {
  db.exec(`
    DELETE FROM products;
    DELETE FROM stock;
    DELETE FROM customers;
    DELETE FROM sales;
    DELETE FROM sale_voids;
    DELETE FROM stock_movements;
    DELETE FROM cash_movements;
    DELETE FROM customer_payments;
    DELETE FROM account_hold_attempts;
    DELETE FROM account_holds;
    DELETE FROM idempotency_keys;
    DELETE FROM push_lots;
    DELETE FROM demo_settings;
  `);
  insertSeedRows(db, now);
}
