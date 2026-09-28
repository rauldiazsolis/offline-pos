import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOutboxEventForSale, markSynced } from '../domain/outbox.ts';
import type { Sale } from '../domain/sale.ts';
import { db } from './db.ts';
import { runLocalCleanup } from './local-cleanup.ts';

const now = '2026-09-24T12:00:00.000Z';
const old = '2026-09-10T12:00:00.000Z';
const recent = '2026-09-20T12:00:00.000Z';
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
    await db.cashCounts.add({ id: 'c1', expected: 0, counted: 0, createdAt: recent });
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
        counts: {
          sales: 1,
          stockMovements: 1,
          accountMovements: 0,
          outbox: 1,
          cashMovements: 0,
          cashCounts: 0,
        },
        anchorAt: recent,
      },
    });
    expect(await db.sales.get('s-old')).toBeUndefined();
    expect(await db.sales.get('s-pend')).not.toBeUndefined();
    expect(await db.stockMovements.get('m1')).toBeUndefined();
    expect(await db.outbox.get('s-pend')).not.toBeUndefined();
  });

  it('borra movimientos de caja y arqueos anteriores al último arqueo, y lo informa', async () => {
    await db.cashCounts.bulkAdd([
      { id: 'c-old', expected: 0, counted: 0, createdAt: old },
      { id: 'c-last', expected: 0, counted: 0, createdAt: recent },
    ]);
    await db.cashMovements.add({
      id: 'cm-old',
      direction: 'in',
      amount: 10,
      concept: 'X',
      source: 'manual',
      createdAt: old,
    });

    const report = await runLocalCleanup({ now, protectedEventIds: new Set() });

    expect(report.ok && report.value.counts).toMatchObject({ cashMovements: 1, cashCounts: 1 });
    expect(report.ok && report.value.anchorAt).toBe(recent);
    await expect(db.cashCounts.get('c-last')).resolves.not.toBeUndefined();
  });

  it('si Dexie falla devuelve storage/cleanup-failed', async () => {
    await db.cashCounts.add({ id: 'c1', expected: 0, counted: 0, createdAt: recent });
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
