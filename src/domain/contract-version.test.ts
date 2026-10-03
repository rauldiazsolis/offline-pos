import { describe, expect, it } from 'vitest';
import {
  contractRequirement,
  isCompatibleContract,
  MIN_BACKEND_CONTRACT,
  POS_CONTRACT_VERSION,
} from './contract-version.ts';

describe('isCompatibleContract (piso 4.0.0, #128)', () => {
  it.each(['4.0.0', '4.2.0', '4.3.1', '4.4.0', '4.9.0'])('%s es compatible', (version) => {
    expect(isCompatibleContract(version)).toBe(true);
  });
  it.each(['3.9.0', '5.0.0', 'x', '4.0'])('%s es incompatible', (version) => {
    expect(isCompatibleContract(version)).toBe(false);
  });
  it('el piso es 4.0.0 y el POS habla 4.5.0', () => {
    expect(MIN_BACKEND_CONTRACT).toBe('4.0.0');
    expect(POS_CONTRACT_VERSION).toBe('4.5.0');
    expect(contractRequirement(MIN_BACKEND_CONTRACT)).toBe('4.0 o posterior');
  });
});
