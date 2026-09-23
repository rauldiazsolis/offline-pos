import { describe, expect, it } from 'vitest';
import { buildCustomerPayment } from './customer-payment.ts';

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
