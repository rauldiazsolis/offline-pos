import { describe, expect, it } from 'vitest';
import { parseAmount, parseNonNegativeAmount } from './parse-amount.ts';

describe('parseAmount', () => {
  it('parsea un monto simple', () => {
    expect(parseAmount('100')).toBe(100);
  });

  it('acepta coma como separador decimal', () => {
    expect(parseAmount('1.500,50')).toBe(1500.5);
  });

  it('rechaza 0 — un pago/línea libre de $0 no tiene sentido de negocio', () => {
    expect(parseAmount('0')).toBeUndefined();
  });

  it('rechaza negativos, vacío y no-numérico', () => {
    expect(parseAmount('-5')).toBeUndefined();
    expect(parseAmount('')).toBeUndefined();
    expect(parseAmount('abc')).toBeUndefined();
  });
});

describe('parseNonNegativeAmount', () => {
  it('acepta 0 — abrir/cerrar un turno de caja sin efectivo es válido', () => {
    expect(parseNonNegativeAmount('0')).toBe(0);
  });

  it('parsea un monto positivo', () => {
    expect(parseNonNegativeAmount('500')).toBe(500);
  });

  it('rechaza negativos, vacío y no-numérico', () => {
    expect(parseNonNegativeAmount('-5')).toBeUndefined();
    expect(parseNonNegativeAmount('')).toBeUndefined();
    expect(parseNonNegativeAmount('abc')).toBeUndefined();
  });
});
