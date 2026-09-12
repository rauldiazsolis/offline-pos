import type { Product } from './product.ts';
import { err, ok, type Result } from './result.ts';
import type { Discount, SaleLine } from './sale.ts';
import type { StockItem } from './stock.ts';

/** Carrito en curso. Vive solo en signals de UI mientras se arma — nunca se persiste como tal. */
export type Cart = { lines: SaleLine[] };

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

  return ok({ lines });
}

/**
 * Agrega una línea libre (`descripción$monto` en la barra de comandos).
 * Siempre qty 1 y siempre una línea nueva: no hay identidad de producto
 * contra la que fusionar dos líneas libres con la misma descripción.
 */
export function addFreeformLine(
  cart: Cart,
  params: { description: string; unitPrice: number },
): Result<Cart> {
  const { description, unitPrice } = params;

  if (description.trim() === '') {
    return err('cart/invalid-freeform-line', { field: 'description' });
  }
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return err('cart/invalid-freeform-line', { field: 'unitPrice' });
  }

  return ok({
    lines: [...cart.lines, { kind: 'freeform', description, qty: 1, unitPrice }],
  });
}

/** Quita una línea del carrito por índice (ej. tecla Supr sobre la línea seleccionada). */
export function removeLine(cart: Cart, lineIndex: number): Result<Cart> {
  if (lineIndex < 0 || lineIndex >= cart.lines.length) {
    return err('cart/line-not-found', { lineIndex });
  }
  const lines = [...cart.lines];
  lines.splice(lineIndex, 1);
  return ok({ lines });
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
  return ok({ lines });
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
  return ok({ lines });
}
