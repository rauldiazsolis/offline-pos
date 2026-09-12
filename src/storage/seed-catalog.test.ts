import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db.ts';
import { seedCatalogIfEmpty } from './seed-catalog.ts';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('seedCatalogIfEmpty', () => {
  it('siembra el catálogo cuando la tabla está vacía', async () => {
    const result = await seedCatalogIfEmpty({ now: '2026-01-01T00:00:00.000Z' });

    expect(result).toEqual({ ok: true, value: { seeded: true } });
    await expect(db.products.count()).resolves.toBeGreaterThan(0);
    await expect(db.stock.count()).resolves.toBe(await db.products.count());
  });

  it('no vuelve a sembrar si ya hay productos', async () => {
    await seedCatalogIfEmpty({ now: '2026-01-01T00:00:00.000Z' });
    const countAfterFirstSeed = await db.products.count();

    const result = await seedCatalogIfEmpty({ now: '2026-01-02T00:00:00.000Z' });

    expect(result).toEqual({ ok: true, value: { seeded: false } });
    await expect(db.products.count()).resolves.toBe(countAfterFirstSeed);
  });
});
