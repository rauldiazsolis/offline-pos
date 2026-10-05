import { beforeEach, describe, expect, it } from 'vitest';
import { backendPortalSignal } from '../ui/state/sync.ts';
import { portalOffer, restoreBackendPortal, saveBackendPortal } from './backend-portal.ts';

const panel = { command: 'PANEL', label: 'Panel del backend' };
const reserved = new Set(['COBRAR', 'CAJA']);

beforeEach(() => {
  localStorage.clear();
  backendPortalSignal.value = undefined;
});

describe('portal del backend (4.6.0, #179)', () => {
  it('se guarda, se restaura al arrancar y se borra con undefined', () => {
    saveBackendPortal(panel);
    backendPortalSignal.value = undefined;
    restoreBackendPortal();
    expect(backendPortalSignal.value).toEqual(panel);

    saveBackendPortal(undefined);
    expect(localStorage.getItem('offline-pos:backend-portal')).toBeNull();
    expect(backendPortalSignal.value).toBeUndefined();
  });

  it('un valor guardado inválido es "sin portal"', () => {
    localStorage.setItem('offline-pos:backend-portal', '{"command":"x"}');
    restoreBackendPortal();
    expect(backendPortalSignal.value).toBeUndefined();
  });
});

describe('portalOffer', () => {
  it('necesita la capacidad y el objeto', () => {
    expect(portalOffer(['portal'], panel, reserved)).toEqual(panel);
    expect(portalOffer([], panel, reserved)).toBeNull();
    expect(portalOffer(undefined, panel, reserved)).toBeNull();
    expect(portalOffer(['portal'], undefined, reserved)).toBeNull();
  });

  it('un nombre que choca con uno del POS pasa a PORTAL', () => {
    expect(portalOffer(['portal'], { command: 'CAJA', label: 'Mi panel' }, reserved)).toEqual({
      command: 'PORTAL',
      label: 'Mi panel',
    });
  });
});
