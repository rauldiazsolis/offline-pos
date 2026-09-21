import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeCashSessionAndPersist,
  getCurrentOpenCashSession,
  openCashSessionAndPersist,
} from './cash-session-repository.ts';
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
  it('undefined si nunca hubo ningún turno', async () => {
    expect(await getCashSummaryContext()).toBeUndefined();
  });

  it('con un turno abierto, isClosed es false y trae sus ventas', async () => {
    await openCashSessionAndPersist({ openingAmount: 100 });
    const open = await getCurrentOpenCashSession();
    await db.sales.add({
      id: 's1',
      lines: [],
      payments: [{ method: 'cash', amount: 50 }],
      total: 50,
      status: 'closed',
      createdAt: '2026-01-01T10:00:00.000Z',
    });
    if (open !== undefined) await db.cashSessions.put({ ...open, sales: ['s1'] });

    const context = await getCashSummaryContext();

    expect(context?.isClosed).toBe(false);
    expect(context?.sales).toHaveLength(1);
    expect(context?.summary.salesCount).toBe(1);
  });

  it('sin turno abierto, cae al turno cerrado más reciente con isClosed true', async () => {
    await openCashSessionAndPersist({ openingAmount: 100 });
    await closeCashSessionAndPersist({ closingAmount: 100 });

    const context = await getCashSummaryContext();

    expect(context?.isClosed).toBe(true);
    expect(context?.session.closingAmount).toBe(100);
  });
});
