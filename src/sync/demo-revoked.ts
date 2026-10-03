import { z } from 'zod';
import type { Failure, Result } from '../domain/result.ts';
import { storageKey } from '../storage/storage-namespace.ts';
import { setDemoRevoked } from '../ui/state/sync.ts';
import type { SyncConfig } from './config.ts';

/**
 * Demo revocada (#176). La key de una demo la dio `POST /demo-sessions` y se probó con un pull: con
 * la terminal en demo, un 401 o 403 no puede ser una key mal cargada, es una demo que el backend
 * revocó (en mini: el reinicio nocturno o 24 h sin uso). Estado operativo best-effort, como los
 * cursores: perderlo solo hace que el próximo ciclo lo vuelva a descubrir.
 */
const STORAGE_KEY = storageKey('demo-revoked');
const storedSchema = z.object({ at: z.string() });

/** Pura. */
export function isDemoRevokedFailure(failure: Failure, config: Result<SyncConfig>): boolean {
  return (
    config.ok &&
    config.value.demo !== undefined &&
    failure.error === 'sync/request-failed' &&
    (failure.meta.status === 401 || failure.meta.status === 403)
  );
}

export function markDemoRevoked(at: string): void {
  setDemoRevoked(at);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ at }));
  } catch {
    // Best-effort: el signal ya tiene el valor de esta sesión.
  }
}

export function clearDemoRevoked(): void {
  setDemoRevoked(null);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}

export function restoreDemoRevoked(): void {
  let parsedJson: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    parsedJson = raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    parsedJson = null;
  }
  const parsed = storedSchema.safeParse(parsedJson);
  setDemoRevoked(parsed.success ? parsed.data.at : null);
}
