import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveSyncConfig } from '../sync/config.ts';
import { formatBalance } from './format-balance.ts';

beforeEach(() => {
  saveSyncConfig({ type: 'rest', baseUrl: 'http://x', locale: 'es-AR' });
});

afterEach(() => {
  localStorage.clear();
});

describe('formatBalance (#101)', () => {
  it('positivo debe, negativo a favor', () => {
    expect(formatBalance(1500)).toBe('Debe $1.500,00');
    expect(formatBalance(-200)).toBe('A favor $200,00');
  });

  it('0 o desconocido es "Sin saldo"', () => {
    expect(formatBalance(0)).toBe('Sin saldo');
    expect(formatBalance(undefined)).toBe('Sin saldo');
  });
});
