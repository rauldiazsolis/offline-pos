import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeCashSessionAndPersist,
  getCurrentOpenCashSession,
  getMostRecentClosedCashSession,
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

  it('cierra el turno y calcula el resumen, sin encolar nada (contrato v3)', async () => {
    await openCashSessionAndPersist({ openingAmount: 500 });
    await db.sales.add({
      id: 's1',
      lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }],
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
        totalCollected: 100,
        adjustmentTotal: 0,
        expectedCash: 600,
        countedCash: 590,
        difference: -10,
      });
    }
    expect(await getCurrentOpenCashSession()).toBeUndefined();

    // Contrato v3 (#96): el turno local sigue hasta la Etapa 5, pero ya no viaja.
    expect(await db.outbox.count()).toBe(0);
  });

  it('rechaza cerrar un turno que ya está cerrado (dos cierres seguidos)', async () => {
    await openCashSessionAndPersist({ openingAmount: 500 });
    await closeCashSessionAndPersist({ closingAmount: 500 });

    const result = await closeCashSessionAndPersist({ closingAmount: 500 });

    expect(result).toEqual({ ok: false, error: 'cash-session/none-open', meta: undefined });
  });
});

describe('getMostRecentClosedCashSession', () => {
  it('undefined si no hay ningún turno cerrado', async () => {
    expect(await getMostRecentClosedCashSession()).toBeUndefined();
  });

  it('devuelve el turno cerrado más reciente, no el más viejo', async () => {
    await openCashSessionAndPersist({ openingAmount: 100 });
    await closeCashSessionAndPersist({ closingAmount: 100 });
    await openCashSessionAndPersist({ openingAmount: 200 });
    await closeCashSessionAndPersist({ closingAmount: 200 });

    const mostRecent = await getMostRecentClosedCashSession();

    expect(mostRecent?.openingAmount).toBe(200);
  });

  it('ignora un turno abierto — solo mira cerrados', async () => {
    await openCashSessionAndPersist({ openingAmount: 100 });
    await closeCashSessionAndPersist({ closingAmount: 100 });
    await openCashSessionAndPersist({ openingAmount: 999 }); // queda abierto

    const mostRecent = await getMostRecentClosedCashSession();

    expect(mostRecent?.openingAmount).toBe(100);
  });
});
