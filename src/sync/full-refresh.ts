import type { PullMode } from './connector-registry.ts';

/** Cada cuánto un conector `delta` hace una foto completa para enterarse de las bajas (#87: 2h). */
export const FULL_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;

/**
 * ¿Este ciclo tiene que traer el catálogo **completo** (sin `since`) y reconciliar las bajas?
 * - `snapshot` (Sheets, sin delta): siempre — cada pull ya es completo.
 * - `delta` (REST): la primera vez de cada sesión (al arrancar), si nunca hubo una o pasó
 *   `FULL_REFRESH_INTERVAL_MS`, y a pedido (`forced`, `/SINCRONIZAR`). Un delta nunca informa
 *   qué se dio de baja: sin la foto, lo borrado en el origen sobreviviría para siempre.
 */
export function isFullRefreshDue(params: {
  mode: PullMode;
  lastFullAt: string | undefined;
  now: string;
  doneThisSession: boolean;
  forced?: boolean;
}): boolean {
  if (params.mode === 'snapshot' || params.forced === true || !params.doneThisSession) {
    return true;
  }
  if (params.lastFullAt === undefined) {
    return true;
  }
  const elapsed = new Date(params.now).getTime() - new Date(params.lastFullAt).getTime();
  return Number.isNaN(elapsed) || elapsed >= FULL_REFRESH_INTERVAL_MS;
}
