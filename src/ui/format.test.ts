import { afterEach, describe, expect, it } from 'vitest';
import { saveSyncConfig } from '../sync/config.ts';
import { formatDate, formatMoney } from './format.ts';

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
