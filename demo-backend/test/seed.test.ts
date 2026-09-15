import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { resetToSeed, seedIfEmpty } from '../src/seed.ts';

const NOW = '2026-01-01T00:00:00.000Z';

describe('seedIfEmpty', () => {
  it('siembra products, stock y customers cuando la base está vacía', () => {
    const db = openDb(':memory:');

    seedIfEmpty(db, NOW);

    const productCount = (
      db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number }
    ).count;
    const stockCount = (
      db.prepare('SELECT COUNT(*) as count FROM stock').get() as { count: number }
    ).count;
    const customerCount = (
      db.prepare('SELECT COUNT(*) as count FROM customers').get() as { count: number }
    ).count;

    expect(productCount).toBe(24);
    expect(stockCount).toBe(24);
    expect(customerCount).toBe(22);

    const arroz = db.prepare('SELECT payload FROM products WHERE id = ?').get('alm-001') as {
      payload: string;
    };
    expect(JSON.parse(arroz.payload)).toMatchObject({ name: 'Arroz 1kg', price: 1200 });

    const arrozStock = db
      .prepare('SELECT quantity FROM stock WHERE product_id = ?')
      .get('alm-001') as { quantity: number };
    expect(arrozStock.quantity).toBe(40);

    db.close();
  });

  it('no vuelve a sembrar si products ya tiene filas', () => {
    const db = openDb(':memory:');
    seedIfEmpty(db, NOW);
    db.prepare('DELETE FROM customers').run();

    seedIfEmpty(db, NOW);

    const customerCount = (
      db.prepare('SELECT COUNT(*) as count FROM customers').get() as { count: number }
    ).count;
    // Sigue en 0: seedIfEmpty miró products (no vacío) y no volvió a sembrar nada.
    expect(customerCount).toBe(0);

    db.close();
  });
});

describe('resetToSeed', () => {
  it('borra todo (incluidos datos empujados desde el POS) y vuelve a sembrar', () => {
    const db = openDb(':memory:');
    seedIfEmpty(db, NOW);
    db.prepare('INSERT INTO sales (id, payload, created_at) VALUES (?, ?, ?)').run(
      's1',
      '{}',
      NOW,
    );
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'nuevo',
      '{}',
      'pos',
      NOW,
    );

    resetToSeed(db, NOW);

    const salesCount = (
      db.prepare('SELECT COUNT(*) as count FROM sales').get() as { count: number }
    ).count;
    const customerCount = (
      db.prepare('SELECT COUNT(*) as count FROM customers').get() as { count: number }
    ).count;
    expect(salesCount).toBe(0);
    expect(customerCount).toBe(22);

    db.close();
  });
});
