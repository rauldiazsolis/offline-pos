import type { Cart } from './cart.ts';
import type { Discount, SaleLine } from './sale.ts';

export type Totals = { subtotal: number; discountTotal: number; total: number };

function discountAmount(discount: Discount | undefined, lineSubtotal: number): number {
  if (discount === undefined) {
    return 0;
  }
  const amount =
    discount.type === 'amount' ? discount.value : lineSubtotal * (discount.value / 100);
  return Math.min(amount, lineSubtotal);
}

/** Total de una línea individual, ya con su descuento aplicado (si tiene). */
export function calculateLineTotal(line: SaleLine): number {
  const lineSubtotal = line.unitPrice * line.qty;
  return lineSubtotal - discountAmount(line.discount, lineSubtotal);
}

/**
 * Calcula los totales de un carrito. `price`/`unitPrice` se tratan como
 * precio final (impuesto incluido) — `taxRate` en `Product` queda como dato
 * de reporte/backend, no se resta ni se suma acá. Se revisa si hace falta un
 * desglose de impuestos el día que haya un requisito concreto que lo pida.
 */
export function calculateTotals(cart: Cart): Totals {
  let subtotal = 0;
  let discountTotal = 0;

  for (const line of cart.lines) {
    const lineSubtotal = line.unitPrice * line.qty;
    subtotal += lineSubtotal;
    discountTotal += discountAmount(line.discount, lineSubtotal);
  }

  return { subtotal, discountTotal, total: subtotal - discountTotal };
}
