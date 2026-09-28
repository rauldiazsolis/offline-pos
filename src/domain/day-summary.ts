import type { CashCount } from './cash-count.ts';
import type { CashMovement } from './cash-movement.ts';
import { roundAmount } from './rounding.ts';
import { isVoided } from './sale-lifecycle.ts';
import type { PaymentMethod, Sale } from './sale.ts';

/** Números del panel lateral de `/RESUMEN` para un día (spec de #100, §5). */
export type DaySummary = {
  /** Neto de `Sale.total`: una anulación resta por su signo. */
  totalSold: number;
  /** Todos los tickets del día, anulaciones incluidas. */
  ticketCount: number;
  /** Tickets del día que tienen una anulación (o el `status: 'voided'` legado). */
  voidedCount: number;
  adjustmentTotal: number;
  totalsByMethod: Record<PaymentMethod, number>;
  otherPayments: number;
  /** Efectivo del día: cobros netos, ingresos y egresos manuales, y ajustes por arqueo con signo. */
  cash: { sales: number; income: number; expense: number; countAdjustments: number };
};

/** Una fila de la pestaña Movimientos: una venta, un movimiento de caja o un arqueo. */
export type DayEntry =
  | { kind: 'sale'; at: string; sale: Sale }
  | { kind: 'movement'; at: string; movement: CashMovement }
  | { kind: 'count'; at: string; count: CashCount };

function rawLinesSubtotal(lines: Sale['lines']): number {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
}

/**
 * Pura. Una venta legada con `status: 'voided'` (anterior a la Etapa 4) no suma a ningún total,
 * igual que antes; desde la Etapa 4 la anulación es otro ticket y resta por su signo.
 */
export function calculateDaySummary(params: {
  sales: readonly Sale[];
  movements: readonly CashMovement[];
  voidedSaleIds: ReadonlySet<string>;
}): DaySummary {
  const totalsByMethod: Record<PaymentMethod, number> = {
    cash: 0,
    debit: 0,
    credit: 0,
    transfer: 0,
    qr: 0,
    account: 0,
  };
  let totalSold = 0;
  let adjustmentTotal = 0;
  for (const sale of params.sales) {
    if (sale.status !== 'closed') continue;
    totalSold += sale.total;
    adjustmentTotal += sale.total - rawLinesSubtotal(sale.lines);
    for (const payment of sale.payments) {
      totalsByMethod[payment.method] += payment.amount;
    }
  }
  let income = 0;
  let expense = 0;
  let countAdjustments = 0;
  for (const movement of params.movements) {
    if (movement.source === 'count-adjustment') {
      countAdjustments += movement.direction === 'in' ? movement.amount : -movement.amount;
    } else if (movement.direction === 'in') {
      income += movement.amount;
    } else {
      expense += movement.amount;
    }
  }
  const otherPayments =
    totalsByMethod.debit +
    totalsByMethod.credit +
    totalsByMethod.transfer +
    totalsByMethod.qr +
    totalsByMethod.account;
  return {
    totalSold: roundAmount(totalSold),
    ticketCount: params.sales.length,
    voidedCount: params.sales.filter((sale) => isVoided(sale, params.voidedSaleIds)).length,
    adjustmentTotal: roundAmount(adjustmentTotal),
    totalsByMethod,
    otherPayments: roundAmount(otherPayments),
    cash: {
      sales: roundAmount(totalsByMethod.cash),
      income: roundAmount(income),
      expense: roundAmount(expense),
      countAdjustments: roundAmount(countAdjustments),
    },
  };
}

/** La pestaña Movimientos: ventas, movimientos de caja y arqueos del día, por hora. */
export function buildDayEntries(params: {
  sales: readonly Sale[];
  movements: readonly CashMovement[];
  counts: readonly CashCount[];
}): DayEntry[] {
  return [
    ...params.sales.map((sale): DayEntry => ({ kind: 'sale', at: sale.createdAt, sale })),
    ...params.movements.map(
      (movement): DayEntry => ({ kind: 'movement', at: movement.createdAt, movement }),
    ),
    ...params.counts.map((count): DayEntry => ({ kind: 'count', at: count.createdAt, count })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}
