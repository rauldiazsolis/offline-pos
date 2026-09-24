import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../storage/db.ts';
import {
  CLEANUP_INTERVAL_MS,
  getLastCleanup,
  isCleanupDue,
  protectedEventIds,
  runCleanupIfDue,
} from './cleanup-schedule.ts';
import { addAwaitingLot, setCurrentPushLot } from './push-lot.ts';
import { buildPushLot } from '../domain/push-lot.ts';

const now = '2026-09-24T12:00:00.000Z';
const freeLock = () => () => undefined;

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('isCleanupDue', () => {
  it('sin registro, toca; antes de 24 h no; a las 24 h sí', () => {
    expect(isCleanupDue(undefined, now)).toBe(true);
    const last = {
      at: now,
      counts: { sales: 0, stockMovements: 0, accountMovements: 0, outbox: 0, cashSessions: 0 },
    };
    expect(
      isCleanupDue(last, new Date(Date.parse(now) + CLEANUP_INTERVAL_MS - 1).toISOString()),
    ).toBe(false);
    expect(isCleanupDue(last, new Date(Date.parse(now) + CLEANUP_INTERVAL_MS).toISOString())).toBe(
      true,
    );
  });
});

describe('protectedEventIds', () => {
  it('junta los eventos de los lotes en espera y del lote en curso', () => {
    addAwaitingLot({ id: 'a', sentAt: now, eventIds: ['e1'] });
    addAwaitingLot({ id: 'b', sentAt: now });
    setCurrentPushLot(buildPushLot(['e2'], { id: 'cur', now }));
    expect(protectedEventIds()).toEqual(new Set(['e1', 'e2']));
  });
});

describe('runCleanupIfDue', () => {
  it('corre, guarda el registro y no vuelve a correr antes de 24 h', async () => {
    const acquireLock = vi.fn(freeLock);
    await runCleanupIfDue({ now, acquireLock });
    expect(getLastCleanup()?.at).toBe(now);
    await runCleanupIfDue({ now, acquireLock });
    expect(acquireLock).toHaveBeenCalledTimes(1);
  });

  it('con el cerrojo tomado se saltea sin registrar nada', async () => {
    await runCleanupIfDue({ now, acquireLock: () => undefined });
    expect(getLastCleanup()).toBeUndefined();
  });

  it('libera el cerrojo aunque la limpieza falle', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(db.sales, 'bulkDelete').mockRejectedValueOnce(new Error('boom'));
    const release = vi.fn();
    await runCleanupIfDue({ now, acquireLock: () => release });
    expect(release).toHaveBeenCalledTimes(1);
    expect(getLastCleanup()).toBeUndefined();
  });
});
