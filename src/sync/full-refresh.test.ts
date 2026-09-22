import { describe, expect, it } from 'vitest';
import { FULL_REFRESH_INTERVAL_MS, isFullRefreshDue } from './full-refresh.ts';

const NOW = '2026-01-01T12:00:00.000Z';
const minutesAgo = (minutes: number): string =>
  new Date(new Date(NOW).getTime() - minutes * 60 * 1000).toISOString();

const base = { mode: 'delta' as const, lastFullAt: minutesAgo(5), now: NOW, doneThisSession: true };

describe('isFullRefreshDue', () => {
  it('el intervalo es de 2 horas', () => {
    expect(FULL_REFRESH_INTERVAL_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('con un conector snapshot todo pull es completo', () => {
    expect(isFullRefreshDue({ ...base, mode: 'snapshot' })).toBe(true);
  });

  it('delta: la primera vez de la sesión toca, aunque la última haya sido hace poco', () => {
    expect(isFullRefreshDue({ ...base, doneThisSession: false })).toBe(true);
  });

  it('delta: nunca hubo una (config nueva o cursores borrados) toca', () => {
    expect(isFullRefreshDue({ ...base, lastFullAt: undefined })).toBe(true);
  });

  it('delta: a pedido (forced) toca', () => {
    expect(isFullRefreshDue({ ...base, forced: true })).toBe(true);
  });

  it('delta: pasaron 2 horas o más toca; menos, no', () => {
    expect(isFullRefreshDue({ ...base, lastFullAt: minutesAgo(119) })).toBe(false);
    expect(isFullRefreshDue({ ...base, lastFullAt: minutesAgo(120) })).toBe(true);
    expect(isFullRefreshDue({ ...base, lastFullAt: minutesAgo(240) })).toBe(true);
  });

  it('delta: reciente, misma sesión y sin pedido → delta', () => {
    expect(isFullRefreshDue(base)).toBe(false);
  });

  it('una fecha guardada ilegible cuenta como "nunca"', () => {
    expect(isFullRefreshDue({ ...base, lastFullAt: 'basura' })).toBe(true);
  });
});
