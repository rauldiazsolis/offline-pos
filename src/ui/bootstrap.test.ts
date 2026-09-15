import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../storage/db.ts';
import { bootstrap } from './bootstrap.ts';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
});

describe('bootstrap', () => {
  it('no siembra catálogo ni clientes localmente — una terminal nueva arranca vacía hasta el primer sync', async () => {
    await bootstrap();

    await expect(db.products.count()).resolves.toBe(0);
    await expect(db.customers.count()).resolves.toBe(0);
  });
});
