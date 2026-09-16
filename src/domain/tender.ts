import { err, ok, type Result } from './result.ts';
import type { Payment, PaymentMethod } from './sale.ts';

/** Monto tipeado por el cajero para cada medio, en el cobro en curso. 0 = no usado. */
export type TenderedAmounts = Record<PaymentMethod, number>;

const NON_CASH_METHODS: readonly Exclude<PaymentMethod, 'cash'>[] = [
  'debit',
  'credit',
  'transfer',
  'qr',
  'account',
];

/**
 * Resuelve los `Payment[]` a persistir a partir de lo tipeado por medio y el
 * total de la venta (issue #55, sesión de brainstorming 2026-09-16). Solo
 * Efectivo puede tipearse por encima de lo que falta cubrir (el excedente es
 * vuelto); el resto de los medios nunca puede superar el total, o es un
 * error de validación. El `Payment.amount` devuelto es siempre el neto
 * aplicado — nunca incluye el vuelto (a diferencia del bug #48 original, que
 * guardaba el monto tendido tal cual).
 */
export function resolveTender(
  tendered: TenderedAmounts,
  total: number,
): Result<{ payments: Payment[]; change: number }> {
  const nonCashTotal = NON_CASH_METHODS.reduce((sum, method) => sum + tendered[method], 0);
  if (nonCashTotal > total) {
    return err('sale/non-cash-exceeds-total', { nonCashTotal, total });
  }

  const paid = nonCashTotal + tendered.cash;
  if (paid < total) {
    return err('sale/insufficient-payment', { total, paid });
  }

  const netCash = total - nonCashTotal;
  const change = paid - total;

  const payments: Payment[] = [];
  for (const method of NON_CASH_METHODS) {
    if (tendered[method] > 0) {
      payments.push({ method, amount: tendered[method] });
    }
  }
  if (netCash > 0) {
    payments.push({ method: 'cash', amount: netCash });
  }

  return ok({ payments, change });
}
