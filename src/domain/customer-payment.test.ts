import { describe, expect, it } from 'vitest';
import { buildCustomerPayment, resolveCollection } from './customer-payment.ts';

const base = { id: 'cp1', customerId: 'c1', now: '2026-09-23T10:00:00.000Z' };

describe('buildCustomerPayment', () => {
  it('suma el total de los pagos', () => {
    const result = buildCustomerPayment({
      ...base,
      payments: [
        { method: 'cash', amount: 500 },
        { method: 'transfer', amount: 250.25 },
      ],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'cp1',
        customerId: 'c1',
        payments: [
          { method: 'cash', amount: 500 },
          { method: 'transfer', amount: 250.25 },
        ],
        total: 750.25,
        createdAt: base.now,
      },
    });
  });
  it('rechaza cuenta corriente, montos no positivos y lista vacía', () => {
    expect(
      buildCustomerPayment({ ...base, payments: [{ method: 'account', amount: 10 }] }),
    ).toMatchObject({
      ok: false,
      error: 'customer-payment/invalid',
      meta: { reason: 'account-method' },
    });
    expect(
      buildCustomerPayment({ ...base, payments: [{ method: 'cash', amount: 0 }] }),
    ).toMatchObject({
      ok: false,
      meta: { reason: 'non-positive-amount' },
    });
    expect(buildCustomerPayment({ ...base, payments: [] })).toMatchObject({
      ok: false,
      meta: { reason: 'empty' },
    });
  });
});

describe('resolveCollection', () => {
  const zero = { cash: 0, debit: 0, credit: 0, transfer: 0, qr: 0 };

  it('arma los pagos positivos en el orden de los medios', () => {
    expect(resolveCollection({ ...zero, transfer: 250.255, cash: 500 })).toEqual({
      ok: true,
      value: [
        { method: 'cash', amount: 500 },
        { method: 'transfer', amount: 250.26 },
      ],
    });
  });

  it('sin ningún monto es un error', () => {
    expect(resolveCollection(zero)).toEqual({
      ok: false,
      error: 'customer-payment/invalid',
      meta: { reason: 'empty' },
    });
  });

  it('no tiene tope ni vuelto: lo tipeado es lo acreditado', () => {
    const result = resolveCollection({ ...zero, cash: 1_000_000 });
    expect(result.ok && result.value).toEqual([{ method: 'cash', amount: 1_000_000 }]);
  });
});
