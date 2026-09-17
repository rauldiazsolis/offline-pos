import { describe, expect, it } from 'vitest';
import {
  calculateCashSessionSummary,
  calculateProductQuantities,
  closeCashSession,
  openCashSession,
  recordSaleInCashSession,
  type CashSession,
} from './cash-session.ts';
import type { Sale } from './sale.ts';

function buildSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 's1',
    // Subtotal bruto ($100) igual al `total` default — adjustmentTotal = 0 salvo que el test
    // pase sus propias `lines`/`total` a propósito para probar un ajuste.
    lines: [{ kind: 'product', productId: 'p0', qty: 1, unitPrice: 100 }],
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
      buildSale({ id: 's2', payments: [{ method: 'debit', amount: 200 }] }),
    ];

    const summary = calculateCashSessionSummary(session, sales);

    expect(summary).toEqual({
      salesCount: 2,
      totalsByMethod: { cash: 100, debit: 200, credit: 0, transfer: 0, qr: 0, account: 0 },
      totalCollected: 300,
      adjustmentTotal: 0,
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
    expect(summary.totalCollected).toBe(100);
    expect(summary.adjustmentTotal).toBe(0);
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
    expect(summary.totalCollected).toBe(100);
    expect(summary.adjustmentTotal).toBe(0);
  });

  it('adjustmentTotal suma el ajuste (línea + global) de las ventas cerradas, con signo', () => {
    const session: CashSession = { id: 'cs1', openedAt: '2026-01-01T09:00:00.000Z', openingAmount: 0, sales: ['s1', 's2'] };
    const sales = [
      // Línea de $200 con un descuento de línea de $20 → total $180 (subtotal bruto $200).
      buildSale({
        id: 's1',
        lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100, discount: { type: 'amount', value: 20 } }],
        payments: [{ method: 'cash', amount: 180 }],
        total: 180,
      }),
      // Subtotal bruto $100, recargo global aplicado → total $110.
      buildSale({
        id: 's2',
        lines: [{ kind: 'product', productId: 'p2', qty: 1, unitPrice: 100 }],
        payments: [{ method: 'cash', amount: 110 }],
        total: 110,
        globalAdjustmentPercentage: 10,
      }),
    ];

    const summary = calculateCashSessionSummary(session, sales);

    expect(summary.adjustmentTotal).toBe(-10); // -20 (descuento) + 10 (recargo)
  });

  it('totalCollected es la suma de todos los medios de pago', () => {
    const session: CashSession = { id: 'cs1', openedAt: '2026-01-01T09:00:00.000Z', openingAmount: 0, sales: ['s1'] };
    const sales = [
      buildSale({
        id: 's1',
        payments: [{ method: 'cash', amount: 60 }, { method: 'debit', amount: 40 }],
        total: 100,
      }),
    ];

    const summary = calculateCashSessionSummary(session, sales);

    expect(summary.totalCollected).toBe(100);
  });
});

describe('calculateProductQuantities', () => {
  it('agrupa por productId, sumando cantidades entre ventas', () => {
    const sales = [
      buildSale({ id: 's1', lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] }),
      buildSale({
        id: 's2',
        lines: [
          { kind: 'product', productId: 'p1', qty: 3, unitPrice: 100 },
          { kind: 'product', productId: 'p2', qty: 1, unitPrice: 50 },
        ],
      }),
    ];

    const result = calculateProductQuantities(sales);

    expect(result).toEqual(
      expect.arrayContaining([
        { productId: 'p1', qty: 5 },
        { productId: 'p2', qty: 1 },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('ignora líneas libres (sin identidad de producto)', () => {
    const sales = [
      buildSale({ id: 's1', lines: [{ kind: 'freeform', description: 'Regalo', qty: 1, unitPrice: 100 }] }),
    ];

    expect(calculateProductQuantities(sales)).toEqual([]);
  });

  it('excluye ventas anuladas', () => {
    const sales = [
      buildSale({
        id: 's1',
        lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }],
        status: 'voided',
        voidedAt: '2026-01-01T11:00:00.000Z',
      }),
    ];

    expect(calculateProductQuantities(sales)).toEqual([]);
  });
});
