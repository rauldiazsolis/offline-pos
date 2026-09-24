import type { Result } from '../domain/result.ts';
import { appendSyncLogEntry, type SyncLogEntry } from '../ui/state/sync.ts';
import type { PullApplication } from './pull-rule.ts';

/**
 * Registra un intento real de sync (push, pull o `getInfo`) en el log de
 * `/DIAGNOSTICO` — `request`/`result` son literalmente lo que el call site ya
 * tiene en la mano, sin resumir, así se puede correlacionar con la pestaña
 * Network. Un ciclo exitoso no toca la consola, salvo un pull que retuvo
 * stock y saldos: es el comportamiento esperado mientras un lote se procesa
 * (#98), va a `console.info`. Vive aparte del motor para que
 * `sync/backend-status.ts` lo use sin un import circular (#99).
 */
export function logSyncAttempt(
  kind: SyncLogEntry['kind'],
  now: string,
  request: unknown,
  result: Result<unknown>,
  application?: PullApplication,
): void {
  const entry: SyncLogEntry = {
    at: now,
    kind,
    request,
    result: result.ok ? { ok: true } : { ok: false, error: result.error, meta: result.meta },
    ...(application !== undefined ? { application } : {}),
  };
  appendSyncLogEntry(entry);
  if (!result.ok) {
    console.error(`[sync] ${kind} falló: ${result.error}`, entry);
    return;
  }
  if (application?.kind === 'retained') {
    console.info('[sync] pull aplicado sin stock ni saldos — lote(s) procesando', entry);
  }
}
