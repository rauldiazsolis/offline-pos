import { describe, expect, it } from 'vitest';
import {
  calculateCashSessionSummary,
  closeCashSession,
  openCashSession,
  recordSaleInCashSession,
  type CashSession,
} from './cash-session.ts';
import type { Sale } from './sale.ts';

function buildSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 's1',
    lines: [],
    payments: [{ method: 'cash', amount: 100 }],
    total: 100,
    status: 'closed',
    createdAt: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('openCashSession', () => {
  it('abre un turno nuevo, sin ventas todavía', () => {
    const result = openCashSession({ id: 'cs1', openingAmount: 500, now: '2026-01-01T09:00:00.000Z' });

    expect(result).toEqual({
      ok: true,
      value: { id: 'cs1', openedAt: '2026-01-01T09:00:00.000Z', openingAmount: 500, sales: [] },
    });
  });

  it('rechaza un monto de apertura negativo', () => {
    const result = openCashSession({ id: 'cs1', openingAmount: -1, now: '2026-01-01T09:00:00.000Z' });

    expect(result).toEqual({ ok: false, error: 'cash-session/invalid-amount', meta: { amount: -1 } });
  });
});

describe('closeCashSession', () => {
  const openSession: CashSession = {
    id: 'cs1',
    openedAt: '2026-01-01T09:00:00.000Z',
    openingAmount: 500,
    sales: ['s1'],
  };

  it('cierra un turno abierto con el monto contado', () => {
    const result = closeCashSession(openSession, { closingAmount: 600, now: '2026-01-01T20:00:00.000Z' });

    expect(result).toEqual({
      ok: true,
      value: { ...openSession, closedAt: '2026-01-01T20:00:00.000Z', closingAmount: 600 },
    });
  });

  it('rechaza cerrar un turno ya cerrado', () => {
    const closed: CashSession = { ...openSession, closedAt: '2026-01-01T20:00:00.000Z', closingAmount: 600 };

    const result = closeCashSession(closed, { closingAmount: 600, now: '2026-01-01T21:00:00.000Z' });

    expect(result).toEqual({ ok: false, error: 'cash-session/already-closed', meta: undefined });
  });

  it('rechaza un monto contado negativo', () => {
    const result = closeCashSession(openSession, { closingAmount: -1, now: '2026-01-01T20:00:00.000Z' });

    expect(result).toEqual({ ok: false, error: 'cash-session/invalid-amount', meta: { amount: -1 } });
  });
});

describe('recordSaleInCashSession', () => {
  it('agrega el id sin sacar los que ya estaban', () => {
    const session: CashSession = { id: 'cs1', openedAt: '2026-01-01T09:00:00.000Z', openingAmount: 500, sales: ['s1'] };

    expect(recordSaleInCashSession(session, 's2').sales).toEqual(['s1', 's2']);
  });
});

describe('calculateCashSessionSummary', () => {
  it('desglosa por medio de pago y calcula el efectivo esperado sin turno cerrado todavía', () => {
    const session: CashSession = { id: 'cs1', openedAt: '2026-01-01T09:00:00.000Z', openingAmount: 500, sales: ['s1', 's2'] };
    const sales = [
      buildSale({ id: 's1', payments: [{ method: 'cash', amount: 100 }] }),
      buildSale({ id: 's2', payments: [{ method: 'card', amount: 200 }] }),
    ];

    const summary = calculateCashSessionSummary(session, sales);

    expect(summary).toEqual({
      salesCount: 2,
      totalsByMethod: { cash: 100, card: 200, other: 0, account: 0 },
      expectedCash: 600, // 500 de apertura + 100 en efectivo
    });
  });

  it('agrega countedCash/difference solo cuando el turno ya cerró', () => {
    const session: CashSession = {
      id: 'cs1',
      openedAt: '2026-01-01T09:00:00.000Z',
      closedAt: '2026-01-01T20:00:00.000Z',
      openingAmount: 500,
      closingAmount: 590,
      sales: ['s1'],
    };
    const sales = [buildSale({ id: 's1', payments: [{ method: 'cash', amount: 100 }] })];

    const summary = calculateCashSessionSummary(session, sales);

    expect(summary.expectedCash).toBe(600);
    expect(summary.countedCash).toBe(590);
    expect(summary.difference).toBe(-10);
  });

  it('excluye una venta anulada de los totales, aunque siga en sales[]', () => {
    const session: CashSession = { id: 'cs1', openedAt: '2026-01-01T09:00:00.000Z', openingAmount: 500, sales: ['s1', 's2'] };
    const sales = [
      buildSale({ id: 's1', payments: [{ method: 'cash', amount: 100 }] }),
      buildSale({ id: 's2', payments: [{ method: 'cash', amount: 50 }], status: 'voided', voidedAt: '2026-01-01T11:00:00.000Z' }),
    ];

    const summary = calculateCashSessionSummary(session, sales);

    expect(summary.salesCount).toBe(1);
    expect(summary.totalsByMethod.cash).toBe(100);
    expect(summary.expectedCash).toBe(600);
  });
});
