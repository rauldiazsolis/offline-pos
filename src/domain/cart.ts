import type { Product } from './product.ts';
import { err, ok, type Result } from './result.ts';
import type { Discount, SaleLine } from './sale.ts';
import { hasAtMostThreeDecimals, roundQuantity } from './rounding.ts';

/**
 * Carrito en curso. Vive solo en signals de UI mientras se arma — nunca se
 * persiste como tal. `globalAdjustmentPercentage` (recargo si es positivo,
 * descuento si es negativo, `<signo><número>%` en la barra de comandos)
 * completa RF-03 — se recalcula en vivo sobre el total actual en cada
 * `calculateTotals`, nunca es un monto congelado al momento de aplicarlo.
 */
export type Cart = { lines: SaleLine[]; globalAdjustmentPercentage?: number };

/** Cantidad tipeada válida (#99): con signo, hasta 3 decimales, distinta de 0. */
function isValidQuantity(qty: number): boolean {
  return hasAtMostThreeDecimals(qty) && qty !== 0;
}

function findProductLineIndex(cart: Cart, productId: string): number {
  return cart.lines.findIndex((line) => line.kind === 'product' && line.productId === productId);
}

/**
 * Suma neta de una cantidad de un producto al carrito (una sola línea por
 * producto). Desde #99 puede crear o dejar la línea en negativo (`-2*coca`
 * sin línea previa es una devolución); 0 exacto la borra. Nunca bloquea por
 * stock: la advertencia se calcula aparte (`domain/sale-warnings.ts`).
 */
export function addProductLine(
  cart: Cart,
  params: { product: Product; qty: number },
): Result<Cart> {
  const { product, qty } = params;

  if (!isValidQuantity(qty)) {
    return err('cart/invalid-quantity', { quantity: qty });
  }

  const existingIndex = findProductLineIndex(cart, product.id);
  const existingQty = existingIndex === -1 ? 0 : (cart.lines[existingIndex]?.qty ?? 0);
  const nextQty = roundQuantity(existingQty + qty);

  const lines = [...cart.lines];
  if (nextQty === 0 && existingIndex !== -1) {
    lines.splice(existingIndex, 1);
  } else if (existingIndex !== -1) {
    const existing = lines[existingIndex];
    if (existing) {
      lines[existingIndex] = { ...existing, qty: nextQty };
    }
  } else {
    lines.push({ kind: 'product', productId: product.id, qty: nextQty, unitPrice: product.price });
  }

  return ok({ ...cart, lines });
}

/**
 * Agrega una línea libre (`descripción$monto` en la barra de comandos, con
 * `qty` desde un prefijo de cantidad delante — `3*regalo$100` = 3 × $100).
 * Siempre una línea nueva, nunca fusiona con una línea libre existente que
 * tenga la misma descripción: no hay identidad de producto contra la que
 * fusionar dos líneas libres, a diferencia de un producto por su `id` —
 * ajustar la cantidad de una línea libre ya existente es una operación
 * distinta, ver `adjustFreeformLineQuantity`. Desde #99 `qty` puede ser
 * negativa (`-1*regalo$100`, una devolución); el precio sigue siendo
 * positivo: el signo lo lleva la cantidad.
 */
export function addFreeformLine(
  cart: Cart,
  params: { description: string; unitPrice: number; qty: number },
): Result<Cart> {
  const { description, unitPrice, qty } = params;

  if (description.trim() === '') {
    return err('cart/invalid-freeform-line', { field: 'description' });
  }
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return err('cart/invalid-freeform-line', { field: 'unitPrice' });
  }
  if (!isValidQuantity(qty)) {
    return err('cart/invalid-freeform-line', { field: 'qty' });
  }

  return ok({
    ...cart,
    lines: [...cart.lines, { kind: 'freeform', description, qty, unitPrice }],
  });
}

function findFreeformLineIndex(cart: Cart, description: string): number {
  return cart.lines.findIndex(
    (line) => line.kind === 'freeform' && line.description === description,
  );
}

/**
 * Ajusta la cantidad de una línea libre ya existente en el carrito,
 * identificada por coincidencia exacta de descripción — misma mecánica que
 * `addProductLine` usa `productId` como identidad, pero sin generalizar las
 * dos funciones: producto y línea libre son identidades distintas (mismo
 * criterio que `CustomerSearch`/`CatalogSearch`: dos búsquedas separadas a
 * propósito, aunque ambas usen FlexSearch por debajo). Se llega acá desde la
 * barra de comandos cuando `<n>*descripción`/`-<n>*descripción` (sin `$`)
 * matchea una línea libre ya tipeada en este ticket, en vez de crear una
 * línea nueva (eso solo pasa con `descripción$monto`, ver `addFreeformLine`).
 * Igual que `addProductLine`, puede dejar la línea en negativo (#99); 0
 * exacto la borra.
 */
