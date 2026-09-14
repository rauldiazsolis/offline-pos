import { afterEach, describe, expect, it } from 'vitest';
import { saveSyncConfig } from '../sync/config.ts';
import { formatMoney } from './format.ts';

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
