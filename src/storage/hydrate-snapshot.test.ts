import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CashMovement } from '../domain/cash-movement.ts';
import type { CustomerPayment } from '../domain/customer-payment.ts';
import type { Sale } from '../domain/sale.ts';
import type { CashSnapshot } from '../sync/snapshot-schema.ts';
import { getCashBalance } from './cash-repository.ts';
import { db } from './db.ts';
import { hydrateSnapshot } from './hydrate-snapshot.ts';
import { runLocalCleanup } from './local-cleanup.ts';
import { voidSaleAndPersist } from './sale-repository.ts';
import { listVoidCandidates } from './void-repository.ts';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
});

const at = (iso: string) => new Date(iso).toISOString();

function sale(id: string, createdAt: string, cash: number, extra: Partial<Sale> = {}): Sale {
  return {
    id,
    lines: [{ kind: 'freeform', description: 'Algo', qty: 1, unitPrice: cash }],
    payments: [{ method: 'cash', amount: cash }],
    total: cash,
    status: 'closed',
    createdAt,
    ...extra,
  };
}

function collection(id: string, createdAt: string, cash: number): CustomerPayment {
  return {
    id,
    customerId: 'c1',
    payments: [{ method: 'cash', amount: cash }],
    total: cash,
    createdAt,
  };
}

function movement(
  id: string,
  createdAt: string,
  direction: 'in' | 'out',
  amount: number,
  source: CashMovement['source'] = 'manual',
): CashMovement {
  return { id, direction, amount, concept: 'Cambio', source, createdAt };
}

const emptySnapshot: CashSnapshot = {
  recentSales: [],
  recentCustomerPayments: [],
  cashMovements: [],
};

