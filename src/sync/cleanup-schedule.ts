import { runLocalCleanup, type CleanupReport } from '../storage/local-cleanup.ts';
import { getAwaitingLots, getCurrentPushLot } from './push-lot.ts';

/**
 * Cuándo corre la limpieza de datos locales (spec de #98, §4): al arrancar y
 * después de cada pull exitoso, como mucho una vez cada 24 h, con el cerrojo
 * de sync tomado (toca el outbox que lee el push). El registro de la última
 * ejecución vive en `localStorage` (best-effort, como los cursores: si se
 * pierde, la limpieza vuelve a correr antes — nunca borra de más).
 */
const LAST_CLEANUP_KEY = 'offline-pos:cleanup:last-run';
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type CleanupRecord = CleanupReport & { at: string };

export function getLastCleanup(): CleanupRecord | undefined {
  try {
    const raw = localStorage.getItem(LAST_CLEANUP_KEY);
    return raw === null ? undefined : (JSON.parse(raw) as CleanupRecord);
  } catch {
    return undefined;
  }
}

function setLastCleanup(record: CleanupRecord): void {
  try {
    localStorage.setItem(LAST_CLEANUP_KEY, JSON.stringify(record));
  } catch {
    /* best-effort */
  }
}

export function isCleanupDue(last: CleanupRecord | undefined, now: string): boolean {
  return last === undefined || Date.parse(now) - Date.parse(last.at) >= CLEANUP_INTERVAL_MS;
}

/** Eventos de lotes sin resolver: la reaplicación los necesita, la limpieza no los toca. */
export function protectedEventIds(): Set<string> {
  return new Set([
    ...getAwaitingLots().flatMap((lot) => lot.eventIds ?? []),
    ...(getCurrentPushLot()?.eventIds ?? []),
  ]);
}

export async function runCleanupIfDue(params: {
  now: string;
  acquireLock: () => (() => void) | undefined;
}): Promise<void> {
  if (!isCleanupDue(getLastCleanup(), params.now)) {
    return;
  }
  const release = params.acquireLock();
  if (release === undefined) {
    return;
  }
  try {
    const result = await runLocalCleanup({
      now: params.now,
      protectedEventIds: protectedEventIds(),
    });
    if (!result.ok) {
      console.error('[limpieza] no se pudieron borrar los datos locales viejos', result);
      return;
    }
    setLastCleanup({ at: params.now, ...result.value });
  } finally {
    release();
  }
}
