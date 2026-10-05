import { z } from 'zod';
import { runLocalCleanup, type CleanupReport } from '../storage/local-cleanup.ts';
import { getAwaitingLots, getCurrentPushLot } from './push-lot.ts';
// #177: en entrenamiento, claves propias (training:…).
import { operationalKey } from '../storage/training-mode.ts';

/**
 * Cuándo corre la limpieza de datos locales (spec de #98, §4): al arrancar y
 * después de cada pull exitoso, como mucho una vez cada 24 h, con el cerrojo
 * de sync tomado (toca el outbox que lee el push). El registro de la última
 * ejecución vive en `localStorage` (best-effort, como los cursores: si se
 * pierde, la limpieza vuelve a correr antes — nunca borra de más).
 */
const LAST_CLEANUP_KEY = operationalKey('cleanup:last-run');
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type CleanupRecord = CleanupReport & { at: string };

/**
 * Un registro guardado antes de la Etapa 5 (#100: con turnos) no valida: se lee como si la
 * limpieza no hubiera corrido nunca y vuelve a correr — nunca borra de más.
 */
const cleanupRecordSchema = z.object({
  at: z.string(),
  counts: z.object({
    sales: z.number(),
    stockMovements: z.number(),
    accountMovements: z.number(),
    outbox: z.number(),
    cashMovements: z.number(),
    cashCounts: z.number(),
    // Un registro de antes de la Etapa 6 (#101) no lo tiene: se lee con 0 — a diferencia del de
    // la Etapa 5, no hay nada que invalidar.
    customerPayments: z.number().default(0),
  }),
  anchorAt: z.string().optional(),
});

export function getLastCleanup(): CleanupRecord | undefined {
  try {
    const raw = localStorage.getItem(LAST_CLEANUP_KEY);
    if (raw === null) {
      return undefined;
    }
    const parsed = cleanupRecordSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return undefined;
    }
    const { anchorAt, ...rest } = parsed.data;
    return anchorAt !== undefined ? { ...rest, anchorAt } : rest;
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
