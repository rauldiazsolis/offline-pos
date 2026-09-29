import { z } from 'zod';

/**
 * `wipe_key` del onboarding (#128): lo emite esta terminal al ir al alta y, si vuelve igual, la
 * autoriza a borrar lo local (la excepción a "cambiar la conexión nunca borra solo"). Un solo uso,
 * vence a las 2 h. `localStorage` es el borde: único try/catch.
 */
const STORAGE_KEY = 'offline-pos:pending-wipe-key';
export const WIPE_KEY_TTL_MS = 2 * 60 * 60 * 1000;
const storedSchema = z.object({ key: z.string(), issuedAt: z.string() });

export function issueWipeKey(
  now: Date,
  generate: () => string = () => crypto.randomUUID(),
): string {
  const key = generate();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ key, issuedAt: now.toISOString() }));
  } catch {
    // Sin localStorage no hay wipe_key: la vuelta precarga el wizard en vez de borrar.
  }
  return key;
}

/** `true` solo si `candidate` es la clave emitida, sin consumir y sin vencer. La consume. */
export function consumeWipeKey(candidate: string | undefined, now: Date): boolean {
  if (candidate === undefined) {
    return false;
  }
  let stored: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    stored = raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    stored = undefined;
  }
  const parsed = storedSchema.safeParse(stored);
  if (!parsed.success || parsed.data.key !== candidate) {
    return false;
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
  return now.getTime() - Date.parse(parsed.data.issuedAt) <= WIPE_KEY_TTL_MS;
}
