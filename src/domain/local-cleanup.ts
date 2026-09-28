import type { OutboxEvent } from './outbox.ts';

/** Lo sincronizado se conserva 7 días (epic #94, Etapa 3 — #98). */
export const CLEANUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type CleanupCounts = {
  sales: number;
  stockMovements: number;
  accountMovements: number;
  outbox: number;
  cashMovements: number;
  cashCounts: number;
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
  cashMovements: readonly Dated[];
  cashCounts: readonly (Dated & { adjustmentId?: string })[];
  /** El último arqueo de la terminal, sea cual sea su edad: el ancla. */
  lastCount: Dated | undefined;
};

export type CleanupPlan = {
  sales: string[];
  stockMovements: string[];
  accountMovements: string[];
  outbox: string[];
  cashMovements: string[];
  cashCounts: string[];
  anchorAt: string | undefined;
};

/**
 * Qué borrar de la base local (spec de #98, §4, con el ancla de la Etapa 5 — #100, §7). Pura. Se
 * borra lo que tiene más de 7 días y está sincronizado; nunca lo pendiente, los eventos de lotes
 * sin resolver, ni lo que sostiene el saldo de efectivo:
 *
 * - **Ancla = el último arqueo.** Todo lo creado desde su `createdAt` en adelante se conserva
 *   (ventas, movimientos de stock, de cuenta y de caja, y el propio arqueo), aunque tenga más de
 *   7 días: es lo que suma al saldo.
 * - **Sin ningún arqueo**, las ventas y los movimientos de caja son la base 0 del saldo: no se
 *   borran. Los movimientos de stock y de cuenta siguen su regla de edad.
 *
 * Un evento `sale` ausente del outbox cuenta como sincronizado: lo pendiente nunca se borra, así
 * que solo pudo irse por una limpieza anterior. Cada venta se mide por su propia edad y su propio
 * evento: una anulación es otra venta (#99), no retiene a la que anula. Los movimientos de stock y
 * de cuenta son registros **independientes** de su venta (el `saleId` es solo auditoría): se
 * borran por su propia edad, nunca "junto con" la venta. Un arqueo no tiene evento propio, pero si
 * tuvo ajuste espera a que ese evento no esté pendiente.
 */
export function planLocalCleanup(input: CleanupInput): CleanupPlan {
  const cutoff = new Date(input.now).getTime() - CLEANUP_RETENTION_MS;
  const isOld = (iso: string): boolean => new Date(iso).getTime() < cutoff;

  const pendingIds = new Set(input.pendingEvents.map((event) => event.id));
  const anchorAt = input.lastCount?.createdAt;
  const keptByAnchor = (iso: string): boolean => anchorAt !== undefined && iso >= anchorAt;
  const removable = (item: Dated): boolean =>
    isOld(item.createdAt) && !pendingIds.has(item.id) && !keptByAnchor(item.createdAt);

  const sales = anchorAt === undefined ? [] : input.sales.filter(removable).map((sale) => sale.id);

  // Viajan como su propio evento `stock-movement`.
  const stockMovements = input.stockMovements.filter(removable).map((movement) => movement.id);

  // Sin evento propio: viajan dentro del evento `sale` de su venta, así que esperan a que ese no
  // esté pendiente. Sin venta se conservan (la Etapa 6 define su regla cuando genere cobranzas).
  const accountMovements = input.accountMovements
    .filter(
      (movement) =>
        movement.saleId !== undefined &&
        isOld(movement.createdAt) &&
        !pendingIds.has(movement.saleId) &&
        !keptByAnchor(movement.createdAt),
    )
    .map((movement) => movement.id);

  const outbox = input.syncedEvents
    .filter(
      (event) =>
        isOld(event.createdAt) &&
        !input.protectedEventIds.has(event.id) &&
        !pendingIds.has(event.id),
    )
    .map((event) => event.id);

  // Viajan como su propio evento `cash-movement`.
  const cashMovements =
    anchorAt === undefined
      ? []
      : input.cashMovements.filter(removable).map((movement) => movement.id);

  const cashCounts = input.cashCounts
    .filter(
      (count) =>
        isOld(count.createdAt) &&
        !keptByAnchor(count.createdAt) &&
        (count.adjustmentId === undefined || !pendingIds.has(count.adjustmentId)),
    )
    .map((count) => count.id);

  return {
    sales,
    stockMovements,
    accountMovements,
    outbox,
    cashMovements,
    cashCounts,
    anchorAt,
  };
}
