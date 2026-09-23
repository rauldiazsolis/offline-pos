import { describe, expect, it } from 'vitest';
import {
  availableCredit,
  buildAccountMovementForSale,
  buildCustomer,
  canChargeOffline,
  splitConnectorCustomer,
  splitConnectorCustomers,
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

  it('incluye documento/teléfono cuando se pasan (Ciclo 7, sembrado de clientes de ejemplo)', () => {
    const customer = buildCustomer('Juan Pérez', {
      id: 'c1',
      now: '2026-01-01T00:00:00.000Z',
      document: '12345678',
      phone: '555-1234',
    });

    expect(customer).toEqual({
      id: 'c1',
      name: 'Juan Pérez',
      document: '12345678',
      phone: '555-1234',
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

  it('true si la cuenta es unrestricted, sin evaluar el crédito disponible (Etapa 3, #69)', () => {
    const unrestrictedAccount: CustomerAccount = {
      customerId: 'c1',
      creditLimit: 0,
      margin: 0,
      balance: 500,
      updatedAt: '2026-01-01T00:00:00.000Z',
      unrestricted: true,
    };

    expect(canChargeOffline(unrestrictedAccount, 999999)).toBe(true);
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

describe('splitConnectorCustomer', () => {
  it('sin datos de cuenta, devuelve solo el customer', () => {
    const { customer, account } = splitConnectorCustomer(
      { id: 'c1', name: 'Juan Pérez', createdAt: '2025-06-01T00:00:00.000Z' },
      { now: '2026-01-01T00:00:00.000Z' },
    );

    expect(customer).toEqual({
      id: 'c1',
      name: 'Juan Pérez',
      createdAt: '2025-06-01T00:00:00.000Z',
    });
    expect(account).toBeUndefined();
  });

  it('con los tres campos de cuenta, separa customer y account', () => {
    const { customer, account } = splitConnectorCustomer(
      {
        id: 'c1',
        name: 'Juan Pérez',
        createdAt: '2025-06-01T00:00:00.000Z',
        creditLimit: 1000,
        margin: 100,
        balance: 200,
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      { now: '2026-01-01T00:00:00.000Z' },
    );

    expect(customer.id).toBe('c1');
    expect(account).toEqual({
      customerId: 'c1',
      creditLimit: 1000,
      margin: 100,
      balance: 200,
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('con datos de cuenta parciales, no arma un account (todo o nada)', () => {
    const { account } = splitConnectorCustomer(
      { id: 'c1', name: 'Juan Pérez', createdAt: '2025-06-01T00:00:00.000Z', creditLimit: 1000 },
      { now: '2026-01-01T00:00:00.000Z' },
    );

    expect(account).toBeUndefined();
  });

  it('con unrestricted true, arma un account aunque falten los tres campos de crédito (Etapa 3, #69)', () => {
    const { account } = splitConnectorCustomer(
      { id: 'c1', name: 'Juan Pérez', createdAt: '2025-06-01T00:00:00.000Z', unrestricted: true },
      { now: '2026-01-01T00:00:00.000Z' },
    );

    expect(account).toEqual({
      customerId: 'c1',
      creditLimit: 0,
      margin: 0,
      balance: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
      unrestricted: true,
    });
  });

  it('con unrestricted false y datos parciales, no arma un account (false no es lo mismo que true)', () => {
    const { account } = splitConnectorCustomer(
      {
        id: 'c1',
        name: 'Juan Pérez',
        createdAt: '2025-06-01T00:00:00.000Z',
        unrestricted: false,
        creditLimit: 1000,
      },
      { now: '2026-01-01T00:00:00.000Z' },
    );

    expect(account).toBeUndefined();
  });
});

describe('splitConnectorCustomer (contrato v3)', () => {
  it('usa la fecha de alta real del backend y conserva el bloqueo', () => {
    const { customer } = splitConnectorCustomer(
      {
        id: 'c1',
        name: 'Ana',
        createdAt: '2025-03-01T12:00:00.000Z',
        blocked: { reason: 'Deuda vencida' },
      },
      { now: '2026-09-23T10:00:00.000Z' },
    );
    expect(customer).toEqual({
      id: 'c1',
      name: 'Ana',
      createdAt: '2025-03-01T12:00:00.000Z',
      blocked: { reason: 'Deuda vencida' },
    });
  });
});

describe('splitConnectorCustomers', () => {
  it('separa cada fila en Customer y, si trae los tres campos de crédito, CustomerAccount', () => {
    const { customers, accounts } = splitConnectorCustomers(
      [
        { id: 'c1', name: 'Ana', createdAt: '2025-06-01T00:00:00.000Z' },
        {
          id: 'c2',
          name: 'Beto',
          createdAt: '2025-06-02T00:00:00.000Z',
          creditLimit: 100,
          margin: 10,
          balance: 5,
        },
      ],
      { now: '2026-01-01T00:00:00.000Z' },
    );

    expect(customers.map((customer) => customer.id)).toEqual(['c1', 'c2']);
    expect(accounts.map((account) => account.customerId)).toEqual(['c2']);
  });
});
