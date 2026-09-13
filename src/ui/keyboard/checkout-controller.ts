import { availableCredit, canChargeOffline } from '../../domain/customer.ts';
import { calculateTotals } from '../../domain/totals.ts';
import { releaseAccountHold } from '../../storage/customer-repository.ts';
import { newId } from '../../storage/ids.ts';
import { closeSaleAndPersist } from '../../storage/sale-repository.ts';
import { requestAccountHoldNow } from '../../sync/account-hold.ts';
import { describeError } from '../errors.ts';
import { parseAmount } from '../parse-amount.ts';
import { cartSignal } from '../state/cart.ts';
import {
  checkoutBufferSignal,
  checkoutErrorSignal,
  checkoutPaymentsSignal,
  pendingHoldSignal,
  resetCheckout,
} from '../state/checkout.ts';
import { getCustomerRepository } from '../state/customer-repository.ts';
import { attachedCustomerSignal, resetAttachedCustomer } from '../state/customer.ts';
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

/** Esc: si había un hold aprobado sin usar, lo libera (best-effort, RF-19/§5). */
export function cancelCheckout(): void {
  const pendingHold = pendingHoldSignal.value;
  if (pendingHold !== undefined) {
    void releaseAccountHold({ holdId: pendingHold.holdId });
  }
  resetCheckout();
  activeScreenSignal.value = 'sale';
}

async function confirmCheckout(): Promise<void> {
  const customer = attachedCustomerSignal.value;
  const pendingHold = pendingHoldSignal.value;
  const result = await closeSaleAndPersist({
    cart: cartSignal.value,
    payments: checkoutPaymentsSignal.value,
    ...(customer !== undefined ? { customerId: customer.id } : {}),
    ...(pendingHold !== undefined ? { pendingHold: { holdId: pendingHold.holdId } } : {}),
  });
  if (!result.ok) {
    checkoutErrorSignal.value = describeError(result);
    return;
  }

  receiptSaleSignal.value = result.value;
  cartSignal.value = { lines: [] };
  resetAttachedCustomer();
  resetCheckout();
  activeScreenSignal.value = 'receipt';
}

/**
 * `/CUENTA` en el cobro (RF-17/RF-18): con red, pide un hold síncrono contra
 * el saldo real; sin red, evalúa el crédito disponible cacheado. Nunca pasa
 * por el outbox — es la única operación de este tipo (ver §5 del diseño).
 */
async function submitAccountPayment(): Promise<void> {
  const customer = attachedCustomerSignal.value;
  if (customer === undefined) {
    checkoutErrorSignal.value = describeError({
      ok: false,
      error: 'account/no-customer-attached',
      meta: undefined,
    });
    return;
  }

  const amount = remainingToPay();
  if (amount <= 0) {
    checkoutErrorSignal.value = 'No hay saldo pendiente para cobrar a cuenta corriente.';
    return;
  }

  if (navigator.onLine) {
    const holdResult = await requestAccountHoldNow({
      customerId: customer.id,
      amount,
      idempotencyKey: newId(),
    });
    if (!holdResult.ok) {
      checkoutErrorSignal.value = describeError(holdResult);
      return;
    }
    if (!holdResult.value.approved) {
      checkoutErrorSignal.value = describeError({
        ok: false,
        error: 'account/hold-rejected',
        meta: { reasonCode: holdResult.value.reasonCode },
      });
      return;
    }

    checkoutPaymentsSignal.value = [
      ...checkoutPaymentsSignal.value,
      { method: 'account', amount, reference: holdResult.value.holdId },
    ];
    pendingHoldSignal.value = { holdId: holdResult.value.holdId, customerId: customer.id };
    checkoutBufferSignal.value = '';
    checkoutErrorSignal.value = null;
    return;
  }

  const account = await getCustomerRepository().getCustomerAccount(customer.id);
  if (account === undefined || !canChargeOffline(account, amount)) {
    const missing = account === undefined ? amount : amount - availableCredit(account);
    checkoutErrorSignal.value = describeError({
      ok: false,
      error: 'account/offline-limit-exceeded',
      meta: { missing },
    });
    return;
  }

  checkoutPaymentsSignal.value = [...checkoutPaymentsSignal.value, { method: 'account', amount }];
  checkoutBufferSignal.value = '';
  checkoutErrorSignal.value = null;
}

/**
 * Enter en la pantalla de cobro: si el buffer es `/CUENTA`, cobra a cuenta
 * corriente (RF-17/18); si hay un monto tipeado, lo agrega como pago en
 * efectivo. Si con eso (o con lo ya pagado) se cubre el total, cierra la
 * venta en el mismo paso — RNF-04, el menor número de pasos posible.
 */
export async function submitCheckout(): Promise<void> {
  const buffer = checkoutBufferSignal.value;

  if (buffer.trim().toUpperCase() === '/CUENTA') {
    await submitAccountPayment();
  } else if (buffer.trim() !== '') {
    const amount = parseAmount(buffer);
    if (amount === undefined) {
      checkoutErrorSignal.value = 'Monto inválido.';
      return;
    }
    addCashPayment(amount);
  }

  if (remainingToPay() <= 0 && checkoutPaymentsSignal.value.length > 0) {
    await confirmCheckout();
  }
}
