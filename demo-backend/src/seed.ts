import type { DatabaseSync } from 'node:sqlite';
import productsFixture from './fixtures/products.json' with { type: 'json' };
import customersFixture from './fixtures/customers.json' with { type: 'json' };
import almacenCustomers from './fixtures/almacen-customers.json' with { type: 'json' };
import almacenProducts from './fixtures/almacen-products.json' with { type: 'json' };

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

/** Templates de `POST /demo-sessions` (4.4.0, #128): cada uno es un juego de fixtures. */
export const TEMPLATES = {
  kiosco: { products: productsFixture, customers: customersFixture },
  almacen: { products: almacenProducts, customers: almacenCustomers },
} as const;
export type TemplateName = keyof typeof TEMPLATES;

/** Nombre de la empresa de cada demo, para `/info` (4.5.0, #193). */
export const DEMO_COMPANY_NAMES: Record<TemplateName, string> = {
  kiosco: 'Kiosco de demo',
  almacen: 'Almacén de demo',
};
export const DEFAULT_TEMPLATE: TemplateName = 'kiosco';

export function isTemplateName(value: string): value is TemplateName {
  return Object.hasOwn(TEMPLATES, value);
}

function insertSeedRows(db: DatabaseSync, now: string, template: TemplateName): void {
  const fixtures = TEMPLATES[template];
  const insertProduct = db.prepare(
    'INSERT INTO products (id, payload, updated_at) VALUES (?, ?, ?)',
  );
  const insertStock = db.prepare(
    'INSERT INTO stock (product_id, quantity, updated_at) VALUES (?, ?, ?)',
  );
  for (const entry of fixtures.products as ProductFixtureEntry[]) {
    const { initialStock, ...product } = entry;
    insertProduct.run(entry.id, JSON.stringify(product), now);
    insertStock.run(entry.id, initialStock, now);
  }

  const insertCustomer = db.prepare(
    'INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)',
  );
  for (const entry of fixtures.customers as CustomerFixtureEntry[]) {
    insertCustomer.run(entry.id, JSON.stringify(entry), 'seed', now);
  }
}

/** Siembra desde el fixture local solo si `products` está vacía — mismo criterio que `seedCatalogIfEmpty` del POS. */
export function seedIfEmpty(db: DatabaseSync, now: string): void {
  const row = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
  if (row.count > 0) {
    return;
  }
  insertSeedRows(db, now, DEFAULT_TEMPLATE);
}

/**
 * Vacía todas las tablas de datos (nunca `idempotency_keys` a medias — se borra también) y vuelve a
 * sembrar con el template pedido. Usado por `POST /_demo/reset` y `POST /demo-sessions` (#128).
 */
export function resetToSeed(
  db: DatabaseSync,
  now: string,
  template: TemplateName = DEFAULT_TEMPLATE,
): void {
  db.exec(`
    DELETE FROM products;
    DELETE FROM stock;
    DELETE FROM customers;
    DELETE FROM sales;
    DELETE FROM stock_movements;
    DELETE FROM cash_movements;
    DELETE FROM customer_payments;
    DELETE FROM account_hold_attempts;
    DELETE FROM account_holds;
    DELETE FROM idempotency_keys;
    DELETE FROM push_lots;
    DELETE FROM demo_settings;
  `);
  insertSeedRows(db, now, template);
}
