import { calculateTotals } from '../../domain/totals.ts';
import { closeSaleAndPersist } from '../../storage/sale-repository.ts';
import { describeError } from '../errors.ts';
import { parseAmount } from '../parse-amount.ts';
import { cartSignal } from '../state/cart.ts';
import {
  checkoutBufferSignal,
  checkoutErrorSignal,
  checkoutPaymentsSignal,
  resetCheckout,
} from '../state/checkout.ts';
import { receiptSaleSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';

/** Total pagado hasta ahora en el cobro en curso. */
export function amountPaid(): number {
  return checkoutPaymentsSignal.value.reduce((sum, payment) => sum + payment.amount, 0);
}

/** Lo que falta pagar (negativo = vuelto) para el carrito actual. */
export function remainingToPay(): number {
  const { total } = calculateTotals(cartSignal.value);
  return total - amountPaid();
}

function addCashPayment(amount: number): void {
  checkoutPaymentsSignal.value = [...checkoutPaymentsSignal.value, { method: 'cash', amount }];
  checkoutBufferSignal.value = '';
  checkoutErrorSignal.value = null;
}

export function cancelCheckout(): void {
  resetCheckout();
  activeScreenSignal.value = 'sale';
}

async function confirmCheckout(): Promise<void> {
  const result = await closeSaleAndPersist({
    cart: cartSignal.value,
    payments: checkoutPaymentsSignal.value,
  });
  if (!result.ok) {
    checkoutErrorSignal.value = describeError(result);
    return;
  }

  receiptSaleSignal.value = result.value;
  cartSignal.value = { lines: [] };
  resetCheckout();
  activeScreenSignal.value = 'receipt';
}

/**
 * Enter en la pantalla de cobro: si hay un monto tipeado, lo agrega como pago
 * en efectivo; si con eso (o con lo ya pagado) se cubre el total, cierra la
 * venta en el mismo paso — RNF-04, el menor número de pasos posible.
 */
export function submitCheckout(): void {
  const buffer = checkoutBufferSignal.value;
  if (buffer.trim() !== '') {
    const amount = parseAmount(buffer);
    if (amount === undefined) {
      checkoutErrorSignal.value = 'Monto inválido.';
      return;
    }
    addCashPayment(amount);
  }

  if (remainingToPay() <= 0 && checkoutPaymentsSignal.value.length > 0) {
    void confirmCheckout();
  }
}
