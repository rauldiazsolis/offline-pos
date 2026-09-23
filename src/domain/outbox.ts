import type { CashSession } from './cash-session.ts';
import type { Customer } from './customer.ts';
import type { Sale } from './sale.ts';
import type { StockMovement } from './stock.ts';

export type OutboxEventPayload =
  | { type: 'sale'; sale: Sale }
  | { type: 'stock-movement'; movement: StockMovement }
  | { type: 'sale-void'; saleId: string; voidedAt: string; voidReason?: string }
  | { type: 'customer'; customer: Customer }
  | { type: 'account-hold-confirm'; holdId: string; saleId: string }
  | { type: 'account-hold-release'; holdId: string }
  | { type: 'cash-session'; session: CashSession };

/**
 * Evento inmutable de sincronización (ver "Patrón outbox" en CLAUDE.md). El
 * reintento/backoff ya no es por evento — es por LOTE de push
 * (`domain/push-lot.ts`, #87) — así que `OutboxEvent` solo necesita saber si
 * ya viajó (`status`) y cuándo se creó (orden de armado del lote,
 * `createdAt`). `id` es también el id que identifica al evento dentro del
 * lote que lo incluye — para 'sale', 'stock-movement' y 'customer' es el id
 * de la propia entidad (la entidad ES el evento a sincronizar); 'sale-void',
 * 'account-hold-confirm' y 'account-hold-release' son operaciones distintas
 * sobre un recurso ya enviado, así que cada una necesita su propio id nuevo.
 */
export type OutboxEvent = OutboxEventPayload & {
  id: string;
  status: 'pending' | 'synced';
  createdAt: string; // ISO 8601 — también el orden FIFO al armar un lote
};

export function buildOutboxEventForSale(sale: Sale, params: { now: string }): OutboxEvent {
  return { type: 'sale', sale, id: sale.id, status: 'pending', createdAt: params.now };
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
    createdAt: params.now,
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
    createdAt: params.now,
  };
}

export function buildOutboxEventForCustomer(customer: Customer, params: { now: string }): OutboxEvent {
  return { type: 'customer', customer, id: customer.id, status: 'pending', createdAt: params.now };
}

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
    createdAt: params.now,
  };
}

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
    createdAt: params.now,
  };
}

export function buildOutboxEventForCashSession(
  session: CashSession,
  params: { now: string },
): OutboxEvent {
  return { type: 'cash-session', session, id: session.id, status: 'pending', createdAt: params.now };
}

/** Marca un evento como enviado con éxito (el lote que lo incluía recibió su ack). */
export function markSynced(event: OutboxEvent): OutboxEvent {
  return { ...event, status: 'synced' };
}