export function adjustFreeformLineQuantity(
  cart: Cart,
  params: { description: string; qty: number },
): Result<Cart> {
  const { description, qty } = params;

  if (!isValidQuantity(qty)) {
    return err('cart/invalid-quantity', { quantity: qty });
  }

  const existingIndex = findFreeformLineIndex(cart, description);
  if (existingIndex === -1) {
    return err('cart/freeform-line-not-found', { description });
  }

  const existing = cart.lines[existingIndex];
  const nextQty = roundQuantity((existing?.qty ?? 0) + qty);

  const lines = [...cart.lines];
  if (nextQty === 0) {
    lines.splice(existingIndex, 1);
  } else if (existing !== undefined) {
    lines[existingIndex] = { ...existing, qty: nextQty };
  }
  return ok({ ...cart, lines });
}

/** Quita una línea del carrito por índice (ej. tecla Supr sobre la línea seleccionada). */
export function removeLine(cart: Cart, lineIndex: number): Result<Cart> {
  if (lineIndex < 0 || lineIndex >= cart.lines.length) {
    return err('cart/line-not-found', { lineIndex });
  }
  const lines = [...cart.lines];
  lines.splice(lineIndex, 1);
  return ok({ ...cart, lines });
}

/**
 * Reemplaza la cantidad de una línea ya existente (número + Enter sobre la
 * línea seleccionada). Desde #99 acepta decimales y negativos, y 0 borra la
 * línea (igual que Supr). Nunca bloquea por stock.
 */
export function setLineQuantity(cart: Cart, lineIndex: number, qty: number): Result<Cart> {
  const line = cart.lines[lineIndex];
  if (line === undefined) {
    return err('cart/line-not-found', { lineIndex });
  }
  if (!hasAtMostThreeDecimals(qty)) {
    return err('cart/invalid-quantity', { quantity: qty });
  }
  if (qty === 0) {
    return removeLine(cart, lineIndex);
  }

  const lines = [...cart.lines];
  lines[lineIndex] = { ...line, qty };
  return ok({ ...cart, lines });
}

/** Aplica (o reemplaza) el descuento de una línea. */
export function applyLineDiscount(cart: Cart, lineIndex: number, discount: Discount): Result<Cart> {
  const line = cart.lines[lineIndex];
  if (line === undefined) {
    return err('cart/line-not-found', { lineIndex });
  }
  if (!Number.isFinite(discount.value) || discount.value < 0) {
    return err('cart/invalid-discount', { discount });
  }
  if (discount.type === 'percentage' && discount.value > 100) {
    return err('cart/invalid-discount', { discount });
  }
  if (discount.type === 'amount' && discount.value > Math.abs(line.unitPrice * line.qty)) {
    return err('cart/invalid-discount', { discount });
  }

  const lines = [...cart.lines];
  lines[lineIndex] = { ...line, discount };
  return ok({ ...cart, lines });
}

/**
 * Vacía la venta en curso por completo: líneas y ajuste global (`/DESCARTAR`,
 * Ciclo 8) — a propósito distinto de `/ANULAR`, que anula una venta ya
 * cerrada (con implicancias de auditoría, RF-06). Acá no hay nada que
 * anular: el carrito ni siquiera se guardó todavía. Nunca falla (no hay
 * ninguna validación que la rechace), así que no devuelve `Result` como el
 * resto de las mutaciones de `Cart`. El cliente adjunto vive en un signal
 * aparte (`ui/state/customer.ts`), no en `Cart` — el caller lo resetea por
 * su cuenta.
 */
export function discardCart(): Cart {
  return { lines: [] };
}

/**
 * Aplica (o reemplaza) el recargo/descuento global de la venta (RF-03,
 * `<signo><número>%` en la barra de comandos). `percentage === 0` quita el
 * campo (nunca lo deja en `0` explícito) — es la forma de cancelar un
 * ajuste ya aplicado.
 */
export function setGlobalAdjustment(cart: Cart, percentage: number): Result<Cart> {
  if (!Number.isFinite(percentage) || percentage < -100) {
    return err('cart/invalid-global-adjustment', { percentage });
  }
  if (percentage === 0) {
    const { globalAdjustmentPercentage: _ignored, ...rest } = cart;
    return ok(rest);
  }
  return ok({ ...cart, globalAdjustmentPercentage: percentage });
}
