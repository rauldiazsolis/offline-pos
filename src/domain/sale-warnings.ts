import type { Cart } from './cart.ts';
import type { Customer } from './customer.ts';
import type { Product } from './product.ts';
import type { SaleLine } from './sale.ts';

/**
 * Advertir en vez de bloquear (epic #94, Etapa 4 — #99, cierra #12): el POS
 * nunca se autobloquea. La falta de stock y los bloqueos que declara el
 * backend se muestran donde el cajero decide (búsqueda, carrito, cliente,
 * cobro, slot de la barra); nada impide vender.
 */
export type SaleWarning =
  | { kind: 'insufficient-stock'; productId: string; requested: number; available: number }
  | { kind: 'blocked-product'; productId: string; reason: string }
  | { kind: 'blocked-customer'; customerId: string; reason: string };

/**
 * Advertencias de una línea. Stock insuficiente solo para productos con
 * `tracksStock`, cantidad positiva y mayor que el stock (sin fila de stock
 * cuenta como 0); una línea negativa (devolución) nunca advierte. Una línea
 * libre no tiene producto: nunca advierte.
 */
export function lineWarnings(
  line: SaleLine,
  context: { product: Product | undefined; stockQuantity: number | undefined },
): SaleWarning[] {
  const { product, stockQuantity } = context;
  if (line.kind !== 'product' || product === undefined) {
    return [];
  }
  const warnings: SaleWarning[] = [];
  const available = stockQuantity ?? 0;
  if (product.tracksStock && line.qty > 0 && line.qty > available) {
    warnings.push({
      kind: 'insufficient-stock',
      productId: product.id,
      requested: line.qty,
      available,
    });
  }
  if (product.blocked !== undefined) {
    warnings.push({
      kind: 'blocked-product',
      productId: product.id,
      reason: product.blocked.reason,
    });
  }
  return warnings;
}

export function customerWarnings(customer: Customer | undefined): SaleWarning[] {
  if (customer?.blocked === undefined) {
    return [];
  }
  return [{ kind: 'blocked-customer', customerId: customer.id, reason: customer.blocked.reason }];
}

/** Todas las advertencias de la venta en curso: en el orden del carrito y el cliente al final. */
export function cartWarnings(
  cart: Cart,
  context: {
    productById: (id: string) => Product | undefined;
    stockOf: (id: string) => number | undefined;
    customer: Customer | undefined;
  },
): SaleWarning[] {
  return [
    ...cart.lines.flatMap((line) =>
      line.kind === 'product'
        ? lineWarnings(line, {
            product: context.productById(line.productId),
            stockQuantity: context.stockOf(line.productId),
          })
        : [],
    ),
    ...customerWarnings(context.customer),
  ];
}
