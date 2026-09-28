import { describe, expect, it } from 'vitest';
import { applyBalanceDelta, describeBalance } from './customer-balance.ts';

describe('customer-balance', () => {
  it('describeBalance: positivo debe, negativo a favor, 0 o desconocido sin saldo', () => {
    expect(describeBalance(1500)).toEqual({ kind: 'owes', amount: 1500 });
    expect(describeBalance(-200.5)).toEqual({ kind: 'in-favor', amount: 200.5 });
    expect(describeBalance(0)).toEqual({ kind: 'none' });
    expect(describeBalance(undefined)).toEqual({ kind: 'none' });
  });

  it('applyBalanceDelta parte de 0 sin saldo y redondea', () => {
    expect(applyBalanceDelta(undefined, -500)).toBe(-500);
    expect(applyBalanceDelta(100.1, 0.2)).toBe(100.3);
  });
});
