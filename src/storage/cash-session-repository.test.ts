import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeCashSessionAndPersist,
  getCurrentOpenCashSession,
  openCashSessionAndPersist,
} from './cash-session-repository.ts';
import { db } from './db.ts';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('getCurrentOpenCashSession', () => {
  it('undefined si no hay ninguno', async () => {
    expect(await getCurrentOpenCashSession()).toBeUndefined();
  });
});

describe('openCashSessionAndPersist', () => {
  it('abre un turno y lo persiste', async () => {
    const result = await openCashSessionAndPersist({ openingAmount: 500 });

    expect(result.ok).toBe(true);
    const open = await getCurrentOpenCashSession();
    expect(open?.openingAmount).toBe(500);
    expect(open?.sales).toEqual([]);
  });

  it('rechaza abrir un segundo turno mientras el primero sigue abierto', async () => {
    await openCashSessionAndPersist({ openingAmount: 500 });

    const result = await openCashSessionAndPersist({ openingAmount: 100 });

    expect(result).toEqual({ ok: false, error: 'cash-session/already-open', meta: undefined });
  });
});

describe('closeCashSessionAndPersist', () => {
  it('rechaza cerrar si no hay ningún turno abierto', async () => {
    const result = await closeCashSessionAndPersist({ closingAmount: 500 });

    expect(result).toEqual({ ok: false, error: 'cash-session/none-open', meta: undefined });
  });

  it('cierra el turno, calcula el resumen y encola el evento de outbox', async () => {
    await openCashSessionAndPersist({ openingAmount: 500 });
    await db.sales.add({
      id: 's1',
      lines: [],
      payments: [{ method: 'cash', amount: 100 }],
      total: 100,
      status: 'closed',
      createdAt: '2026-01-01T10:00:00.000Z',
    });
    const openSession = await getCurrentOpenCashSession();
    if (openSession !== undefined) {
      await db.cashSessions.put({ ...openSession, sales: ['s1'] });
    }

    const result = await closeCashSessionAndPersist({ closingAmount: 590 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.session.closingAmount).toBe(590);
      expect(result.value.summary).toEqual({
        salesCount: 1,
        totalsByMethod: { cash: 100, debit: 0, credit: 0, transfer: 0, qr: 0, account: 0 },
        expectedCash: 600,
        countedCash: 590,
        difference: -10,
      });
    }
    expect(await getCurrentOpenCashSession()).toBeUndefined();

    const outboxEvents = await db.outbox.toArray();
    const cashSessionEvent = outboxEvents.find((event) => event.type === 'cash-session');
    expect(cashSessionEvent?.status).toBe('pending');
  });

  it('rechaza cerrar un turno que ya está cerrado (dos cierres seguidos)', async () => {
    await openCashSessionAndPersist({ openingAmount: 500 });
    await closeCashSessionAndPersist({ closingAmount: 500 });

    const result = await closeCashSessionAndPersist({ closingAmount: 500 });

    expect(result).toEqual({ ok: false, error: 'cash-session/none-open', meta: undefined });
  });
});
