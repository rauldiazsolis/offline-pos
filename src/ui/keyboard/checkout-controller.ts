import { availableCredit, canChargeOffline } from '../../domain/customer.ts';
import { err, ok, type Result } from '../../domain/result.ts';
import type { Payment } from '../../domain/sale.ts';
import { resolveTender, type TenderedAmounts } from '../../domain/tender.ts';
import { calculateTotals } from '../../domain/totals.ts';
import { releaseAccountHold } from '../../storage/customer-repository.ts';
import { newId } from '../../storage/ids.ts';
import { closeSaleAndPersist } from '../../storage/sale-repository.ts';
import { requestAccountHoldNow } from '../../sync/account-hold.ts';
import { describeError } from '../errors.ts';
import { parseNonNegativeAmount } from '../parse-amount.ts';
import { cartSignal } from '../state/cart.ts';
import {
  checkoutBuffersSignal,
  checkoutErrorSignal,
  pendingHoldSignal,
  resetCheckout,
  TENDERABLE_METHODS,
} from '../state/checkout.ts';
import { getCustomerRepository } from '../state/customer-repository.ts';
import { attachedCustomerSignal, resetAttachedCustomer } from '../state/customer.ts';
import { receiptChangeSignal, receiptSaleSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';

function parsedTenderSafe(): TenderedAmounts {
  const buffers = checkoutBuffersSignal.value;
  const parsed = {} as TenderedAmounts;
  for (const method of TENDERABLE_METHODS) {
    parsed[method] = parseNonNegativeAmount(buffers[method]) ?? 0;
  }
  return parsed;
}

/** Suma de lo tipeado en todos los campos, ignorando texto inválido (se valida recién al confirmar). */
export function amountTendered(): number {
  const tender = parsedTenderSafe();
  return TENDERABLE_METHODS.reduce((sum, method) => sum + tender[method], 0);
}

/** Vista previa de vuelto para la pantalla — nunca negativo, no bloquea el tipeo. */
export function changePreview(): number {
  const { total } = calculateTotals(cartSignal.value);
  return Math.max(0, amountTendered() - total);
}

function parsedTenderOrError(): Result<TenderedAmounts> {
  const buffers = checkoutBuffersSignal.value;
  const parsed = {} as TenderedAmounts;
  for (const [index, method] of TENDERABLE_METHODS.entries()) {
    const raw = buffers[method];
    if (raw.trim() === '') {
      parsed[method] = 0;
      continue;
    }
    const value = parseNonNegativeAmount(raw);
    if (value === undefined) {
      return err('sale/invalid-payment-amount', { index });
    }
    parsed[method] = value;
  }
  return ok(parsed);
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

/**
 * Resuelve el pago de "Cuenta corriente" para `amount` (RF-17/18): reusa un
 * hold ya aprobado si el monto no cambió desde el intento anterior; si
 * cambió, libera ese hold (best-effort) y pide uno nuevo. Con red, pide un
 * hold síncrono contra el saldo real; sin red, evalúa el crédito disponible
 * cacheado. Nunca pasa por el outbox — la única operación de este tipo (ver
 * §5 del diseño).
 */
async function resolveAccountReference(amount: number): Promise<Result<string | undefined>> {
  const customer = attachedCustomerSignal.value;
  if (customer === undefined) {
    return err('account/no-customer-attached', undefined);
  }

  const existing = pendingHoldSignal.value;
  if (existing !== undefined && existing.customerId === customer.id && existing.amount === amount) {
    return ok(existing.holdId);
  }
  if (existing !== undefined) {
    void releaseAccountHold({ holdId: existing.holdId });
    pendingHoldSignal.value = undefined;
  }

  if (navigator.onLine) {
    const holdResult = await requestAccountHoldNow({
      customerId: customer.id,
      amount,
      idempotencyKey: newId(),
    });
    if (!holdResult.ok) {
      return holdResult;
    }
    if (!holdResult.value.approved) {
      return err('account/hold-rejected', { reasonCode: holdResult.value.reasonCode });
    }
    pendingHoldSignal.value = { holdId: holdResult.value.holdId, customerId: customer.id, amount };
    return ok(holdResult.value.holdId);
  }

  const account = await getCustomerRepository().getCustomerAccount(customer.id);
  if (account === undefined || !canChargeOffline(account, amount)) {
    const missing = account === undefined ? amount : amount - availableCredit(account);
    return err('account/offline-limit-exceeded', { missing });
  }
  return ok(undefined);
}

function attachReference(payments: Payment[], reference: string | undefined): Payment[] {
  if (reference === undefined) {
    return payments;
  }
  return payments.map((payment) => (payment.method === 'account' ? { ...payment, reference } : payment));
}

/**
 * Ctrl+Enter en la pantalla de cobro: valida lo tipeado en los 6 campos,
 * resuelve cuenta corriente si corresponde, y cierra la venta si con eso se
 * cubre el total — nunca antes (RNF-04, el menor número de pasos posible,
 * pero sin cerrar una venta a medio pagar).
 */
export async function submitCheckout(): Promise<void> {
  const tenderResult = parsedTenderOrError();
  if (!tenderResult.ok) {
    checkoutErrorSignal.value = describeError(tenderResult);
    return;
  }

  const { total } = calculateTotals(cartSignal.value);
  const resolved = resolveTender(tenderResult.value, total);
  if (!resolved.ok) {
    checkoutErrorSignal.value = describeError(resolved);
    return;
  }

  const accountAmount = tenderResult.value.account;
  let accountReference: string | undefined;
  if (accountAmount > 0) {
    const accountResult = await resolveAccountReference(accountAmount);
    if (!accountResult.ok) {
      checkoutErrorSignal.value = describeError(accountResult);
      return;
    }
    accountReference = accountResult.value;
  }

  const payments = attachReference(resolved.value.payments, accountReference);
  const customer = attachedCustomerSignal.value;
  const pendingHold = pendingHoldSignal.value;
  const result = await closeSaleAndPersist({
    cart: cartSignal.value,
    payments,
    ...(customer !== undefined ? { customerId: customer.id } : {}),
    ...(pendingHold !== undefined ? { pendingHold: { holdId: pendingHold.holdId } } : {}),
  });
  if (!result.ok) {
    checkoutErrorSignal.value = describeError(result);
    return;
  }

  receiptSaleSignal.value = result.value;
  receiptChangeSignal.value = resolved.value.change;
  cartSignal.value = { lines: [] };
  resetAttachedCustomer();
  resetCheckout();
  activeScreenSignal.value = 'receipt';
}
