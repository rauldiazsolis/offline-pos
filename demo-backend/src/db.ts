import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Tablas espejo de los recursos del Connector API, más `idempotency_keys`
 * (dedup de cualquier POST de evento — RNF-07), `account_hold_attempts`
 * (log de todo intento de cuenta corriente, aprobado o no, para el panel) y
 * `account_holds` (el estado real de cada hold — `pending`/`confirmed`/
 * `released` — usado para calcular el crédito disponible de un cliente
 * restando los holds `pending` de otros cobros en curso). El payload de cada
 * recurso se guarda como JSON crudo (`payload TEXT`) en vez de columnas por
 * campo — este es un backend de demostración, no necesita un mapeo
 * relacional completo para cumplir el contrato.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock (
  product_id TEXT PRIMARY KEY,
  quantity INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sale_voids (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
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
`;

/** Abre (creando el directorio del archivo si hace falta) y aplica el schema — idempotente. */
export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}
