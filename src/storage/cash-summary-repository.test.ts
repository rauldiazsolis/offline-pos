import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCashSummaryContext } from './cash-summary-repository.ts';
import { db } from './db.ts';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('getCashSummaryContext', () => {
  it('trae las ventas de hoy', async () => {
    const now = new Date().toISOString();
    await db.sales.add({
      id: 's1',
      lines: [],
      payments: [{ method: 'cash', amount: 50 }],
      total: 50,
      status: 'closed',
      createdAt: now,
    });

    const context = await getCashSummaryContext(now);

    expect(context.sales).toHaveLength(1);
    expect(context.summary.ticketCount).toBe(1);
  });
});
