import { describe, expect, it } from 'vitest';
import { contractMajor, isCompatibleContract } from './contract-version.ts';

describe('isCompatibleContract (#99)', () => {
  it('mismo major y minor igual o mayor', () => {
    expect(isCompatibleContract('4.0.0')).toBe(true);
    expect(isCompatibleContract('4.2.1')).toBe(true);
  });

  it('otro major es incompatible', () => {
    expect(isCompatibleContract('3.9.0')).toBe(false);
    expect(isCompatibleContract('5.0.0')).toBe(false);
  });

  it('un backend en un minor anterior es incompatible', () => {
    expect(isCompatibleContract('4.0.0', '4.1.0')).toBe(false);
  });

  it('un formato inválido es incompatible', () => {
    expect(isCompatibleContract('abc')).toBe(false);
  });

  it('contractMajor', () => {
    expect(contractMajor('4.0.0')).toBe('4');
  });
});
