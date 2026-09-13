import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db.ts';
import { createCustomerLocally, loadCustomerRepository, releaseAccountHold } from './customer-repository.ts';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('createCustomerLocally', () => {
  it('persiste el cliente y encola un evento de outbox customer', async () => {
    const result = await createCustomerLocally('Juan Pérez');

    expect(result.ok).toBe(true);
    if (result.ok) {
      const stored = await db.customers.get(result.value.id);
      expect(stored?.name).toBe('Juan Pérez');

      const outboxEvent = await db.outbox.get(result.value.id);
      expect(outboxEvent).toMatchObject({ type: 'customer', status: 'pending' });
    }
  });
});

describe('loadCustomerRepository', () => {
  it('permite buscar por nombre y resolver por id tras un alta', async () => {
    const created = await createCustomerLocally('Ana García');
    if (!created.ok) {
      throw new Error('setup falló');
    }

    const repo = await loadCustomerRepository();

    expect(repo.getCustomer(created.value.id)).toEqual(created.value);
    expect(repo.search('Ana').map((result) => result.customer.id)).toContain(created.value.id);
  });

  it('getCustomerAccount devuelve undefined si no hay cuenta cacheada', async () => {
    const repo = await loadCustomerRepository();
    expect(await repo.getCustomerAccount('nadie')).toBeUndefined();
  });

  it('getCustomerAccount lee el balance cacheado más reciente', async () => {
    await db.customerAccounts.add({
      customerId: 'c1',
      creditLimit: 1000,
      margin: 0,
      balance: 300,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const repo = await loadCustomerRepository();
    expect((await repo.getCustomerAccount('c1'))?.balance).toBe(300);
  });
});

describe('releaseAccountHold', () => {
  it('encola un evento account-hold-release con un id propio', async () => {
    const result = await releaseAccountHold({ holdId: 'hold-1' });

    expect(result.ok).toBe(true);
    const events = await db.outbox.where('status').equals('pending').toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'account-hold-release', holdId: 'hold-1' });
    expect(events[0]?.id).not.toBe('hold-1');
  });
});
