import { describe, expect, it } from 'vitest';
import { hasAtMostThreeDecimals, roundAmount, roundQuantity } from './rounding.ts';

describe('rounding', () => {
  it('roundQuantity a 3 decimales, sin arrastre de coma flotante', () => {
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
    expect(roundQuantity(-1.0005)).toBe(-1);
    expect(roundQuantity(5.9510000000000005)).toBe(5.951);
  });
  it('roundAmount a 2 decimales', () => {
    expect(roundAmount(10.005)).toBe(10.01);
    expect(roundAmount(-3.333)).toBe(-3.33);
  });
  it('hasAtMostThreeDecimals', () => {
    expect(hasAtMostThreeDecimals(1.25)).toBe(true);
    expect(hasAtMostThreeDecimals(-0.125)).toBe(true);
    expect(hasAtMostThreeDecimals(1.2345)).toBe(false);
    expect(hasAtMostThreeDecimals(Number.NaN)).toBe(false);
  });
});
