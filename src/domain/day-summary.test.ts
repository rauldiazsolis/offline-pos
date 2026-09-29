import { describe, expect, it } from 'vitest';
import type { CashCount } from './cash-count.ts';
import type { CashMovement } from './cash-movement.ts';
import type { CustomerPayment } from './customer-payment.ts';
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

function collection(overrides: Partial<CustomerPayment> = {}): CustomerPayment {
  return {
    id: 'cp1',
    customerId: 'c1',
    payments: [{ method: 'cash', amount: 100 }],
    total: 100,
    createdAt: '2026-09-24T11:00:00.000Z',
    ...overrides,
  };
}

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
      voidedPaymentIds: new Set(),
      collections: [],
    });

    expect(summary).toMatchObject({ totalSold: 0, ticketCount: 2, voidedCount: 1 });
    expect(summary.cash.sales).toBe(0);
  });

  it('una venta legada con status voided no suma a ningún total', () => {
    const summary = calculateDaySummary({
      sales: [sale({ status: 'voided' })],
      movements: [],
      voidedSaleIds: noVoids,
      voidedPaymentIds: new Set(),
      collections: [],
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
      voidedPaymentIds: new Set(),
      collections: [],
    });

    expect(summary.totalsByMethod).toMatchObject({ cash: 400, debit: 350, qr: 250 });
    expect(summary.otherPayments).toBe(600);
  });

  it('adjustmentTotal es el total menos el subtotal bruto de las líneas', () => {
    const summary = calculateDaySummary({
      sales: [sale({ total: 900, payments: [{ method: 'cash', amount: 900 }] })],
      movements: [],
      voidedSaleIds: noVoids,
      voidedPaymentIds: new Set(),
      collections: [],
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
      voidedPaymentIds: new Set(),
      collections: [],
    });

    expect(summary.cash).toEqual({
      sales: 1000,
      income: 500,
      expense: 200,
      countAdjustments: -20,
      collections: 0,
    });
  });
});

describe('buildDayEntries', () => {
  it('mezcla ventas, movimientos y arqueos con lo más nuevo primero (#124)', () => {
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
      collections: [],
    });

    expect(entries.map((entry) => entry.kind)).toEqual(['sale', 'movement', 'count']);
    expect(entries[2]?.at).toBe(count.createdAt);
  });
});

describe('cobranzas en el resumen del día (#101)', () => {
  const collections = [
    collection({
      id: 'cp1',
      payments: [
        { method: 'cash', amount: 500 },
        { method: 'transfer', amount: 200 },
      ],
      total: 700,
      createdAt: '2026-09-24T11:00:00.000Z',
    }),
    collection({
      id: 'cp2',
      payments: [{ method: 'debit', amount: 100 }],
      total: 100,
      createdAt: '2026-09-24T09:30:00.000Z',
    }),
  ];

  it('una cobranza y su anulación: total 0, dos recibos, uno anulado (#125)', () => {
    const summary = calculateDaySummary({
      sales: [],
      movements: [],
      voidedSaleIds: noVoids,
      voidedPaymentIds: new Set(['cp1']),
      collections: [
        collection({ id: 'cp1', total: 100 }),
        collection({
          id: 'cp2',
          payments: [{ method: 'cash', amount: -100 }],
          total: -100,
          voidsPaymentId: 'cp1',
        }),
      ],
    });
    expect(summary.collections).toEqual({ total: 0, count: 2, voidedCount: 1 });
    expect(summary.cash.collections).toBe(0);
  });

  it('se suman aparte: no son ventas', () => {
    const summary = calculateDaySummary({
      sales: [sale()],
      movements: [],
      voidedSaleIds: noVoids,
      voidedPaymentIds: new Set(),
      collections,
    });

    expect(summary).toMatchObject({ totalSold: 1000, ticketCount: 1 });
    expect(summary.collections).toEqual({ total: 800, count: 2, voidedCount: 0 });
    expect(summary.collectionsByMethod).toEqual({
      cash: 500,
      debit: 100,
      credit: 0,
      transfer: 200,
      qr: 0,
      account: 0,
    });
    expect(summary.totalsByMethod.cash).toBe(1000);
    expect(summary.otherPayments).toBe(0);
    expect(summary.cash).toMatchObject({ sales: 1000, collections: 500 });
  });

  it('Movimientos intercala las cobranzas por hora, lo más nuevo primero', () => {
    const entries = buildDayEntries({
      sales: [sale({ createdAt: '2026-09-24T10:00:00.000Z' })],
      movements: [],
      counts: [],
      collections,
    });

    expect(entries.map((entry) => entry.kind)).toEqual(['collection', 'sale', 'collection']);
    const first = entries[0];
    expect(first?.kind === 'collection' ? first.payment.id : undefined).toBe('cp1');
  });
});
