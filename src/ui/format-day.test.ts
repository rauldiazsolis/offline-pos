import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveSyncConfig } from '../sync/config.ts';
import { formatDayHeading } from './format-day.ts';

beforeEach(() => {
  saveSyncConfig({ type: 'rest', baseUrl: 'http://x', locale: 'es-AR' });
});

afterEach(() => {
  localStorage.clear();
});

describe('formatDayHeading (#100)', () => {
  it('hoy, ayer o el día de la semana con la fecha', () => {
    expect(formatDayHeading('2026-09-24', '2026-09-24')).toBe('Hoy · jueves 24/09');
    expect(formatDayHeading('2026-09-23', '2026-09-24')).toBe('Ayer · miércoles 23/09');
    expect(formatDayHeading('2026-09-22', '2026-09-24')).toBe('martes 22/09');
  });
});
