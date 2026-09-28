import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

describe('migración a la versión 8 (#101)', () => {
  it('pasa el saldo de cada cuenta a customerBalances y lo saca de la cuenta', async () => {
    const legacy = new Dexie('offline-pos');
    legacy.version(7).stores({ customerAccounts: 'customerId' });
    await legacy.open();
    await legacy.table('customerAccounts').put({
      customerId: 'c1',
      creditLimit: 1000,
      margin: 0,
      balance: 250,
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    legacy.close();

    const { db } = await import('./db.ts');
    await db.open();
    expect(await db.customerBalances.get('c1')).toEqual({
      customerId: 'c1',
      balance: 250,
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    expect(await db.customerAccounts.get('c1')).toEqual({
      customerId: 'c1',
      creditLimit: 1000,
      margin: 0,
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    db.close();
  });
});
