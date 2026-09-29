import { describe, expect, it } from 'vitest';
import {
  buildCustomerPayment,
  buildVoidCustomerPayment,
  type CustomerPayment,
  isVoidedPayment,
  resolveCollection,
} from './customer-payment.ts';

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

describe('buildVoidCustomerPayment (#125)', () => {
  const original: CustomerPayment = {
    id: 'cp1',
    customerId: 'c1',
    payments: [
      { method: 'cash', amount: 200 },
      { method: 'transfer', amount: 300 },
    ],
    total: 500,
    createdAt: '2026-09-28T09:00:00.000Z',
    receipt: { date: '2026-09-28', number: 1 },
  };
  const params = { id: 'cp2', now: '2026-09-28T10:00:00.000Z', isAlreadyVoided: false };

  it('invierte pagos y total, apunta a la original y no trae recibo', () => {
    expect(buildVoidCustomerPayment(original, params)).toEqual({
      ok: true,
      value: {
        id: 'cp2',
        customerId: 'c1',
        payments: [
          { method: 'cash', amount: -200 },
          { method: 'transfer', amount: -300 },
        ],
        total: -500,
        createdAt: params.now,
        voidsPaymentId: 'cp1',
      },
    });
  });

  it('no anula una anulación', () => {
    expect(buildVoidCustomerPayment({ ...original, voidsPaymentId: 'cp0' }, params)).toMatchObject({
      ok: false,
      error: 'customer-payment/cannot-void-a-void',
    });
  });

  it('no anula dos veces', () => {
    expect(buildVoidCustomerPayment(original, { ...params, isAlreadyVoided: true })).toMatchObject({
      ok: false,
      error: 'customer-payment/already-voided',
    });
  });

  it('fuera de las 24 h móviles no se anula', () => {
    expect(
      buildVoidCustomerPayment(original, { ...params, now: '2026-09-29T09:00:00.000Z' }),
    ).toEqual({
      ok: false,
      error: 'customer-payment/void-window-expired',
      meta: { createdAt: original.createdAt },
    });
  });
});

describe('isVoidedPayment', () => {
  it('anulada si hay una cobranza que la anula', () => {
    expect(isVoidedPayment({ id: 'cp1' }, new Set(['cp1']))).toBe(true);
    expect(isVoidedPayment({ id: 'cp2' }, new Set(['cp1']))).toBe(false);
  });
});
