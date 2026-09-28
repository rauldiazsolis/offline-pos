import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Sale } from '../domain/sale.ts';
import { localDateKey, shiftDateKey } from '../domain/ticket-number.ts';
import { getDaySummary } from './cash-summary-repository.ts';
import { db } from './db.ts';

const at = (d: number, h: number): string => new Date(2026, 8, d, h, 0).toISOString();
const now = at(24, 15);
const today = localDateKey(now);
const yesterday = shiftDateKey(today, -1);

function sale(id: string, createdAt: string, extra: Partial<Sale> = {}): Sale {
  return {
    id,
    lines: [],
    payments: [{ method: 'cash', amount: 100 }],
    total: 100,
    status: 'closed',
    createdAt,
    ...extra,
  };
}

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('getDaySummary (#100)', () => {
  it('trae solo lo del día pedido, en orden, con el saldo si es hoy', async () => {
    await db.sales.bulkAdd([sale('ayer', at(23, 10)), sale('hoy', at(24, 11))]);
    await db.cashMovements.add({
      id: 'm1',
      direction: 'in',
      amount: 50,
      concept: 'Cambio',
      source: 'manual',
      createdAt: at(24, 9),
    });
    await db.cashCounts.add({ id: 'c1', expected: 0, counted: 0, createdAt: at(24, 8) });

    const view = await getDaySummary(today, now);

    expect(view.isToday).toBe(true);
    expect(view.sales.map((s) => s.id)).toEqual(['hoy']);
    expect(view.entries.map((entry) => entry.kind)).toEqual(['count', 'movement', 'sale']);
    expect(view.balance).toEqual({ balance: 150, lastCountAt: at(24, 8) });
    expect(view.oldestDate).toBe(yesterday);
    expect(view.summary.cash.income).toBe(50);
  });

  it('un día pasado no trae el saldo', async () => {
    await db.sales.add(sale('ayer', at(23, 10)));
    const view = await getDaySummary(yesterday, now);
    expect(view.isToday).toBe(false);
    expect(view.balance).toBeUndefined();
    expect(view.sales).toHaveLength(1);
  });

  it('una venta cuenta para el día de su número aunque su hora sea del día siguiente', async () => {
    await db.sales.add(sale('s1', at(24, 0), { ticket: { date: yesterday, number: 9 } }));

    expect((await getDaySummary(yesterday, now)).sales.map((s) => s.id)).toEqual(['s1']);
    expect((await getDaySummary(today, now)).sales).toEqual([]);
  });

  it('sin ningún dato, el día más viejo es hoy', async () => {
    const view = await getDaySummary(today, now);
    expect(view.oldestDate).toBe(today);
    expect(view.entries).toEqual([]);
  });
});