describe('hydrateSnapshot (4.7.0, #230)', () => {
  it('guarda ventas, cobranzas y movimientos sin crear eventos en el outbox', async () => {
    const result = await hydrateSnapshot({
      ...emptySnapshot,
      recentSales: [sale('s1', '2026-11-19T10:00:00.000Z', 100)],
      recentCustomerPayments: [collection('p1', '2026-11-19T10:05:00.000Z', 50)],
      cashMovements: [movement('m1', '2026-11-19T10:10:00.000Z', 'in', 20)],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'hydrated',
        sales: 1,
        customerPayments: 1,
        cashMovements: 1,
        cashCount: false,
      },
    });
    expect(await db.sales.get('s1')).toMatchObject({ id: 's1', total: 100 });
    expect(await db.customerPayments.get('p1')).toMatchObject({ id: 'p1', total: 50 });
    expect(await db.cashMovements.get('m1')).toMatchObject({ id: 'm1', amount: 20 });
    expect(await db.outbox.count()).toBe(0);
    expect(await db.stockMovements.count()).toBe(0);
    expect(await db.accountMovements.count()).toBe(0);
    expect(await db.customerBalances.count()).toBe(0);
  });

  it('con cashAnchor crea el arqueo local, sin ajuste ni evento', async () => {
    await hydrateSnapshot({
      ...emptySnapshot,
      cashAnchor: { countedAt: '2026-11-19T07:00:00-03:00', amount: 1500 },
    });

    const counts = await db.cashCounts.toArray();
    expect(counts.map(({ id: _id, ...count }) => count)).toEqual([
      { expected: 1500, counted: 1500, createdAt: '2026-11-19T10:00:00.000Z' },
    ]);
    expect(counts[0]?.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(await db.outbox.count()).toBe(0);
  });

  it('el saldo de efectivo da lo mismo que en el equipo anterior', async () => {
    // El equipo anterior: arqueó 1000 (con un ajuste de +50) a las 10:00 y después vendió,
    // cobró y movió caja. Una venta de antes del arqueo no suma; el ajuste tampoco.
    const anchorAt = '2026-11-19T10:00:00.000Z';
    await hydrateSnapshot({
      cashAnchor: { countedAt: '2026-11-19T07:00:00-03:00', amount: 1000 },
      recentSales: [
        sale('antes', '2026-11-19T09:30:00.000Z', 400),
        sale('s1', '2026-11-19T11:00:00.000Z', 300),
        sale('s2', '2026-11-19T11:30:00-03:00', 0, {
          payments: [
            { method: 'cash', amount: 80 },
            { method: 'debit', amount: 120 },
          ],
          total: 200,
        }),
        sale('anulacion', '2026-11-19T12:00:00.000Z', -300, { voidsSaleId: 's1' }),
      ],
      recentCustomerPayments: [collection('p1', '2026-11-19T12:30:00.000Z', 250)],
      cashMovements: [
        movement('ajuste', anchorAt, 'in', 50, 'count-adjustment'),
        movement('ingreso', '2026-11-19T13:00:00.000Z', 'in', 100),
        movement('egreso', '2026-11-19T13:30:00.000Z', 'out', 70),
      ],
    });

    // 1000 + 300 + 80 - 300 + 250 + 100 - 70
    expect(await getCashBalance()).toEqual({ balance: 1360, lastCountAt: anchorAt });
  });

  it('sin ancla, la base es 0 y suma todo', async () => {
    await hydrateSnapshot({
      ...emptySnapshot,
      recentSales: [sale('s1', '2026-11-19T11:00:00.000Z', 300)],
      cashMovements: [movement('egreso', '2026-11-19T13:30:00.000Z', 'out', 70)],
    });

    expect(await getCashBalance()).toEqual({ balance: 230 });
  });

  it('con documentos locales no hidrata nada', async () => {
    await db.cashMovements.add(movement('local', '2026-11-19T09:00:00.000Z', 'in', 5));

    const result = await hydrateSnapshot({
      ...emptySnapshot,
      recentSales: [sale('s1', '2026-11-19T10:00:00.000Z', 100)],
      cashAnchor: { countedAt: '2026-11-19T10:00:00.000Z', amount: 1 },
    });

    expect(result).toEqual({ ok: true, value: { kind: 'skipped', reason: 'local-documents' } });
    expect(await db.sales.count()).toBe(0);
    expect(await db.cashCounts.count()).toBe(0);
  });

  it('un id repetido en la foto no pisa nada: queda el primero', async () => {
    await hydrateSnapshot({
      ...emptySnapshot,
      recentSales: [
        sale('s1', '2026-11-19T10:00:00.000Z', 100),
        sale('s1', '2026-11-19T11:00:00.000Z', 999),
      ],
    });

    expect(await db.sales.get('s1')).toMatchObject({ total: 100 });
  });

  it('lo hidratado aparece en /ANULAR y se puede anular (con su evento, la anulación)', async () => {
    const now = new Date().toISOString();
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await hydrateSnapshot({
      ...emptySnapshot,
      recentSales: [sale('s1', recent, 100, { ticket: { date: '2026-11-19', number: 4 } })],
    });

    const candidates = await listVoidCandidates(now);
    expect(candidates).toMatchObject([{ kind: 'sale', state: 'voidable', sale: { id: 's1' } }]);

    const voided = await voidSaleAndPersist('s1');
    expect(voided.ok).toBe(true);
    const events = await db.outbox.toArray();
    expect(events.map((event) => event.type)).toContain('sale');
    expect(events.some((event) => event.type === 'sale' && event.sale.id === 's1')).toBe(false);
  });

  it('se limpia a los 7 días como cualquier sincronizada (sin evento en el outbox)', async () => {
    await hydrateSnapshot({
      cashAnchor: { countedAt: '2026-11-10T10:00:00.000Z', amount: 0 },
      recentSales: [sale('vieja', '2026-11-01T10:00:00.000Z', 100)],
      recentCustomerPayments: [collection('p-vieja', '2026-11-01T10:00:00.000Z', 10)],
      cashMovements: [movement('m-viejo', '2026-11-01T10:00:00.000Z', 'in', 5)],
    });

    const report = await runLocalCleanup({
      now: at('2026-11-19T10:00:00.000Z'),
      protectedEventIds: new Set(),
    });

    expect(report.ok).toBe(true);
    expect(await db.sales.count()).toBe(0);
    expect(await db.customerPayments.count()).toBe(0);
    expect(await db.cashMovements.count()).toBe(0);
    // El ancla (el último arqueo) se conserva.
    expect(await db.cashCounts.count()).toBe(1);
  });
});
