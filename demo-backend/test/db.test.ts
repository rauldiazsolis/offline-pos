import { describe, expect, it } from 'vitest';
/// <reference types="node" />
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, SCHEMA_VERSION } from '../src/db.ts';

describe('openDb', () => {
  it('crea todas las tablas del schema sobre una base en memoria', () => {
    const db = openDb(':memory:');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toEqual(
      [
        'account_hold_attempts',
        'account_holds',
        'cash_movements',
        'customer_payments',
        'customers',
        'demo_settings',
        'idempotency_keys',
        'products',
        'push_lots',
        'sale_voids',
        'sales',
        'stock',
        'stock_movements',
      ].sort(),
    );

    db.close();
  });

  it('permite insertar y leer una fila (round-trip real, no solo el schema)', () => {
    const db = openDb(':memory:');

    db.prepare('INSERT INTO products (id, payload, updated_at) VALUES (?, ?, ?)').run(
      'p1',
      JSON.stringify({ name: 'Test' }),
      '2026-01-01T00:00:00.000Z',
    );
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get('p1') as {
      id: string;
      payload: string;
    };

    expect(row.id).toBe('p1');
    expect(JSON.parse(row.payload)).toEqual({ name: 'Test' });

    db.close();
  });

  it('una base con otra versión de schema se recrea vacía', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-db-'));
    const path = join(dir, 'demo.sqlite');
    try {
      const old = new DatabaseSync(path);
      old.exec(
        'CREATE TABLE cash_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);',
      );
      old.exec("INSERT INTO cash_sessions VALUES ('cs1', '{}', 'x')");
      old.close();

      const db = openDb(path);
      const names = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((table) => table.name);
      const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
      db.close();

      expect(names).not.toContain('cash_sessions');
      expect(names).toContain('push_lots');
      expect(version.user_version).toBe(SCHEMA_VERSION);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('una base ya en la versión actual conserva sus datos al reabrirse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-db-'));
    const path = join(dir, 'demo.sqlite');
    try {
      const first = openDb(path);
      first
        .prepare('INSERT INTO products (id, payload, updated_at) VALUES (?, ?, ?)')
        .run('p1', '{}', 'x');
      first.close();

      const again = openDb(path);
      const count = again.prepare('SELECT COUNT(*) AS c FROM products').get() as { c: number };
      again.close();

      expect(count.c).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
