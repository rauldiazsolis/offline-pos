import type { CashMovement } from './cash-movement.ts';
import type { Customer } from './customer.ts';
import type { CustomerPayment } from './customer-payment.ts';
import type { EventOrigin } from './event-origin.ts';
import type { Sale } from './sale.ts';
import type { StockMovement } from './stock.ts';

export type OutboxEventPayload =
  | { type: 'sale'; sale: Sale }
  | { type: 'stock-movement'; movement: StockMovement }
  | { type: 'customer'; customer: Customer }
  | { type: 'account-hold-confirm'; holdId: string; saleId: string }
  | { type: 'account-hold-release'; holdId: string }
  | { type: 'cash-movement'; movement: CashMovement }
  | { type: 'customer-payment'; payment: CustomerPayment };

/**
 * Evento inmutable de sincronización (ver "Patrón outbox" en CLAUDE.md). El
 * reintento/backoff ya no es por evento — es por LOTE de push
 * (`domain/push-lot.ts`, #87) — así que `OutboxEvent` solo necesita saber si
 * ya viajó (`status`) y cuándo se creó (orden de armado del lote,
 * `createdAt`). `id` es también el id que identifica al evento dentro del
 * lote que lo incluye — para 'sale', 'stock-movement', 'customer',
 * 'cash-movement' y 'customer-payment' es el id de la propia entidad (la entidad ES el evento a
 * sincronizar); 'account-hold-confirm' y 'account-hold-release' son operaciones distintas
 * sobre un recurso ya enviado, así que cada una necesita su propio id nuevo.
 */
export type OutboxEvent = OutboxEventPayload & {
  id: string;
  status: 'pending' | 'synced';
  createdAt: string; // ISO 8601 — también el orden FIFO al armar un lote
  /** Estampado al encolar (contrato v3). Ausente solo en eventos encolados antes de v3. */
  origin?: EventOrigin;
};

/**
 * Tipos que el contrato ya no tiene: `cash-session` (v3, sin turnos de caja,
 * epic #94) y `sale-void` (4.0.0, #99: la anulación viaja como un `sale` con
 * `voidsSaleId`). Un evento así que haya quedado pendiente en una terminal no
 * viaja nunca: `storage/local-data.ts::listPendingOutbox` lo marca como
 * enviado. Un `sale-void` pendiente ya mandó su stock por sus propios
 * `stock-movement`; se pierde solo el aviso de la anulación (riesgo aceptado:
 * no hay terminales en producción).
 */
export const LEGACY_OUTBOX_TYPES: ReadonlySet<string> = new Set(['cash-session', 'sale-void']);

export function isLegacyOutboxType(type: string): boolean {
  return LEGACY_OUTBOX_TYPES.has(type);
}

export function buildOutboxEventForSale(
  sale: Sale,
  params: { now: string; origin: EventOrigin },
): OutboxEvent {
  return {
    type: 'sale',
    sale,
    id: sale.id,
    status: 'pending',
    createdAt: params.now,
    origin: params.origin,
  };
}

export function buildOutboxEventsForStockMovements(
  movements: StockMovement[],
  params: { now: string; origin: EventOrigin },
): OutboxEvent[] {
  return movements.map((movement) => ({
    type: 'stock-movement',
    movement,
    id: movement.id,
    status: 'pending',
    createdAt: params.now,
    origin: params.origin,
  }));
}

export function buildOutboxEventForCustomer(
  customer: Customer,
  params: { now: string; origin: EventOrigin },
): OutboxEvent {
  return {
    type: 'customer',
    customer,
    id: customer.id,
    status: 'pending',
    createdAt: params.now,
    origin: params.origin,
  };
}

export function buildOutboxEventForHoldConfirm(params: {
  id: string;
  holdId: string;
  saleId: string;
  now: string;
  origin: EventOrigin;
}): OutboxEvent {
  return {
    type: 'account-hold-confirm',
    holdId: params.holdId,
    saleId: params.saleId,
    id: params.id,
    status: 'pending',
    createdAt: params.now,
    origin: params.origin,
  };
}

export function buildOutboxEventForHoldRelease(params: {
  id: string;
  holdId: string;
  now: string;
  origin: EventOrigin;
}): OutboxEvent {
  return {
    type: 'account-hold-release',
    holdId: params.holdId,
    id: params.id,
    status: 'pending',
    createdAt: params.now,
    origin: params.origin,
  };
}

export function buildOutboxEventForCashMovement(
  movement: CashMovement,
  params: { now: string; origin: EventOrigin },
): OutboxEvent {
  return {
    type: 'cash-movement',
    movement,
    id: movement.id,
    status: 'pending',
    createdAt: params.now,
    origin: params.origin,
  };
}

export function buildOutboxEventForCustomerPayment(
  payment: CustomerPayment,
  params: { now: string; origin: EventOrigin },
): OutboxEvent {
  return {
    type: 'customer-payment',
    payment,
    id: payment.id,
    status: 'pending',
    createdAt: params.now,
    origin: params.origin,
  };
}

/** Marca un evento como enviado con éxito (el lote que lo incluía recibió su ack). */
export function markSynced(event: OutboxEvent): OutboxEvent {
  return { ...event, status: 'synced' };
}
