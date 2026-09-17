import { afterEach, describe, expect, it } from 'vitest';
import { saveSyncConfig } from '../sync/config.ts';
import { formatDate, formatMoney, formatQuantity } from './format.ts';

afterEach(() => {
  localStorage.clear();
});

describe('formatMoney', () => {
  it('sin config guardada, usa navigator.language', () => {
    const expected = new Intl.NumberFormat(navigator.language, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234.5);

    expect(formatMoney(1234.5)).toBe(expected);
  });

  it('con locale configurado, lo usa en vez de navigator.language', () => {
    saveSyncConfig({ baseUrl: 'https://api.example.com', locale: 'en-US' });

    expect(formatMoney(1234.5)).toBe('1,234.50');
  });

  it('con locale configurado es-AR, usa coma decimal', () => {
    saveSyncConfig({ baseUrl: 'https://api.example.com', locale: 'es-AR' });

    expect(formatMoney(1234.5)).toBe('1.234,50');
  });
});

describe('formatDate (Ciclo 8: desambiguación de clientes)', () => {
  it('formatea con el locale configurado', () => {
    saveSyncConfig({ baseUrl: 'https://api.example.com', locale: 'en-US' });

    expect(formatDate('2026-03-05T00:00:00.000Z')).toBe('03/05/2026');
  });

  it('con locale es-AR, usa el orden día/mes/año', () => {
    saveSyncConfig({ baseUrl: 'https://api.example.com', locale: 'es-AR' });

    expect(formatDate('2026-03-05T00:00:00.000Z')).toBe('05/03/2026');
  });
});

describe('formatQuantity', () => {
  it('entero sin decimales', () => {
    expect(formatQuantity(3)).toBe('3');
  });

  it('redondea a 3 decimales', () => {
    expect(formatQuantity(5.9514999)).toBe('5.951');
  });

  it('sin ceros de más a la derecha', () => {
    expect(formatQuantity(5.95)).toBe('5.95');
    // Arrastre de punto flotante real (ej. 0.1 + 0.1 + 5.75) — como literal de código fuente
    // (`5.9500000000000005`) el linter lo rechaza (no se puede representar exacto en un
    // `double`), así que se construye en runtime, que es como aparece en la práctica.
    expect(formatQuantity(Number('5.9500000000000005'))).toBe('5.95');
  });
});
