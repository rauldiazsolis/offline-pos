import type { CashSession } from './cash-session.ts';
import type { OutboxEvent } from './outbox.ts';

/** Lo sincronizado se conserva 7 días (epic #94, Etapa 3 — #98). */
export const CLEANUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type CleanupCounts = {
  sales: number;
  stockMovements: number;
  accountMovements: number;
  outbox: number;
  cashSessions: number;
};

type Dated = { id: string; createdAt: string };
type SaleLinked = Dated & { saleId?: string };

export type CleanupInput = {
  now: string;
  /** Todo lo pendiente del outbox (nunca se borra, ni lo que depende de ello). */
  pendingEvents: readonly OutboxEvent[];
  /** Eventos de lotes en espera o en curso: hacen falta para reaplicar. */
  protectedEventIds: ReadonlySet<string>;
  sales: readonly Dated[];
  stockMovements: readonly SaleLinked[];
  accountMovements: readonly SaleLinked[];
  syncedEvents: readonly Dated[];
  cashSessions: readonly CashSession[];
};

export type CleanupPlan = {
  sales: string[];
  stockMovements: string[];
  accountMovements: string[];
  outbox: string[];
  cashSessions: string[];
  anchor: CashSession | undefined;
};

/**
 * Qué borrar de la base local (spec de #98, §4). Pura. Se borra lo que tiene
 * más de 7 días y está sincronizado; nunca lo pendiente, los eventos de lotes
 * sin resolver, ni el ancla del arqueo — mientras existan turnos (hasta la
 * Etapa 5, #100): el último turno cerrado, el abierto y sus ventas. Un evento
 * `sale` ausente del outbox cuenta como sincronizado: lo pendiente nunca se
 * borra, así que solo pudo irse por una limpieza anterior.
 */
export function planLocalCleanup(input: CleanupInput): CleanupPlan {
  const cutoff = new Date(input.now).getTime() - CLEANUP_RETENTION_MS;
  const isOld = (iso: string): boolean => new Date(iso).getTime() < cutoff;

  const pendingIds = new Set(input.pendingEvents.map((event) => event.id));
  const pendingVoidSaleIds = new Set(
    input.pendingEvents.flatMap((event) => (event.type === 'sale-void' ? [event.saleId] : [])),
  );

  const open = input.cashSessions.find((session) => session.closedAt === undefined);
  const anchor = input.cashSessions
    .filter((session) => session.closedAt !== undefined)
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0];
  const kept = [open, anchor].filter((session): session is CashSession => session !== undefined);
  const keptSessionIds = new Set(kept.map((session) => session.id));
  const keptSaleIds = new Set(kept.flatMap((session) => session.sales));

  const sales = input.sales
    .filter(
      (sale) =>
        isOld(sale.createdAt) &&
        !pendingIds.has(sale.id) &&
        !pendingVoidSaleIds.has(sale.id) &&
        !keptSaleIds.has(sale.id),
    )
    .map((sale) => sale.id);
  const deletedSales = new Set(sales);

  const stockMovements = input.stockMovements
    .filter(
      (movement) =>
        !pendingIds.has(movement.id) &&
        (movement.saleId !== undefined
          ? deletedSales.has(movement.saleId)
          : isOld(movement.createdAt)),
    )
    .map((movement) => movement.id);

  // Sin evento propio: siguen a su venta; sin venta se conservan (la Etapa 6 define su regla).
  const accountMovements = input.accountMovements
    .filter((movement) => movement.saleId !== undefined && deletedSales.has(movement.saleId))
    .map((movement) => movement.id);

  const outbox = input.syncedEvents
    .filter(
      (event) =>
        isOld(event.createdAt) &&
        !input.protectedEventIds.has(event.id) &&
        !pendingIds.has(event.id),
    )
    .map((event) => event.id);

  const cashSessions = input.cashSessions
    .filter(
      (session) =>
        session.closedAt !== undefined &&
        isOld(session.closedAt) &&
        !keptSessionIds.has(session.id),
    )
    .map((session) => session.id);

  return { sales, stockMovements, accountMovements, outbox, cashSessions, anchor };
}
