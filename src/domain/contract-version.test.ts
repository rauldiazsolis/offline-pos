import { describe, expect, it } from 'vitest';
import {
  contractRequirement,
  isCompatibleContract,
  POS_CONTRACT_VERSION,
} from './contract-version.ts';

describe('isCompatibleContract (#99)', () => {
  it('el POS habla 4.2.0 (#101: recibo de cobranza y saldo sin cuenta corriente)', () => {
    expect(POS_CONTRACT_VERSION).toBe('4.2.0');
  });

  it('mismo major y minor igual o mayor', () => {
    expect(isCompatibleContract('4.2.0')).toBe(true);
    expect(isCompatibleContract('4.3.1')).toBe(true);
  });

  it('otro major es incompatible', () => {
    expect(isCompatibleContract('3.9.0')).toBe(false);
    expect(isCompatibleContract('5.0.0')).toBe(false);
  });

  it('un backend en un minor anterior es incompatible', () => {
    expect(isCompatibleContract('4.1.0')).toBe(false);
    expect(isCompatibleContract('4.0.0')).toBe(false);
  });

  it('un formato inválido es incompatible', () => {
    expect(isCompatibleContract('abc')).toBe(false);
  });

  it('contractRequirement', () => {
    expect(contractRequirement(POS_CONTRACT_VERSION)).toBe('4.2 o posterior');
  });
});
