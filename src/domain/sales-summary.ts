import type { Sale } from './sale.ts';

export type ProductQuantity = { productId: string; qty: number };

/**
 * Cantidad total vendida de cada producto del catálogo, sobre ventas cerradas de las `Sale[]`
 * pasadas — pura, sin ordenar ni redondear (eso es responsabilidad de la UI). Solo agrupa líneas
 * `kind: 'product'`: una línea libre no tiene identidad de producto contra la que fusionar (mismo
 * criterio que `domain/cart.ts::addFreeformLine`).
 */
export function calculateProductQuantities(sales: Sale[]): ProductQuantity[] {
  const closedSales = sales.filter((sale) => sale.status === 'closed');
  const qtyByProduct = new Map<string, number>();
  for (const sale of closedSales) {
    for (const line of sale.lines) {
      if (line.kind !== 'product') continue;
      qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.qty);
    }
  }
  return [...qtyByProduct].map(([productId, qty]) => ({ productId, qty }));
}
