import { signal } from '@preact/signals';
import {
  addFreeformLine,
  addProductLine,
  discardCart,
  removeLine,
  setGlobalAdjustment,
  setLineQuantity,
  type Cart,
} from '../../../src/domain/cart.ts';
import type { Customer } from '../../../src/domain/customer.ts';
import type { Product } from '../../../src/domain/product.ts';
import type { Result } from '../../../src/domain/result.ts';
import { lineWarnings } from '../../../src/domain/sale-warnings.ts';
import {
  createCustomerLocally,
  loadCustomerRepository,
} from '../../../src/storage/customer-repository.ts';
import { describeError } from '../../../src/ui/errors.ts';
import { formatWarning } from '../../../src/ui/format-warning.ts';
import { cartSelectionIndexSignal, cartSignal } from '../../../src/ui/state/cart.ts';
import { getCatalogRepository } from '../../../src/ui/state/catalog.ts';
import {
  commandBarErrorSignal,
  commandBarWarningSignal,
} from '../../../src/ui/state/command-bar.ts';
import { attachedCustomerSignal, resetAttachedCustomer } from '../../../src/ui/state/customer.ts';
import { setCustomerRepository } from '../../../src/ui/state/customer-repository.ts';
import { stockSnapshotSignal } from '../../../src/ui/state/stock.ts';

/**
 * Las acciones de la venta en curso, sobre el mismo dominio (`domain/cart.ts`) y los mismos signals
 * que la barra de comandos de escritorio (`command-bar-controller.ts`, donde son internas): el
 * carrito persiste igual, Cobro lo lee igual y los avisos salen por los mismos slots (el aviso
 * flotante del mobile). El POS nunca se autobloquea: stock y bloqueos se advierten.
 */

/**
 * La cantidad elegida antes de tocar un producto (el `<n>*` de la barra de escritorio): la usa el
 * próximo producto y vuelve a 1. `null` = 1.
 */
export const pendingQuantitySignal = signal<number | null>(null);

function applyCart(result: Result<Cart>): result is { ok: true; value: Cart } {
  if (result.ok) {
    cartSignal.value = result.value;
    commandBarErrorSignal.value = null;
    return true;
  }
  commandBarErrorSignal.value = describeError(result);
  return false;
}

function productName(id: string): string {
  return getCatalogRepository().getProduct(id)?.name ?? id;
}

/** Las advertencias de la línea de ese producto, en el aviso flotante. Nunca bloquea. */
function warnAboutProduct(cart: Cart, productId: string): void {
  const line = cart.lines.find(
    (candidate) => candidate.kind === 'product' && candidate.productId === productId,
  );
  if (line === undefined) {
    return;
  }
  const warnings = lineWarnings(line, {
    product: getCatalogRepository().getProduct(productId),
    stockQuantity: stockSnapshotSignal.value.get(productId),
  });
  commandBarWarningSignal.value =
    warnings.length > 0 ? warnings.map((w) => formatWarning(w, productName)).join(' · ') : null;
}

/** Toque en un producto: suma la cantidad pendiente (o 1). */
export function addProduct(product: Product, qty?: number): void {
  const amount = qty ?? pendingQuantitySignal.value ?? 1;
  const result = addProductLine(cartSignal.value, { product, qty: amount });
  if (applyCart(result)) {
    pendingQuantitySignal.value = null;
    cartSelectionIndexSignal.value = null;
    warnAboutProduct(result.value, product.id);
  }
}

/** Un código leído con la cámara: el producto exacto por código de barras o SKU. */
export function addByCode(code: string): boolean {
  const product = getCatalogRepository().findByBarcodeOrSku(code.trim());
  if (product === undefined) {
    commandBarErrorSignal.value = `No se encontró ningún producto con "${code}".`;
    return false;
  }
  addProduct(product);
  return true;
}

/** La cantidad de una línea; 0 la borra. */
export function setLineQty(index: number, qty: number): void {
  const line = cartSignal.value.lines[index];
  const result = setLineQuantity(cartSignal.value, index, qty);
  if (applyCart(result) && line?.kind === 'product') {
    warnAboutProduct(result.value, line.productId);
  }
}

export function removeLineAt(index: number): void {
  applyCart(removeLine(cartSignal.value, index));
}

/** Línea libre: precio unitario positivo, la cantidad lleva el signo (como `descripción$monto`). */
export function addFreeform(description: string, unitPrice: number): void {
  const qty = pendingQuantitySignal.value ?? 1;
  const signedQty = unitPrice < 0 ? -Math.abs(qty) : qty;
  if (
    applyCart(
      addFreeformLine(cartSignal.value, {
        description,
        unitPrice: Math.abs(unitPrice),
        qty: signedQty,
      }),
    )
  ) {
    pendingQuantitySignal.value = null;
  }
}

/** Recargo (positivo) o descuento (negativo) sobre el total; 0 lo quita. */
export function setAdjustment(percentage: number): void {
  applyCart(setGlobalAdjustment(cartSignal.value, percentage));
}

/** `/DESCARTAR`: vacía la venta en curso (líneas, cliente y ajuste), sin confirmación. */
export function discardSale(): void {
  cartSignal.value = discardCart();
  cartSelectionIndexSignal.value = null;
  pendingQuantitySignal.value = null;
  resetAttachedCustomer();
}

export function attachCustomer(customer: Customer | undefined): void {
  if (customer === undefined) {
    resetAttachedCustomer();
    return;
  }
  attachedCustomerSignal.value = customer;
  if (customer.blocked !== undefined) {
    commandBarWarningSignal.value = `Cliente bloqueado — ${customer.blocked.reason}`;
  }
}

/** Alta de un cliente nuevo con su nombre (RF-16), y se adjunta a la venta. */
export async function createAndAttachCustomer(name: string): Promise<void> {
  const result = await createCustomerLocally(name);
  if (!result.ok) {
    commandBarErrorSignal.value = describeError(result);
    return;
  }
  setCustomerRepository(await loadCustomerRepository());
  attachedCustomerSignal.value = result.value;
}
