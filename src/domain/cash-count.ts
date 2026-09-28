import { buildCountAdjustment, type CashMovement } from './cash-movement.ts';
import type { CustomerPayment } from './customer-payment.ts';
import { err, ok, type Result } from './result.ts';
import { roundAmount } from './rounding.ts';
import type { Sale } from './sale.ts';

/**
 * Arqueo de caja (epic #94, Etapa 5 — #100). Se guarda siempre, tenga o no diferencia: es la base
 * del saldo de efectivo. Solo la diferencia viaja, como un `CashMovement` con
 * `source: 'count-adjustment'` (`adjustmentId`).
 */
export type CashCount = {
  id: string; // ULID
  expected: number;
  counted: number;
  createdAt: string; // ISO 8601
  /** El ajuste (`CashMovement` con `source: 'count-adjustment'`), si hubo diferencia. */
  adjustmentId?: string;
};

/** Pasadas 24 h sin arqueo, la barra de estado lo avisa (spec de #100, §6). */
export const CASH_COUNT_OVERDUE_MS = 24 * 60 * 60 * 1000;

/**
 * Saldo de efectivo (spec de #100, §1): lo contado en el último arqueo, más los pagos en efectivo
 * de las ventas posteriores (con su signo: anulaciones y devoluciones restan solas), más los
 * ingresos menos los egresos manuales posteriores, más el efectivo de las cobranzas posteriores
 * (#101). Los ajustes por arqueo nunca suman: el `counted`
 * de su arqueo ya los incluye. Sin arqueo, base 0 desde el inicio de la terminal. "Posterior" es
 * estricto (`createdAt > lastCount.createdAt`); los ISO de la app son todos UTC con `Z`, así que se
 * comparan como texto.
 */
export function calculateCashBalance(params: {
  lastCount: Pick<CashCount, 'counted' | 'createdAt'> | undefined;
  sales: readonly Pick<Sale, 'createdAt' | 'payments'>[];
  movements: readonly Pick<CashMovement, 'createdAt' | 'direction' | 'amount' | 'source'>[];
  collections: readonly Pick<CustomerPayment, 'createdAt' | 'payments'>[];
}): number {
  const since = params.lastCount?.createdAt;
  const isAfter = (iso: string): boolean => since === undefined || iso > since;
  let balance = params.lastCount?.counted ?? 0;
  for (const sale of params.sales) {
    if (!isAfter(sale.createdAt)) continue;
    for (const payment of sale.payments) {
      if (payment.method === 'cash') balance += payment.amount;
    }
  }
  for (const collection of params.collections) {
    if (!isAfter(collection.createdAt)) continue;
    for (const payment of collection.payments) {
      if (payment.method === 'cash') balance += payment.amount;
    }
  }
  for (const movement of params.movements) {
    if (movement.source !== 'manual' || !isAfter(movement.createdAt)) continue;
    balance += movement.direction === 'in' ? movement.amount : -movement.amount;
  }
  return roundAmount(balance);
}

/** Un arqueo y, si lo contado difiere de lo esperado, su ajuste. */
export function buildCashCount(params: {
  id: string;
  adjustmentId: string;
  expected: number;
  counted: number;
  now: string;
}): Result<{ count: CashCount; adjustment?: CashMovement }> {
  if (!Number.isFinite(params.counted) || params.counted < 0) {
    return err('cash/invalid-amount', { amount: params.counted });
  }
  const expected = roundAmount(params.expected);
  const counted = roundAmount(params.counted);
  const adjustment = buildCountAdjustment({
    id: params.adjustmentId,
    expected,
    counted,
    now: params.now,
  });
  const count: CashCount = {
    id: params.id,
    expected,
    counted,
    createdAt: params.now,
    ...(adjustment !== undefined ? { adjustmentId: adjustment.id } : {}),
  };
  return ok(adjustment !== undefined ? { count, adjustment } : { count });
}

export function isCashCountOverdue(lastCountAt: string | undefined, now: string): boolean {
  return (
    lastCountAt === undefined || Date.parse(now) - Date.parse(lastCountAt) > CASH_COUNT_OVERDUE_MS
  );
}
