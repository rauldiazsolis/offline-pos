import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';

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
        'cash_sessions',
        'customers',
        'idempotency_keys',
        'products',
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
});
