import type { Sale } from './sale.ts';
import type { StockMovement } from './stock.ts';

export type OutboxEventPayload =
  | { type: 'sale'; sale: Sale }
  | { type: 'stock-movement'; movement: StockMovement }
  | { type: 'sale-void'; saleId: string; voidedAt: string; voidReason?: string };

/**
 * Evento inmutable de sincronización (ver "Patrón outbox" en CLAUDE.md).
 * `id` es también la Idempotency-Key que se envía al conector — para
 * 'sale' y 'stock-movement' es el id de la propia entidad (`Sale.id` /
 * `StockMovement.id`: la entidad ES el evento a sincronizar); 'sale-void'
 * es una operación distinta sobre una venta ya enviada, así que necesita su
 * propio id nuevo (reusar el de la venta mezclaría dos operaciones bajo la
 * misma clave de idempotencia).
 */
export type OutboxEvent = OutboxEventPayload & {
  id: string;
  status: 'pending' | 'synced';
  retries: number;
  createdAt: string; // ISO 8601
  nextAttemptAt: string; // ISO 8601 — el motor ignora filas con esto en el futuro
  lastError?: string;
};

const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

/** Backoff exponencial con techo, determinístico (sin jitter aleatorio). */
export function nextRetryDelayMs(retries: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** retries, MAX_RETRY_DELAY_MS);
}

export function buildOutboxEventForSale(sale: Sale, params: { now: string }): OutboxEvent {
  return {
    type: 'sale',
    sale,
    id: sale.id,
    status: 'pending',
    retries: 0,
    createdAt: params.now,
    nextAttemptAt: params.now,
  };
}

export function buildOutboxEventsForStockMovements(
  movements: StockMovement[],
  params: { now: string },
): OutboxEvent[] {
  return movements.map((movement) => ({
    type: 'stock-movement',
    movement,
    id: movement.id,
    status: 'pending',
    retries: 0,
    createdAt: params.now,
    nextAttemptAt: params.now,
  }));
}

export function buildOutboxEventForVoid(params: {
  id: string;
  saleId: string;
  voidedAt: string;
  voidReason?: string;
  now: string;
}): OutboxEvent {
  return {
    type: 'sale-void',
    saleId: params.saleId,
    voidedAt: params.voidedAt,
    ...(params.voidReason !== undefined ? { voidReason: params.voidReason } : {}),
    id: params.id,
    status: 'pending',
    retries: 0,
    createdAt: params.now,
    nextAttemptAt: params.now,
  };
}

/** Marca un evento como enviado con éxito. */
export function markSynced(event: OutboxEvent): OutboxEvent {
  return { ...event, status: 'synced' };
}

/** Registra un intento fallido: suma un reintento y calcula cuándo reintentar. */
export function markFailed(
  event: OutboxEvent,
  params: { now: string; error: string },
): OutboxEvent {
  const retries = event.retries + 1;
  const nextAttemptAt = new Date(
    new Date(params.now).getTime() + nextRetryDelayMs(retries),
  ).toISOString();
  return { ...event, retries, nextAttemptAt, lastError: params.error };
}

/** true si el evento está pendiente y ya pasó su ventana de backoff. */
export function isDue(event: OutboxEvent, now: string): boolean {
  return (
    event.status === 'pending' && new Date(event.nextAttemptAt).getTime() <= new Date(now).getTime()
  );
}

export const SYNC_ERROR_RETRY_THRESHOLD = 3;

/**
 * true si algún evento pendiente lleva varios reintentos fallidos seguidos
 * — dispara el estado `sync-error` de la barra (distinto de `syncing`,
 * que es solo un delay normal).
 */
export function isSyncStruggling(events: OutboxEvent[]): boolean {
  return events.some(
    (event) => event.status === 'pending' && event.retries >= SYNC_ERROR_RETRY_THRESHOLD,
  );
}
