import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Tablas espejo de los recursos del Connector API (contrato v3, #96), más
 * `idempotency_keys` (dedup de cualquier POST de evento — RNF-07),
 * `account_hold_attempts` (log de todo intento de cuenta corriente, aprobado
 * o no, para el panel), `account_holds` (el estado real de cada hold —
 * `pending`/`confirmed`/`released` — usado para calcular el crédito
 * disponible de un cliente restando los holds `pending` de otros cobros en
 * curso), `push_lots` (cada lote de `/sync/push` con sus eventos: se recibe
 * `queued` y se procesa aparte, ver `lots.ts`) y `demo_settings` (la demora
 * de lotes, el modo mantenimiento y "simular contrato 3.0.0" del panel —
 * `settings.ts`). Una anulación es una venta más (`voidsSaleId`, 4.0.0 — #99),
 * sin tabla propia. Cada evento guarda el dispositivo del lote y la
 * sucursal/punto de venta de su origen. El payload de cada recurso se guarda
 * como JSON crudo (`payload TEXT`) en vez de columnas por campo — este es un
 * backend de demostración, no necesita un mapeo relacional completo para
 * cumplir el contrato.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock (
  product_id TEXT PRIMARY KEY,
  quantity REAL NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  source TEXT NOT NULL,
  device_id TEXT,
  branch TEXT,
  point_of_sale TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  device_id TEXT,
  branch TEXT,
  point_of_sale TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  device_id TEXT,
  branch TEXT,
  point_of_sale TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  device_id TEXT,
  branch TEXT,
  point_of_sale TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_payments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  device_id TEXT,
  branch TEXT,
  point_of_sale TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_hold_attempts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_holds (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  released_at TEXT
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_lots (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  status TEXT NOT NULL,
  events TEXT NOT NULL,
  issues TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS demo_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Subir cuando cambia el schema: una base vieja se recrea vacía (es una demo) y el arranque resiembra. */
export const SCHEMA_VERSION = 4;

/**
 * Abre (creando el directorio del archivo si hace falta) y aplica el schema — idempotente. Una base
 * con otra `user_version` se vacía entera antes (sin migraciones: es una demo; `server.ts` resiembra
 * solo porque `products` queda vacía).
 */
export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  const db = new DatabaseSync(path);
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  if (version !== SCHEMA_VERSION) {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    for (const { name } of tables) {
      db.exec(`DROP TABLE IF EXISTS "${name}"`);
    }
    db.exec(`PRAGMA user_version = ${String(SCHEMA_VERSION)}`);
  }
  db.exec(SCHEMA);
  return db;
}
