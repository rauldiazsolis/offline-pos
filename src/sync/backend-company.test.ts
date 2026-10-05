import { beforeEach, describe, expect, it } from 'vitest';
import { backendCompanySignal } from '../ui/state/sync.ts';
import { restoreBackendCompany, saveBackendCompany } from './backend-company.ts';

beforeEach(() => {
  localStorage.clear();
  backendCompanySignal.value = undefined;
});

describe('empresa del backend (4.5.0, #193)', () => {
  it('se guarda, se restaura al arrancar y se borra con undefined', () => {
    saveBackendCompany({ name: 'Kiosco Pepe' });
    backendCompanySignal.value = undefined;
    restoreBackendCompany();
    expect(backendCompanySignal.value).toBe('Kiosco Pepe');

    saveBackendCompany(undefined);
    expect(localStorage.getItem('offline-pos:backend-company')).toBeNull();
    expect(backendCompanySignal.value).toBeUndefined();
  });

  it('un valor guardado inválido es "sin empresa"', () => {
    localStorage.setItem('offline-pos:backend-company', '{"name":3}');
    restoreBackendCompany();
    expect(backendCompanySignal.value).toBeUndefined();
  });
});
