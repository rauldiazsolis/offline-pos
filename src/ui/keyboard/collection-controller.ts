import { applyBalanceDelta } from '../../domain/customer-balance.ts';
import {
  COLLECTION_METHODS,
  resolveCollection,
  type CollectionMethod,
} from '../../domain/customer-payment.ts';
import { err, ok, type Result } from '../../domain/result.ts';
import { roundAmount } from '../../domain/rounding.ts';
import { collectAndPersist } from '../../storage/customer-payment-repository.ts';
import { describeError } from '../errors.ts';
import { parseNonNegativeAmount } from '../parse-amount.ts';
import { showOrPrintReceipt } from '../print/after-close.ts';
import {
  collectionBuffersSignal,
  collectionErrorSignal,
  resetCollection,
} from '../state/collection.ts';
import { customerBalancesSignal, refreshCustomerBalances } from '../state/customer-balance.ts';
import { attachedCustomerSignal, resetAttachedCustomer } from '../state/customer.ts';
import { activeScreenSignal } from '../state/screen.ts';

/** Al abrir la cobranza (#101): todos los campos vacíos, sin precarga — no hay un total que cubrir. */
export function enterCollection(): void {
  resetCollection();
}

/** Campo al que lleva Enter/↓ (`direction` 1) o ↑ (-1) desde `from`. Sin ciclar. */
export function moveCollectionField(
  from: CollectionMethod,
  direction: 1 | -1,
): CollectionMethod | undefined {
  const index = COLLECTION_METHODS.indexOf(from);
  return index === -1 ? undefined : COLLECTION_METHODS[index + direction];
}

function parsedSafe(): Record<CollectionMethod, number> {
  const buffers = collectionBuffersSignal.value;
  const parsed = {} as Record<CollectionMethod, number>;
  for (const method of COLLECTION_METHODS) {
    parsed[method] = parseNonNegativeAmount(buffers[method]) ?? 0;
  }
  return parsed;
}

/** Mismo criterio que Cobro: el primer campo con texto que no parsea es un error al confirmar. */
function parsedOrError(): Result<Record<CollectionMethod, number>> {
  const buffers = collectionBuffersSignal.value;
  const parsed = {} as Record<CollectionMethod, number>;
  for (const [index, method] of COLLECTION_METHODS.entries()) {
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

/** Total de la cobranza en vivo: lo válido de cada campo (sin vuelto, es lo que se acredita). */
export function collectionTotalPreview(): number {
  const parsed = parsedSafe();
  return roundAmount(COLLECTION_METHODS.reduce((sum, method) => sum + parsed[method], 0));
}

/** Saldo del cliente antes y después de la cobranza que se está tipeando. */
export function collectionBalancePreview(): { before: number | undefined; after: number } {
  const customer = attachedCustomerSignal.value;
  const before = customer !== undefined ? customerBalancesSignal.value.get(customer.id) : undefined;
  return { before, after: applyBalanceDelta(before, -collectionTotalPreview()) };
}

/** Esc: vuelve a la venta sin registrar nada, con el cliente todavía adjunto. */
export function cancelCollection(): void {
  resetCollection();
  activeScreenSignal.value = 'sale';
}

/**
 * Ctrl+Enter (spec de #101, §1): registra la cobranza con su recibo y sigue según "Al cobrar" de
 * `/IMPRESORA` (#174: imprime, muestra el comprobante o vuelve a la venta). Como
 * después de cobrar una venta, el cliente queda desadjuntado ("Consumidor Final").
 */
export async function submitCollection(): Promise<void> {
  const customer = attachedCustomerSignal.value;
  if (customer === undefined) {
    // Invariante: no se llega a esta pantalla sin cliente.
    cancelCollection();
    return;
  }
  const parsed = parsedOrError();
  if (!parsed.ok) {
    collectionErrorSignal.value = describeError(parsed);
    return;
  }
  const payments = resolveCollection(parsed.value);
  if (!payments.ok) {
    collectionErrorSignal.value = describeError(payments);
    return;
  }
  const result = await collectAndPersist({ customerId: customer.id, payments: payments.value });
  if (!result.ok) {
    collectionErrorSignal.value = describeError(result);
    return;
  }
  await refreshCustomerBalances();
  const record = result.value;
  resetAttachedCustomer();
  resetCollection();
  showOrPrintReceipt({
    kind: 'collection',
    payment: record.payment,
    customerName: customer.name,
    balances: { before: record.balanceBefore, after: record.balanceAfter },
    copy: false,
  });
}
