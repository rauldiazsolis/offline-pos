import { err, ok, type Result } from './result.ts';
import { roundAmount } from './rounding.ts';
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

const TENDER_METHODS: readonly PaymentMethod[] = ['cash', ...NON_CASH_METHODS];

/**
 * Cómo trabaja el cobro según el signo del total (#99): `charge` cobra (con
 * vuelto en efectivo), `refund` devuelve (un ticket negativo: montos
 * tipeados en positivo, pagos negativos, suma exacta) y `zero` no mueve
 * plata.
 */
export type TenderMode = 'charge' | 'refund' | 'zero';

export function tenderMode(total: number): TenderMode {
  return total > 0 ? 'charge' : total < 0 ? 'refund' : 'zero';
}

/**
 * Resuelve los `Payment[]` a persistir a partir de lo tipeado por medio y el
 * total de la venta (issue #55, sesión de brainstorming 2026-09-16). Solo
 * Efectivo puede tipearse por encima de lo que falta cubrir (el excedente es
 * vuelto); el resto de los medios nunca puede superar el total, o es un
 * error de validación. El `Payment.amount` devuelto es siempre el neto
 * aplicado — nunca incluye el vuelto (a diferencia del bug #48 original, que
 * guardaba el monto tendido tal cual).
 *
 * Con total negativo o 0 (#99, ver `tenderMode`) el cajero tipea en positivo
 * cuánto devuelve por medio y nada puede exceder: la suma tiene que ser
 * exactamente |total| (`sale/refund-amount-mismatch`), sin vuelto.
 */
export function resolveTender(
  tendered: TenderedAmounts,
  total: number,
): Result<{ payments: Payment[]; change: number }> {
  if (tenderMode(total) !== 'charge') {
    return resolveRefund(tendered, total);
  }

  const nonCashTotal = roundAmount(
    NON_CASH_METHODS.reduce((sum, method) => sum + tendered[method], 0),
  );
  if (nonCashTotal > total) {
    return err('sale/non-cash-exceeds-total', { nonCashTotal, total });
  }

  const paid = roundAmount(nonCashTotal + tendered.cash);
  if (paid < total) {
    return err('sale/insufficient-payment', { total, paid });
  }

  const netCash = roundAmount(total - nonCashTotal);
  const change = roundAmount(paid - total);

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

function resolveRefund(
  tendered: TenderedAmounts,
  total: number,
): Result<{ payments: Payment[]; change: number }> {
  const tenderedTotal = roundAmount(TENDER_METHODS.reduce((sum, m) => sum + tendered[m], 0));
  if (tenderedTotal !== roundAmount(Math.abs(total))) {
    return err('sale/refund-amount-mismatch', { total, tendered: tenderedTotal });
  }
  const payments: Payment[] = [];
  for (const method of NON_CASH_METHODS) {
    if (tendered[method] > 0) {
      payments.push({ method, amount: -tendered[method] });
    }
  }
  if (tendered.cash > 0) {
    payments.push({ method: 'cash', amount: -tendered.cash });
  }
  return ok({ payments, change: 0 });
}
