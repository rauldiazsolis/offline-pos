import { afterEach, describe, expect, it } from 'vitest';
import { saveSyncConfig } from '../sync/config.ts';
import { parseAmount, parseNonNegativeAmount } from './parse-amount.ts';

afterEach(() => {
  localStorage.clear();
});

describe('parseAmount', () => {
  it('parsea un monto simple', () => {
    expect(parseAmount('100')).toBe(100);
  });

  it('sin locale configurado (en-US en el entorno de test), el punto es el separador decimal', () => {
    expect(parseAmount('1500.50')).toBe(1500.5);
  });

  it('con locale es-AR configurado, la coma es el separador decimal', () => {
    saveSyncConfig({ baseUrl: 'https://api.example.com', locale: 'es-AR' });

    expect(parseAmount('1500,50')).toBe(1500.5);
  });

  it('con locale es-AR, el punto (separador de miles) queda inválido en vez de descartarse en silencio', () => {
    saveSyncConfig({ baseUrl: 'https://api.example.com', locale: 'es-AR' });

    // Antes de este fix, "1.23" se interpretaba como miles y se leía 123 —
    // un teclado que no coincide con la configuración regional (ej. layout
    // US) tipeaba "." pensando en un decimal y el monto salía 100x mal, sin
    // ningún aviso. Ahora directamente queda inválido.
    expect(parseAmount('1.23')).toBeUndefined();
  });

  it('rechaza cualquier caracter que no sea dígito o separador — símbolos, letras, texto suelto', () => {
    expect(parseAmount('$3.35')).toBeUndefined();
    expect(parseAmount('x4,38')).toBeUndefined();
    expect(parseAmount('cualquier cosa')).toBeUndefined();
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
