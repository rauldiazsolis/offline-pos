import { describe, expect, it } from 'vitest';
import { buildCashCount, calculateCashBalance, isCashCountOverdue } from './cash-count.ts';

const sale = (createdAt: string, ...cash: number[]) => ({
  createdAt,
  payments: [
    ...cash.map((amount) => ({ method: 'cash' as const, amount })),
    { method: 'debit' as const, amount: 1000 },
  ],
});
const manual = (createdAt: string, direction: 'in' | 'out', amount: number) => ({
  createdAt,
  direction,
  amount,
  source: 'manual' as const,
});

describe('calculateCashBalance', () => {
  it('sin arqueo, todo cuenta desde base 0 (solo efectivo)', () => {
    expect(
      calculateCashBalance({
        lastCount: undefined,
        sales: [sale('2026-09-24T10:00:00.000Z', 500)],
        movements: [manual('2026-09-24T09:00:00.000Z', 'in', 1000)],
        collections: [],
      }),
    ).toBe(1500);
  });

  it('con arqueo, parte de lo contado y suma solo lo posterior', () => {
    expect(
      calculateCashBalance({
        lastCount: { counted: 2000, createdAt: '2026-09-24T12:00:00.000Z' },
        sales: [sale('2026-09-24T11:00:00.000Z', 700), sale('2026-09-24T13:00:00.000Z', 300)],
        movements: [
          manual('2026-09-24T11:30:00.000Z', 'in', 50),
          manual('2026-09-24T14:00:00.000Z', 'out', 200),
        ],
        collections: [],
      }),
    ).toBe(2100);
  });

  it('lo creado en el mismo instante del arqueo no cuenta (posterior es estricto)', () => {
    expect(
      calculateCashBalance({
        lastCount: { counted: 100, createdAt: '2026-09-24T12:00:00.000Z' },
        sales: [sale('2026-09-24T12:00:00.000Z', 999)],
        movements: [],
        collections: [],
      }),
    ).toBe(100);
  });

  it('anulaciones y devoluciones restan por su signo', () => {
    expect(
      calculateCashBalance({
        lastCount: undefined,
        sales: [sale('2026-09-24T10:00:00.000Z', 500), sale('2026-09-24T10:05:00.000Z', -500)],
        movements: [],
        collections: [],
      }),
    ).toBe(0);
  });

  it('los ajustes por arqueo nunca suman', () => {
    expect(
      calculateCashBalance({
        lastCount: { counted: 300, createdAt: '2026-09-24T12:00:00.000Z' },
        sales: [],
        movements: [
          {
            createdAt: '2026-09-24T12:00:01.000Z',
            direction: 'in',
            amount: 80,
            source: 'count-adjustment',
          },
        ],
        collections: [],
      }),
    ).toBe(300);
  });
});

describe('calculateCashBalance con cobranzas (#101)', () => {
  it('suma el efectivo de las cobranzas posteriores al arqueo', () => {
    expect(
      calculateCashBalance({
        lastCount: { counted: 1000, createdAt: '2026-09-27T10:00:00.000Z' },
        sales: [],
        movements: [],
        collections: [
          { createdAt: '2026-09-27T09:00:00.000Z', payments: [{ method: 'cash', amount: 999 }] },
          { createdAt: '2026-09-27T10:00:00.000Z', payments: [{ method: 'cash', amount: 1 }] },
          {
            createdAt: '2026-09-27T11:00:00.000Z',
            payments: [
              { method: 'cash', amount: 300 },
              { method: 'transfer', amount: 200 },
            ],
          },
        ],
      }),
    ).toBe(1300);
  });
});

describe('buildCashCount', () => {
  const base = { id: 'c1', adjustmentId: 'm1', now: '2026-09-24T12:00:00.000Z' };

  it('con diferencia arma el ajuste y lo referencia', () => {
    expect(buildCashCount({ ...base, expected: 1000, counted: 1200 })).toEqual({
      ok: true,
      value: {
        count: { id: 'c1', expected: 1000, counted: 1200, createdAt: base.now, adjustmentId: 'm1' },
        adjustment: {
          id: 'm1',
          direction: 'in',
          amount: 200,
          concept: 'Ajuste por arqueo',
          source: 'count-adjustment',
          count: { expected: 1000, counted: 1200 },
          createdAt: base.now,
        },
      },
    });
  });

  it('sin diferencia no hay ajuste', () => {
    expect(buildCashCount({ ...base, expected: 1000, counted: 1000 })).toEqual({
      ok: true,
      value: { count: { id: 'c1', expected: 1000, counted: 1000, createdAt: base.now } },
    });
  });

  it('contado negativo o no finito es cash/invalid-amount', () => {
    expect(buildCashCount({ ...base, expected: 0, counted: -1 })).toMatchObject({
      ok: false,
      error: 'cash/invalid-amount',
    });
    expect(buildCashCount({ ...base, expected: 0, counted: Number.NaN })).toMatchObject({
      ok: false,
      error: 'cash/invalid-amount',
    });
  });
});

describe('isCashCountOverdue', () => {
  it('sin arqueo, o con uno de más de 24 h', () => {
    expect(isCashCountOverdue(undefined, '2026-09-24T12:00:00.000Z')).toBe(true);
    expect(isCashCountOverdue('2026-09-23T11:59:00.000Z', '2026-09-24T12:00:00.000Z')).toBe(true);
    expect(isCashCountOverdue('2026-09-23T12:01:00.000Z', '2026-09-24T12:00:00.000Z')).toBe(false);
  });
});
