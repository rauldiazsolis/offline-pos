import type { Cart } from './cart.ts';
import { err, ok, type Result } from './result.ts';
import type { Payment, Sale, SaleLine } from './sale.ts';
import { calculateTotals } from './totals.ts';
import type { StockMovement } from './stock.ts';

/**
 * Cierra una venta a partir de un carrito y los pagos registrados. No
 * re-valida stock: ya se validó al armar cada línea del carrito (Fase 1 es
 * una sola terminal sin escritores concurrentes).
 */
export function closeSale(params: {
  cart: Cart;
  payments: Payment[];
  id: string;
  createdAt: string;
}): Result<Sale> {
  const { cart, payments, id, createdAt } = params;

  if (cart.lines.length === 0) {
    return err('sale/empty-cart', undefined);
  }

  const invalidPaymentIndex = payments.findIndex(
    (payment) => !Number.isFinite(payment.amount) || payment.amount <= 0,
  );
  if (invalidPaymentIndex !== -1) {
    return err('sale/invalid-payment-amount', { index: invalidPaymentIndex });
  }

  const { total } = calculateTotals(cart);
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (paid < total) {
    return err('sale/insufficient-payment', { total, paid });
  }

  return ok({
    id,
    lines: cart.lines,
    payments,
    total,
    status: 'closed',
    createdAt,
  });
}

/**
 * Anula una venta cerrada (RF-06). No edita lines/payments/total/createdAt
 * (RNF-07) — solo transiciona el status y agrega el rastro de auditoría
 * (voidedAt/voidReason). El stock revertido se registra aparte, ver
 * `buildStockMovementsForSale`.
 */
export function voidSale(sale: Sale, params: { now: string; reason?: string }): Result<Sale> {
  if (sale.status === 'voided') {
    return err('sale/already-voided', undefined);
  }
  if (sale.status !== 'closed') {
    return err('sale/not-closed', { status: sale.status });
  }

  return ok({
    ...sale,
    status: 'voided',
    voidedAt: params.now,
    ...(params.reason !== undefined ? { voidReason: params.reason } : {}),
  });
}

/**
 * Genera los movimientos de stock correspondientes a cerrar (`reason:
 * 'sale'`, resta) o anular (`reason: 'sale-void'`, repone) una venta. Solo
 * para líneas de producto cuyo producto trackea stock — `trackedProductIds`
 * lo resuelve el caller (storage), el dominio no consulta el catálogo.
 */
export function buildStockMovementsForSale(
  sale: Sale,
  params: {
    reason: StockMovement['reason'];
    now: string;
    newMovementId: () => string;
    trackedProductIds: ReadonlySet<string>;
  },
): StockMovement[] {
  const { reason, now, newMovementId, trackedProductIds } = params;
  const sign = reason === 'sale' ? -1 : 1;

  const isTrackedProductLine = (line: SaleLine): line is Extract<SaleLine, { kind: 'product' }> =>
    line.kind === 'product' && trackedProductIds.has(line.productId);

  return sale.lines.filter(isTrackedProductLine).map((line) => ({
    id: newMovementId(),
    productId: line.productId,
    delta: sign * line.qty,
    reason,
    saleId: sale.id,
    createdAt: now,
  }));
}
