import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db.ts';
import { seedCustomersIfEmpty } from './seed-customers.ts';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('seedCustomersIfEmpty', () => {
  it('siembra clientes de ejemplo cuando la tabla está vacía', async () => {
    const result = await seedCustomersIfEmpty({ now: '2026-01-01T00:00:00.000Z' });

    expect(result).toEqual({ ok: true, value: { seeded: true } });
    const customers = await db.customers.toArray();
    expect(customers.length).toBeGreaterThan(0);
  });

  it('al menos un cliente sembrado tiene documento y teléfono', async () => {
    await seedCustomersIfEmpty({ now: '2026-01-01T00:00:00.000Z' });

    const customers = await db.customers.toArray();
    expect(customers.some((customer) => customer.document !== undefined)).toBe(true);
    expect(customers.some((customer) => customer.phone !== undefined)).toBe(true);
  });

  it('no vuelve a sembrar si ya hay clientes', async () => {
    await seedCustomersIfEmpty({ now: '2026-01-01T00:00:00.000Z' });
    const countAfterFirstSeed = await db.customers.count();

    const result = await seedCustomersIfEmpty({ now: '2026-01-02T00:00:00.000Z' });

    expect(result).toEqual({ ok: true, value: { seeded: false } });
    await expect(db.customers.count()).resolves.toBe(countAfterFirstSeed);
  });
});
