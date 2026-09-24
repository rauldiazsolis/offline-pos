/**
 * Backoff de un LOTE de push (Fase de rediseño de sync, #87) — mismo patrón
 * que el backoff por-evento que reemplaza (ver git blame de domain/outbox.ts),
 * pero a nivel de lote: con push batch (un solo idempotency_id por ciclo de
 * envío), el reintento es del lote entero, no de un evento individual.
 */
export type PushLot = {
  /** ULID, congelado junto con `eventIds` para toda la vida de este lote — ver CLAUDE.md. */
  id: string;
  /** Conjunto exacto de outbox.id incluidos — nunca se recalcula en un reintento. */
  eventIds: string[];
  createdAt: string;
  retries: number;
  nextAttemptAt: string;
  lastError?: string;
  /**
   * Un pull informó que el backend no conoce este lote (Etapa 3, #98): nunca
   * llegó. Solo para `/DIAGNOSTICO`; el lote se reintenta igual.
   */
  notReceivedAt?: string;
};

const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

/** Backoff exponencial con techo, determinístico (sin jitter aleatorio) — igual que el que reemplaza. */
export function nextRetryDelayMs(retries: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** retries, MAX_RETRY_DELAY_MS);
}

export function buildPushLot(eventIds: string[], params: { id: string; now: string }): PushLot {
  return {
    id: params.id,
    eventIds,
    createdAt: params.now,
    retries: 0,
    nextAttemptAt: params.now,
  };
}

/** Registra un intento fallido: suma un reintento y calcula cuándo reintentar. El id y los eventIds no cambian. */
export function markLotFailed(lot: PushLot, params: { now: string; error: string }): PushLot {
  const retries = lot.retries + 1;
  const nextAttemptAt = new Date(
    new Date(params.now).getTime() + nextRetryDelayMs(retries),
  ).toISOString();
  return { ...lot, retries, nextAttemptAt, lastError: params.error };
}

/** true si ya pasó la ventana de backoff del lote. */
export function isLotDue(lot: PushLot, now: string): boolean {
  return new Date(lot.nextAttemptAt).getTime() <= new Date(now).getTime();
}

export const PUSH_ERROR_RETRY_THRESHOLD = 3;

/** true si el lote en vuelo lleva varios reintentos fallidos seguidos — dispara `sync-error` en la barra. */
export function isPushStruggling(lot: PushLot | undefined): boolean {
  return lot !== undefined && lot.retries >= PUSH_ERROR_RETRY_THRESHOLD;
}

/** Marca que el backend, consultado en un pull, no conoce este lote (#98). El id y los eventIds no cambian. */
export function markLotNotReceived(lot: PushLot, now: string): PushLot {
  return { ...lot, notReceivedAt: now };
}
