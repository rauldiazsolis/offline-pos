import { describe, expect, it } from 'vitest';
import {
  availableCredit,
  buildAccountMovementForSale,
  buildCustomer,
  canChargeOffline,
  type CustomerAccount,
} from './customer.ts';

describe('buildCustomer', () => {
  it('arma un cliente nuevo con el id y el nombre dados', () => {
    const customer = buildCustomer('Juan Pérez', { id: 'c1', now: '2026-01-01T00:00:00.000Z' });

    expect(customer).toEqual({
      id: 'c1',
      name: 'Juan Pérez',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

const account: CustomerAccount = {
  customerId: 'c1',
  creditLimit: 1000,
  margin: 200,
  balance: 300,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('availableCredit', () => {
  it('es creditLimit + margin - balance', () => {
    expect(availableCredit(account)).toBe(900);
  });
});

describe('canChargeOffline', () => {
  it('true si el monto entra en el crédito disponible', () => {
    expect(canChargeOffline(account, 900)).toBe(true);
  });

  it('false si el monto supera el crédito disponible', () => {
    expect(canChargeOffline(account, 901)).toBe(false);
  });
});

describe('buildAccountMovementForSale', () => {
  it('arma un movimiento tipo sale con holdId si se pasó', () => {
    const movement = buildAccountMovementForSale({
      id: 'am1',
      customerId: 'c1',
      amount: 500,
      saleId: 'sale-1',
      holdId: 'hold-1',
      now: '2026-01-01T00:00:00.000Z',
    });

    expect(movement).toEqual({
      id: 'am1',
      customerId: 'c1',
      type: 'sale',
      amount: 500,
      saleId: 'sale-1',
      holdId: 'hold-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('omite holdId si no se pasa (nunca undefined explícito)', () => {
    const movement = buildAccountMovementForSale({
      id: 'am1',
      customerId: 'c1',
      amount: 500,
      saleId: 'sale-1',
      now: '2026-01-01T00:00:00.000Z',
    });

    expect('holdId' in movement).toBe(false);
  });
});
