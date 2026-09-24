import type { Cart } from './cart.ts';
import type { Discount, SaleLine } from './sale.ts';
import { roundAmount } from './rounding.ts';

export type Totals = {
  subtotal: number;
  discountTotal: number;
  /** Monto ya con signo (recargo positivo, descuento negativo) — RF-03, ver `Cart.globalAdjustmentPercentage`. */
  globalAdjustmentAmount: number;
  total: number;
};

function discountAmount(discount: Discount | undefined, lineSubtotal: number): number {
  if (discount === undefined) {
    return 0;
  }
  // Sobre el valor absoluto, con el signo de la línea: una línea negativa con descuento devuelve menos.
  const magnitude = Math.abs(lineSubtotal);
  const amount = discount.type === 'amount' ? discount.value : magnitude * (discount.value / 100);
  return Math.sign(lineSubtotal) * Math.min(amount, magnitude);
}

/** Total de una línea individual, ya con su descuento aplicado (si tiene), a 2 decimales. */
export function calculateLineTotal(line: SaleLine): number {
  const lineSubtotal = line.unitPrice * line.qty;
  return roundAmount(lineSubtotal - discountAmount(line.discount, lineSubtotal));
}

/**
 * Calcula los totales de un carrito. `price`/`unitPrice` se tratan como
 * precio final (impuesto incluido) — `taxRate` en `Product` queda como dato
 * de reporte/backend, no se resta ni se suma acá. Se revisa si hace falta un
 * desglose de impuestos el día que haya un requisito concreto que lo pida.
 *
 * Cada campo sale redondeado a 2 decimales (#99) y el total se calcula a
 * partir de los otros ya redondeados: la tarjeta de totales siempre suma bien
 * a la vista. `discountTotal` lleva el signo de las líneas (negativo para una
 * línea negativa con descuento).
 */
export function calculateTotals(cart: Cart): Totals {
  let subtotal = 0;
  let discountTotal = 0;

  for (const line of cart.lines) {
    const lineSubtotal = line.unitPrice * line.qty;
    subtotal += lineSubtotal;
    discountTotal += discountAmount(line.discount, lineSubtotal);
  }

  const roundedSubtotal = roundAmount(subtotal);
  const roundedDiscount = roundAmount(discountTotal);
  const net = roundedSubtotal - roundedDiscount;
  const globalAdjustmentAmount =
    cart.globalAdjustmentPercentage !== undefined
      ? roundAmount(net * (cart.globalAdjustmentPercentage / 100))
      : 0;

  return {
    subtotal: roundedSubtotal,
    discountTotal: roundedDiscount,
    globalAdjustmentAmount,
    total: roundAmount(net + globalAdjustmentAmount),
  };
}
