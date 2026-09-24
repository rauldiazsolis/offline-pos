import type { Cart } from './cart.ts';
import { err, ok, type Result } from './result.ts';
import { roundAmount } from './rounding.ts';
import type { Payment, Sale, SaleLine } from './sale.ts';
import { calculateTotals } from './totals.ts';
import type { StockMovement } from './stock.ts';

/**
 * Cierra una venta a partir de un carrito y los pagos registrados. Nunca
 * valida stock: la falta de stock es una advertencia, no un bloqueo (#99).
 *
 * El total puede ser 0 o negativo (#99: devoluciones). Todos los pagos
 * llevan el signo del total: con total > 0 cubren el total (el vuelto ya
 * viene descontado, `resolveTender`); con total < 0 suman exactamente el
 * total; con total 0 no hay pagos.
 *
 * `customerId` (Fase 3) es obligatorio si algún pago es `'account'` — cuenta
 * corriente siempre necesita saber a quién se le carga la venta.
 */
export function closeSale(params: {
  cart: Cart;
  payments: Payment[];
  id: string;
  createdAt: string;
  customerId?: string;
}): Result<Sale> {
  const { cart, payments, id, createdAt, customerId } = params;

  if (cart.lines.length === 0) {
    return err('sale/empty-cart', undefined);
  }

  const { total } = calculateTotals(cart);
  const sign = Math.sign(total);
  const invalidPaymentIndex = payments.findIndex(
    (payment) =>
      !Number.isFinite(payment.amount) ||
      payment.amount === 0 ||
      Math.sign(payment.amount) !== sign,
  );
  if (invalidPaymentIndex !== -1) {
    return err('sale/invalid-payment-amount', { index: invalidPaymentIndex });
  }

  if (payments.some((payment) => payment.method === 'account') && customerId === undefined) {
    return err('account/no-customer-attached', undefined);
  }

  const paid = roundAmount(payments.reduce((sum, payment) => sum + payment.amount, 0));
  if (total > 0 && paid < total) {
    return err('sale/insufficient-payment', { total, paid });
  }
  if (total < 0 && paid !== total) {
    return err('sale/refund-amount-mismatch', { total, tendered: Math.abs(paid) });
  }

  return ok({
    id,
    lines: cart.lines,
    payments,
    total,
    status: 'closed',
    createdAt,
    ...(customerId !== undefined ? { customerId } : {}),
    ...(cart.globalAdjustmentPercentage !== undefined
      ? { globalAdjustmentPercentage: cart.globalAdjustmentPercentage }
      : {}),
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
