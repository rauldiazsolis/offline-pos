import { describe, expect, it } from 'vitest';
import { buildCountAdjustment, COUNT_ADJUSTMENT_CONCEPT } from './cash-movement.ts';

const now = '2026-09-23T10:00:00.000Z';

describe('buildCountAdjustment', () => {
  it('sin diferencia no genera movimiento', () => {
    expect(buildCountAdjustment({ id: 'm1', expected: 1000, counted: 1000, now })).toBeUndefined();
  });
  it('sobrante: ingreso por la diferencia, con lo esperado y lo contado', () => {
    expect(buildCountAdjustment({ id: 'm1', expected: 1000, counted: 1250.5, now })).toEqual({
      id: 'm1',
      direction: 'in',
      amount: 250.5,
      concept: COUNT_ADJUSTMENT_CONCEPT,
      source: 'count-adjustment',
      count: { expected: 1000, counted: 1250.5 },
      createdAt: now,
    });
  });
  it('faltante: egreso por el valor absoluto, redondeado a 2 decimales', () => {
    const movement = buildCountAdjustment({ id: 'm1', expected: 100.1, counted: 100, now });
    expect(movement?.direction).toBe('out');
    expect(movement?.amount).toBe(0.1);
  });
});
