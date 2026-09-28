import { describe, expect, it } from 'vitest';
import {
  buildCountAdjustment,
  buildManualCashMovement,
  COUNT_ADJUSTMENT_CONCEPT,
} from './cash-movement.ts';

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

describe('buildManualCashMovement', () => {
  const base = { id: 'm1', direction: 'out' as const, now: '2026-09-24T12:00:00.000Z' };

  it('recorta concepto y descripción, redondea el monto', () => {
    expect(
      buildManualCashMovement({
        ...base,
        amount: 150.456,
        concept: '  Proveedor  ',
        description: '  Pan ',
      }),
    ).toEqual({
      ok: true,
      value: {
        id: 'm1',
        direction: 'out',
        amount: 150.46,
        concept: 'Proveedor',
        description: 'Pan',
        source: 'manual',
        createdAt: base.now,
      },
    });
  });

  it('una descripción vacía se omite', () => {
    const result = buildManualCashMovement({ ...base, amount: 10, concept: 'X', description: '   ' });
    expect(result.ok && 'description' in result.value).toBe(false);
  });

  it('monto 0, negativo o no finito es cash/invalid-amount', () => {
    for (const amount of [0, -5, Number.NaN, 0.001]) {
      expect(buildManualCashMovement({ ...base, amount, concept: 'X' })).toMatchObject({
        ok: false,
        error: 'cash/invalid-amount',
      });
    }
  });

  it('concepto vacío es cash/concept-required', () => {
    expect(buildManualCashMovement({ ...base, amount: 10, concept: '  ' })).toEqual({
      ok: false,
      error: 'cash/concept-required',
      meta: undefined,
    });
  });
});
