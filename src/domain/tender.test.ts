import { describe, expect, it } from 'vitest';
import { resolveTender, type TenderedAmounts } from './tender.ts';

function tender(overrides: Partial<TenderedAmounts> = {}): TenderedAmounts {
  return { cash: 0, debit: 0, credit: 0, transfer: 0, qr: 0, account: 0, ...overrides };
}

describe('resolveTender', () => {
  it('efectivo exacto: un pago, sin vuelto', () => {
    const result = resolveTender(tender({ cash: 1200 }), 1200);

    expect(result).toEqual({
      ok: true,
      value: { payments: [{ method: 'cash', amount: 1200 }], change: 0 },
    });
  });

  it('efectivo de más: descuenta el vuelto del pago guardado (resuelve el bug del arqueo)', () => {
    const result = resolveTender(tender({ cash: 2000 }), 1200);

    expect(result).toEqual({
      ok: true,
      value: { payments: [{ method: 'cash', amount: 1200 }], change: 800 },
    });
  });

  it('combina varios medios sin exceder', () => {
    const result = resolveTender(tender({ debit: 500, cash: 700 }), 1200);

    expect(result).toEqual({
      ok: true,
      value: {
        payments: [
          { method: 'debit', amount: 500 },
          { method: 'cash', amount: 700 },
        ],
        change: 0,
      },
    });
  });

  it('un medio no-efectivo que supera el total es un error de validación', () => {
    const result = resolveTender(tender({ debit: 1500 }), 1200);

    expect(result).toEqual({
      ok: false,
      error: 'sale/non-cash-exceeds-total',
      meta: { nonCashTotal: 1500, total: 1200 },
    });
  });

  it('varios medios no-efectivo que combinados superan el total, aunque ninguno solo', () => {
    const result = resolveTender(tender({ debit: 700, credit: 700 }), 1200);

    expect(result).toEqual({
      ok: false,
      error: 'sale/non-cash-exceeds-total',
      meta: { nonCashTotal: 1400, total: 1200 },
    });
  });

  it('no cubre el total: error de pago insuficiente', () => {
    const result = resolveTender(tender({ cash: 500, debit: 300 }), 1200);

    expect(result).toEqual({
      ok: false,
      error: 'sale/insufficient-payment',
      meta: { total: 1200, paid: 800 },
    });
  });

  it('cuenta corriente se trata como cualquier medio no-efectivo', () => {
    const result = resolveTender(tender({ account: 1200 }), 1200);

    expect(result).toEqual({
      ok: true,
      value: { payments: [{ method: 'account', amount: 1200 }], change: 0 },
    });
  });
});
