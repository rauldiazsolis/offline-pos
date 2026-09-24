import { describe, expect, it } from 'vitest';
import type { ReapplyEffects } from '../domain/reapply.ts';
import type { ConnectorCustomer } from './connector.ts';
import { adjustPull } from './pull-adjust.ts';

const now = '2026-09-24T10:00:00.000Z';
const noEffects: ReapplyEffects = { stock: new Map(), balance: new Map() };

function customer(id: string, balance?: number): ConnectorCustomer {
  return {
    id,
    name: id,
    createdAt: now,
    ...(balance !== undefined ? { creditLimit: 1000, margin: 0, balance } : {}),
  };
}

describe('adjustPull — sin retener', () => {
  it('suma los efectos al stock del backend y crea la fila de un producto que no vino', () => {
    const result = adjustPull({
      customers: [],
      stock: [{ productId: 'p1', quantity: 10, updatedAt: now }],
      retain: false,
      effects: {
        stock: new Map([
          ['p1', -2],
          ['p2', -1],
        ]),
        balance: new Map(),
      },
      localStock: [],
      localBalances: new Map(),
      now,
    });
    expect(result.stock).toEqual([
      { productId: 'p1', quantity: 8, updatedAt: now },
      { productId: 'p2', quantity: -1, updatedAt: now },
    ]);
  });

  it('suma los efectos al saldo solo de los clientes que vinieron y con saldo', () => {
    const result = adjustPull({
      customers: [customer('c1', 100), customer('c2')],
      stock: [],
      retain: false,
      effects: {
        stock: new Map(),
        balance: new Map([
          ['c1', 50],
          ['c2', 10],
          ['c3', 5],
        ]),
      },
      localStock: [],
      localBalances: new Map(),
      now,
    });
    expect(result.customers.map((item) => item.balance)).toEqual([150, undefined]);
    expect(result.customers).toHaveLength(2);
  });

  it('sin efectos devuelve lo del backend tal cual', () => {
    const stock = [{ productId: 'p1', quantity: 3, updatedAt: now }];
    const customers = [customer('c1', 20)];
    expect(
      adjustPull({
        customers,
        stock,
        retain: false,
        effects: noEffects,
        localStock: [],
        localBalances: new Map(),
        now,
      }),
    ).toEqual({ customers, stock });
  });
});

describe('adjustPull — reteniendo', () => {
  it('usa el stock local entero e ignora el del backend y los efectos', () => {
    const localStock = [{ productId: 'p1', quantity: 7, updatedAt: '2026-09-23T00:00:00.000Z' }];
    const result = adjustPull({
      customers: [],
      stock: [{ productId: 'p1', quantity: 99, updatedAt: now }],
      retain: true,
      effects: { stock: new Map([['p1', -5]]), balance: new Map() },
      localStock,
      localBalances: new Map(),
      now,
    });
    expect(result.stock).toEqual(localStock);
  });

  it('conserva el saldo local de los clientes que tienen cuenta local; el resto queda como vino', () => {
    const result = adjustPull({
      customers: [customer('c1', 999), customer('c2', 30), customer('c3')],
      stock: [],
      retain: true,
      effects: noEffects,
      localStock: [],
      localBalances: new Map([['c1', 120]]),
      now,
    });
    expect(result.customers.map((item) => item.balance)).toEqual([120, 30, undefined]);
  });
});
