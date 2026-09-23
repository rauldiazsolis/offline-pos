import type { Product } from './product.ts';
import { err, ok, type Result } from './result.ts';
import type { Discount, SaleLine } from './sale.ts';
import type { StockItem } from './stock.ts';

/**
 * Carrito en curso. Vive solo en signals de UI mientras se arma — nunca se
 * persiste como tal. `globalAdjustmentPercentage` (recargo si es positivo,
 * descuento si es negativo, `<signo><número>%` en la barra de comandos)
 * completa RF-03 — se recalcula en vivo sobre el total actual en cada
 * `calculateTotals`, nunca es un monto congelado al momento de aplicarlo.
 */
export type Cart = { lines: SaleLine[]; globalAdjustmentPercentage?: number };

function findProductLineIndex(cart: Cart, productId: string): number {
  return cart.lines.findIndex((line) => line.kind === 'product' && line.productId === productId);
}

/**
 * Agrega (o resta, con `qty` negativo — ver regla 4 de la barra de comandos)
 * una cantidad de un producto al carrito. Si el producto trackea stock,
 * valida que la cantidad final no supere el stock disponible.
 */
export function addProductLine(
  cart: Cart,
  params: { product: Product; stock: StockItem | undefined; qty: number },
): Result<Cart> {
  const { product, stock, qty } = params;

  if (!Number.isInteger(qty) || qty === 0) {
    return err('cart/invalid-quantity', { quantity: qty });
  }

  const existingIndex = findProductLineIndex(cart, product.id);
  const existingQty = existingIndex === -1 ? 0 : (cart.lines[existingIndex]?.qty ?? 0);
  const nextQty = existingQty + qty;

  if (qty < 0 && existingIndex === -1) {
    return err('cart/nothing-to-subtract', { productId: product.id });
  }
  if (nextQty < 0) {
    return err('cart/invalid-quantity', { quantity: nextQty });
  }

  const available = stock?.quantity ?? 0;
  if (product.tracksStock && nextQty > available) {
    return err('sale/insufficient-stock', {
      productId: product.id,
      requested: nextQty,
      available,
    });
  }

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
 * fusionar dos líneas libres, a diferencia de un producto por su `id`. Por
 * eso `qty` tiene que ser positivo acá — ajustar la cantidad de una línea
 * libre ya existente es una operación distinta, ver `adjustFreeformLineQuantity`.
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
  if (!Number.isInteger(qty) || qty <= 0) {
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
 */
export function adjustFreeformLineQuantity(
  cart: Cart,
  params: { description: string; qty: number },
): Result<Cart> {
  const { description, qty } = params;

  if (!Number.isInteger(qty) || qty === 0) {
    return err('cart/invalid-quantity', { quantity: qty });
  }

  const existingIndex = findFreeformLineIndex(cart, description);
  if (existingIndex === -1) {
    return err('cart/freeform-line-not-found', { description });
  }

  const existing = cart.lines[existingIndex];
  const nextQty = (existing?.qty ?? 0) + qty;
  if (nextQty < 0) {
    return err('cart/invalid-quantity', { quantity: nextQty });
  }

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
 * línea seleccionada). Si la línea es de producto y el producto trackea
 * stock, valida contra el stock disponible.
 */
export function setLineQuantity(
  cart: Cart,
  lineIndex: number,
  qty: number,
  params?: { product?: Product; stock?: StockItem },
): Result<Cart> {
  const line = cart.lines[lineIndex];
  if (line === undefined) {
    return err('cart/line-not-found', { lineIndex });
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    return err('cart/invalid-quantity', { quantity: qty });
  }

  const product = params?.product;
  if (line.kind === 'product' && product?.tracksStock) {
    const available = params?.stock?.quantity ?? 0;
    if (qty > available) {
      return err('sale/insufficient-stock', {
        productId: line.productId,
        requested: qty,
        available,
      });
    }
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
  if (discount.type === 'amount' && discount.value > line.unitPrice * line.qty) {
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
