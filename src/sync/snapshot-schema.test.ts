import { describe, expect, it } from 'vitest';
import { cashSnapshotSchema, toCashSnapshot } from './snapshot-schema.ts';

const origin = { branch: 'Centro', pointOfSale: 'Caja 1' };

const sale = {
  id: '01SALE',
  lines: [
    { kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 },
    {
      kind: 'freeform',
      description: 'Bolsa',
      qty: 1,
      unitPrice: 10,
      discount: { type: 'amount', value: 1 },
    },
  ],
  payments: [{ method: 'cash', amount: 209 }],
  total: 209,
  status: 'closed',
  createdAt: '2026-11-19T12:00:00.000Z',
  ticket: { date: '2026-11-19', number: 7 },
  origin,
};

const customerPayment = {
  id: '01PAY',
  customerId: 'c1',
  payments: [{ method: 'transfer', amount: 500 }],
  total: 500,
  createdAt: '2026-11-19T13:00:00.000Z',
  receipt: { date: '2026-11-19', number: 2 },
  origin,
};

const cashMovement = {
  id: '01CASH',
  direction: 'out',
  amount: 50,
  concept: 'Proveedor',
  source: 'manual',
  createdAt: '2026-11-19T14:00:00.000Z',
  origin,
};

const full = {
  generatedAt: '2026-11-19T15:00:00.000Z',
  lastTicket: { date: '2026-11-19', number: 7 },
  lastReceipt: { date: '2026-11-19', number: 2 },
  recentSales: [sale],
  recentCustomerPayments: [customerPayment],
  cashAnchor: { countedAt: '2026-11-19T08:00:00.000Z', amount: 1000 },
  cashMovements: [cashMovement],
};

describe('GET /snapshot (4.7.0, #230)', () => {
  it('pasa una foto completa a tipos del dominio, sin el origin', () => {
    const snapshot = toCashSnapshot(cashSnapshotSchema.parse(full));
    expect(snapshot.lastTicket).toEqual({ date: '2026-11-19', number: 7 });
    expect(snapshot.lastReceipt).toEqual({ date: '2026-11-19', number: 2 });
    expect(snapshot.cashAnchor).toEqual({ countedAt: '2026-11-19T08:00:00.000Z', amount: 1000 });
    expect(snapshot.recentSales).toEqual([
      {
        id: '01SALE',
        lines: [
          { kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 },
          {
            kind: 'freeform',
            description: 'Bolsa',
            qty: 1,
            unitPrice: 10,
            discount: { type: 'amount', value: 1 },
          },
        ],
        payments: [{ method: 'cash', amount: 209 }],
        total: 209,
        status: 'closed',
        createdAt: '2026-11-19T12:00:00.000Z',
        ticket: { date: '2026-11-19', number: 7 },
      },
    ]);
    expect(snapshot.recentCustomerPayments[0]).not.toHaveProperty('origin');
    expect(snapshot.cashMovements).toEqual([
      {
        id: '01CASH',
        direction: 'out',
        amount: 50,
        concept: 'Proveedor',
        source: 'manual',
        createdAt: '2026-11-19T14:00:00.000Z',
      },
    ]);
  });

  it('una foto vacía, sin ancla ni números, es válida', () => {
    const snapshot = toCashSnapshot(
      cashSnapshotSchema.parse({ recentSales: [], recentCustomerPayments: [], cashMovements: [] }),
    );
    expect(snapshot).toEqual({ recentSales: [], recentCustomerPayments: [], cashMovements: [] });
  });

  it('un elemento mal formado se descarta sin tirar la foto', () => {
    const snapshot = toCashSnapshot(
      cashSnapshotSchema.parse({
        ...full,
        recentSales: [
          sale,
          { ...sale, id: '02', payments: [{ method: 'crypto', amount: 1 }] },
          'x',
        ],
        recentCustomerPayments: [{ ...customerPayment, total: 'mucho' }],
        cashMovements: [cashMovement, { ...cashMovement, amount: 0 }],
      }),
    );
    expect(snapshot.recentSales.map((s) => s.id)).toEqual(['01SALE']);
    expect(snapshot.recentCustomerPayments).toEqual([]);
    expect(snapshot.cashMovements).toHaveLength(1);
  });

  it('números y ancla mal formados cuentan como ausentes', () => {
    const snapshot = toCashSnapshot(
      cashSnapshotSchema.parse({
        ...full,
        lastTicket: { date: '19/11/2026', number: 7 },
        lastReceipt: { date: '2026-11-19', number: 0 },
        cashAnchor: { amount: 10 },
      }),
    );
    expect('lastTicket' in snapshot).toBe(false);
    expect('lastReceipt' in snapshot).toBe(false);
    expect('cashAnchor' in snapshot).toBe(false);
  });

  it('no es estricto: ignora campos desconocidos en todos los niveles', () => {
    const parsed = cashSnapshotSchema.safeParse({
      ...full,
      shiftOpenedAt: '2026-11-19T08:00:00.000Z',
      recentSales: [{ ...sale, extra: true, lines: [{ ...sale.lines[0], extra: 1 }] }],
    });
    expect(parsed.success).toBe(true);
  });

  it('sin las listas obligatorias, la foto es inválida', () => {
    expect(cashSnapshotSchema.safeParse({ lastTicket: full.lastTicket }).success).toBe(false);
  });
});
