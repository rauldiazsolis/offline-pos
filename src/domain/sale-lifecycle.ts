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

/** Ventana de anulación (#99): 24 h móviles, no día calendario — cubre el turno noche. */
export const VOID_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinVoidWindow(sale: Pick<Sale, 'createdAt'>, now: string): boolean {
  return new Date(now).getTime() - new Date(sale.createdAt).getTime() < VOID_WINDOW_MS;
}

/** Anulada: con el status legado (antes de #99) o porque hay un ticket que la anula. */
export function isVoided(
  sale: Pick<Sale, 'id' | 'status'>,
  voidedSaleIds: ReadonlySet<string>,
): boolean {
  return sale.status === 'voided' || voidedSaleIds.has(sale.id);
}

function negateLine(line: SaleLine): SaleLine {
  return { ...line, qty: -line.qty };
}

function negatePayment(payment: Payment): Payment {
  // Sin `reference`: un pago `account` negativo sin hold es una acreditación (contrato).
  return { method: payment.method, amount: -payment.amount };
}

/**
 * La anulación como documento propio (RF-06, #99): un ticket nuevo con las
 * líneas y los pagos del original invertidos (el descuento de cada línea se
 * conserva), que mueve stock, saldo y efectivo por su cuenta. `voidsSaleId`
 * queda solo para auditoría; el original no se toca (RNF-07). Una devolución
 * común (negativa, sin `voidsSaleId`) también se anula: su anulación es un
 * ticket positivo.
 */
export function buildVoidSale(
  original: Sale,
  params: { id: string; now: string; reason?: string; isAlreadyVoided: boolean },
): Result<Sale> {
  if (original.voidsSaleId !== undefined) {
    return err('sale/cannot-void-a-void', undefined);
  }
  if (params.isAlreadyVoided || original.status === 'voided') {
    return err('sale/already-voided', undefined);
  }
  if (!isWithinVoidWindow(original, params.now)) {
    return err('sale/void-window-expired', { createdAt: original.createdAt });
  }
  return ok({
    id: params.id,
    status: 'closed',
    createdAt: params.now,
    lines: original.lines.map(negateLine),
    payments: original.payments.map(negatePayment),
    total: -original.total,
    voidsSaleId: original.id,
    ...(params.reason !== undefined ? { voidReason: params.reason } : {}),
    ...(original.customerId !== undefined ? { customerId: original.customerId } : {}),
    ...(original.globalAdjustmentPercentage !== undefined
      ? { globalAdjustmentPercentage: original.globalAdjustmentPercentage }
      : {}),
  });
}

/**
 * Genera los movimientos de stock de una venta: `delta = -qty` por línea,
 * así una línea negativa (devolución, o el ticket de una anulación, #99)
 * repone sola. `reason` es solo la etiqueta de auditoría (`sale-void` para
 * una anulación). Solo para líneas de producto cuyo producto trackea stock —
 * `trackedProductIds` lo resuelve el caller (storage), el dominio no
 * consulta el catálogo.
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

  const isTrackedProductLine = (line: SaleLine): line is Extract<SaleLine, { kind: 'product' }> =>
    line.kind === 'product' && trackedProductIds.has(line.productId);

  return sale.lines.filter(isTrackedProductLine).map((line) => ({
    id: newMovementId(),
    productId: line.productId,
    delta: -line.qty,
    reason,
    saleId: sale.id,
    createdAt: now,
  }));
}
