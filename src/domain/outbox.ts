import type { Customer } from './customer.ts';
import type { Sale } from './sale.ts';
import type { StockMovement } from './stock.ts';

export type OutboxEventPayload =
  | { type: 'sale'; sale: Sale }
  | { type: 'stock-movement'; movement: StockMovement }
  | { type: 'sale-void'; saleId: string; voidedAt: string; voidReason?: string }
  | { type: 'customer'; customer: Customer }
  | { type: 'account-hold-confirm'; holdId: string; saleId: string }
  | { type: 'account-hold-release'; holdId: string };

/**
 * Evento inmutable de sincronización (ver "Patrón outbox" en CLAUDE.md).
 * `id` es también la Idempotency-Key que se envía al conector — para
 * 'sale', 'stock-movement' y 'customer' es el id de la propia entidad
 * (la entidad ES el evento a sincronizar); 'sale-void',
 * 'account-hold-confirm' y 'account-hold-release' son operaciones
 * distintas sobre un recurso ya enviado (una venta, un hold aprobado por el
 * backend), así que cada una necesita su propio id nuevo (reusar el id del
 * recurso original mezclaría operaciones distintas bajo la misma clave de
 * idempotencia).
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

export function buildOutboxEventForCustomer(customer: Customer, params: { now: string }): OutboxEvent {
  return {
    type: 'customer',
    customer,
    id: customer.id,
    status: 'pending',
    retries: 0,
    createdAt: params.now,
    nextAttemptAt: params.now,
  };
}

/**
 * Confirma ante el backend que un hold ya aprobado se usó en `saleId` —
 * RF-19, encolado en la misma transacción que la venta que lo consumió
 * (ver `storage/sale-repository.ts`) para que sobreviva a un corte de red
 * justo después de la aprobación.
 */
export function buildOutboxEventForHoldConfirm(params: {
  id: string;
  holdId: string;
  saleId: string;
  now: string;
}): OutboxEvent {
  return {
    type: 'account-hold-confirm',
    holdId: params.holdId,
    saleId: params.saleId,
    id: params.id,
    status: 'pending',
    retries: 0,
    createdAt: params.now,
    nextAttemptAt: params.now,
  };
}

/**
 * Libera (best-effort) un hold aprobado que terminó sin usarse — el cobro se
 * canceló después de que el backend ya lo había aprobado. Si nunca llega a
 * sincronizarse, el hold expira solo del lado del backend (§6 del diseño).
 */
export function buildOutboxEventForHoldRelease(params: {
  id: string;
  holdId: string;
  now: string;
}): OutboxEvent {
  return {
    type: 'account-hold-release',
    holdId: params.holdId,
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
