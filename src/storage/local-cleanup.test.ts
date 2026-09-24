import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOutboxEventForSale, markSynced } from '../domain/outbox.ts';
import type { Sale } from '../domain/sale.ts';
import { db } from './db.ts';
import { runLocalCleanup } from './local-cleanup.ts';

const now = '2026-09-24T12:00:00.000Z';
const old = '2026-09-10T12:00:00.000Z';
const origin = { branch: 'b', pointOfSale: 'p' };

function sale(id: string, createdAt: string): Sale {
  return { id, lines: [], payments: [], total: 0, status: 'closed', createdAt };
}

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
  vi.restoreAllMocks();
});

describe('runLocalCleanup', () => {
  it('borra la venta vieja sincronizada, su movimiento y su evento; deja lo pendiente', async () => {
    await db.sales.bulkAdd([sale('s-old', old), sale('s-pend', old)]);
    await db.stockMovements.add({
      id: 'm1',
      productId: 'p1',
      delta: -1,
      reason: 'sale',
      saleId: 's-old',
      createdAt: old,
    });
    await db.outbox.bulkAdd([
      markSynced(buildOutboxEventForSale(sale('s-old', old), { now: old, origin })),
      buildOutboxEventForSale(sale('s-pend', old), { now: old, origin }),
    ]);

    const report = await runLocalCleanup({ now, protectedEventIds: new Set() });

    expect(report).toEqual({
      ok: true,
      value: {
        counts: { sales: 1, stockMovements: 1, accountMovements: 0, outbox: 1, cashSessions: 0 },
      },
    });
    expect(await db.sales.get('s-old')).toBeUndefined();
    expect(await db.sales.get('s-pend')).not.toBeUndefined();
    expect(await db.stockMovements.get('m1')).toBeUndefined();
    expect(await db.outbox.get('s-pend')).not.toBeUndefined();
  });

  it('informa la fecha del ancla', async () => {
    await db.cashSessions.put({
      id: 't1',
      openedAt: old,
      closedAt: old,
      openingAmount: 0,
      sales: [],
    });
    const report = await runLocalCleanup({ now, protectedEventIds: new Set() });
    expect(report.ok && report.value.anchorClosedAt).toBe(old);
  });

  it('si Dexie falla devuelve storage/cleanup-failed', async () => {
    vi.spyOn(db.sales, 'bulkDelete').mockRejectedValueOnce(new Error('boom'));
    await db.sales.add(sale('s-old', old));
    const report = await runLocalCleanup({ now, protectedEventIds: new Set() });
    expect(report).toEqual({
      ok: false,
      error: 'storage/cleanup-failed',
      meta: { message: 'boom' },
    });
  });
});
