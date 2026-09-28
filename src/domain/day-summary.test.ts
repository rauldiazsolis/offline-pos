import { describe, expect, it } from 'vitest';
import type { CashCount } from './cash-count.ts';
import type { CashMovement } from './cash-movement.ts';
import { buildDayEntries, calculateDaySummary } from './day-summary.ts';
import type { Sale } from './sale.ts';

function sale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 's1',
    lines: [{ kind: 'freeform', description: 'x', qty: 1, unitPrice: 1000 }],
    payments: [{ method: 'cash', amount: 1000 }],
    total: 1000,
    status: 'closed',
    createdAt: '2026-09-24T10:00:00.000Z',
    ...overrides,
  };
}

function movement(overrides: Partial<CashMovement> = {}): CashMovement {
  return {
    id: 'm1',
    direction: 'in',
    amount: 100,
    concept: 'Cambio',
    source: 'manual',
    createdAt: '2026-09-24T09:00:00.000Z',
    ...overrides,
  };
}

const noVoids = new Set<string>();

describe('calculateDaySummary', () => {
  it('una venta y su anulación: total 0, dos tickets, una anulada', () => {
    const original = sale();
    const voidTicket = sale({
      id: 's2',
      voidsSaleId: 's1',
      lines: [{ kind: 'freeform', description: 'x', qty: -1, unitPrice: 1000 }],
      payments: [{ method: 'cash', amount: -1000 }],
      total: -1000,
    });

    const summary = calculateDaySummary({
      sales: [original, voidTicket],
      movements: [],
      voidedSaleIds: new Set(['s1']),
    });

    expect(summary).toMatchObject({ totalSold: 0, ticketCount: 2, voidedCount: 1 });
    expect(summary.cash.sales).toBe(0);
  });

  it('una venta legada con status voided no suma a ningún total', () => {
    const summary = calculateDaySummary({
      sales: [sale({ status: 'voided' })],
      movements: [],
      voidedSaleIds: noVoids,
    });

    expect(summary).toMatchObject({ totalSold: 0, ticketCount: 1, voidedCount: 1 });
    expect(summary.totalsByMethod.cash).toBe(0);
  });

  it('totales por medio y otros pagos', () => {
    const summary = calculateDaySummary({
      sales: [
        sale({
          payments: [
            { method: 'cash', amount: 400 },
            { method: 'debit', amount: 350 },
            { method: 'qr', amount: 250 },
          ],
        }),
      ],
      movements: [],
      voidedSaleIds: noVoids,
    });

    expect(summary.totalsByMethod).toMatchObject({ cash: 400, debit: 350, qr: 250 });
    expect(summary.otherPayments).toBe(600);
  });

  it('adjustmentTotal es el total menos el subtotal bruto de las líneas', () => {
    const summary = calculateDaySummary({
      sales: [sale({ total: 900, payments: [{ method: 'cash', amount: 900 }] })],
      movements: [],
      voidedSaleIds: noVoids,
    });

    expect(summary.adjustmentTotal).toBe(-100);
  });

  it('efectivo: ingresos, egresos y ajustes por arqueo con signo', () => {
    const summary = calculateDaySummary({
      sales: [sale()],
      movements: [
        movement({ id: 'm1', direction: 'in', amount: 500 }),
        movement({ id: 'm2', direction: 'out', amount: 200 }),
        movement({ id: 'm3', direction: 'in', amount: 30, source: 'count-adjustment' }),
        movement({ id: 'm4', direction: 'out', amount: 50, source: 'count-adjustment' }),
      ],
      voidedSaleIds: noVoids,
    });

    expect(summary.cash).toEqual({ sales: 1000, income: 500, expense: 200, countAdjustments: -20 });
  });
});

describe('buildDayEntries', () => {
  it('mezcla ventas, movimientos y arqueos por hora ascendente', () => {
    const count: CashCount = {
      id: 'c1',
      expected: 0,
      counted: 0,
      createdAt: '2026-09-24T08:00:00.000Z',
    };
    const entries = buildDayEntries({
      sales: [sale({ createdAt: '2026-09-24T10:00:00.000Z' })],
      movements: [movement({ createdAt: '2026-09-24T09:00:00.000Z' })],
      counts: [count],
    });

    expect(entries.map((entry) => entry.kind)).toEqual(['count', 'movement', 'sale']);
    expect(entries[0]?.at).toBe(count.createdAt);
  });
});
