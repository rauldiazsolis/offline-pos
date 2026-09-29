import { beforeEach, describe, expect, it } from 'vitest';
import { backendNoticesSignal } from '../ui/state/sync.ts';
import { mostSevere, restoreBackendNotices, saveBackendNotices } from './backend-notices.ts';

describe('avisos del backend (#128)', () => {
  beforeEach(() => {
    localStorage.clear();
    backendNoticesSignal.value = [];
  });

  it('se reemplazan enteros, se persisten y se restauran', () => {
    saveBackendNotices([{ id: 'a', severity: 'info', message: 'uno' }]);
    saveBackendNotices([
      { id: 'b', severity: 'warning', message: 'dos', ref: { type: 'sale', id: 's1' } },
    ]);
    backendNoticesSignal.value = [];
    restoreBackendNotices();
    expect(backendNoticesSignal.value).toEqual([
      { id: 'b', severity: 'warning', message: 'dos', ref: { type: 'sale', id: 's1' } },
    ]);
  });

  it('una lista vacía borra lo guardado', () => {
    saveBackendNotices([{ id: 'a', severity: 'info', message: 'uno' }]);
    saveBackendNotices([]);
    expect(localStorage.getItem('offline-pos:backend-notices')).toBeNull();
    expect(backendNoticesSignal.value).toEqual([]);
  });

  it('lo guardado inválido se lee como sin avisos', () => {
    localStorage.setItem('offline-pos:backend-notices', 'no-json');
    restoreBackendNotices();
    expect(backendNoticesSignal.value).toEqual([]);
  });

  it('mostSevere: critical > warning > info; sin avisos, undefined', () => {
    expect(mostSevere([])).toBeUndefined();
    expect(
      mostSevere([
        { id: 'a', severity: 'info', message: '' },
        { id: 'b', severity: 'critical', message: '' },
        { id: 'c', severity: 'warning', message: '' },
      ]),
    ).toBe('critical');
  });
});
