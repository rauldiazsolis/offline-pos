import { beforeEach, describe, expect, it } from 'vitest';
import { backendCapabilitiesSignal } from '../ui/state/sync.ts';
import {
  CAPABILITY_CUSTOMER_PAYMENT_VOID,
  restoreBackendCapabilities,
  saveBackendCapabilities,
  supportsCapability,
} from './backend-capabilities.ts';

beforeEach(() => {
  localStorage.clear();
  backendCapabilitiesSignal.value = undefined;
});

describe('capacidades del backend (#128)', () => {
  it('se guardan, se restauran al arrancar y se borran con undefined', () => {
    saveBackendCapabilities(['customer-payment-void']);
    backendCapabilitiesSignal.value = undefined;
    restoreBackendCapabilities();
    expect(backendCapabilitiesSignal.value).toEqual(['customer-payment-void']);
    saveBackendCapabilities(undefined);
    expect(localStorage.getItem('offline-pos:backend-capabilities')).toBeNull();
    expect(backendCapabilitiesSignal.value).toBeUndefined();
  });

  it('un valor guardado inválido es "nunca se supo"', () => {
    localStorage.setItem('offline-pos:backend-capabilities', '{"no":"lista"}');
    restoreBackendCapabilities();
    expect(backendCapabilitiesSignal.value).toBeUndefined();
  });

  it('supportsCapability: true, false o undefined (nunca se supo)', () => {
    expect(supportsCapability(['customer-payment-void'], CAPABILITY_CUSTOMER_PAYMENT_VOID)).toBe(
      true,
    );
    expect(supportsCapability([], CAPABILITY_CUSTOMER_PAYMENT_VOID)).toBe(false);
    expect(supportsCapability(undefined, CAPABILITY_CUSTOMER_PAYMENT_VOID)).toBeUndefined();
  });
});
