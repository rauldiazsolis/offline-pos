import { beforeEach, describe, expect, it } from 'vitest';
import { appendSyncLogEntry, syncLogSignal, type SyncLogEntry } from './sync.ts';

function entry(at: string): SyncLogEntry {
  return { at, kind: 'pull', request: { cursors: {}, pendingLotIds: [] }, result: { ok: true } };
}

beforeEach(() => {
  syncLogSignal.value = [];
});

describe('syncLogSignal / appendSyncLogEntry (para /DIAGNOSTICO)', () => {
  it('arranca vacío', () => {
    expect(syncLogSignal.value).toEqual([]);
  });

  it('agrega al principio (más nuevo primero)', () => {
    appendSyncLogEntry(entry('2026-01-01T00:00:00.000Z'));
    appendSyncLogEntry(entry('2026-01-01T00:00:01.000Z'));

    expect(syncLogSignal.value.map((e) => e.at)).toEqual([
      '2026-01-01T00:00:01.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
  });

  it('tope de 20: descarta las más viejas', () => {
    for (let i = 0; i < 25; i += 1) {
      appendSyncLogEntry(entry(`2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`));
    }

    expect(syncLogSignal.value).toHaveLength(20);
    expect(syncLogSignal.value[0]?.at).toBe('2026-01-01T00:00:24.000Z'); // la última agregada
    expect(syncLogSignal.value.at(-1)?.at).toBe('2026-01-01T00:00:05.000Z'); // se descartaron las 5 más viejas
  });
});
