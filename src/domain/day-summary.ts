import type { CashCount } from './cash-count.ts';
import type { CashMovement } from './cash-movement.ts';
import type { CustomerPayment } from './customer-payment.ts';
import { roundAmount } from './rounding.ts';
import { isVoided } from './sale-lifecycle.ts';
import type { PaymentMethod, Sale } from './sale.ts';

/**
 * Números del panel lateral de `/RESUMEN` para un día (spec de #100, §5). Una cobranza (#101) no
 * es una venta: no suma al total vendido, a los tickets, a `totalsByMethod` ni a otros pagos; tiene
 * sus propios totales (`collections`, `collectionsByMethod`) y su fila en el efectivo del día.
 */
export type DaySummary = {
  /** Neto de `Sale.total`: una anulación resta por su signo. */
  totalSold: number;
  /** Todos los tickets del día, anulaciones incluidas. */
  ticketCount: number;
  /** Tickets del día que tienen una anulación (o el `status: 'voided'` legado). */
  voidedCount: number;
  adjustmentTotal: number;
  /** Solo ventas. */
  totalsByMethod: Record<PaymentMethod, number>;
  otherPayments: number;
  /**
   * Efectivo del día: cobros netos, ingresos y egresos manuales, ajustes por arqueo con signo y el
   * efectivo de las cobranzas.
   */
  cash: {
    sales: number;
    income: number;
    expense: number;
    countAdjustments: number;
    collections: number;
  };
  collections: { total: number; count: number };
  collectionsByMethod: Record<PaymentMethod, number>;
};

/** Una fila de la pestaña Movimientos: una venta, un movimiento de caja, un arqueo o una cobranza. */
export type DayEntry =
  | { kind: 'sale'; at: string; sale: Sale }
  | { kind: 'movement'; at: string; movement: CashMovement }
  | { kind: 'count'; at: string; count: CashCount }
  | { kind: 'collection'; at: string; payment: CustomerPayment };

function emptyByMethod(): Record<PaymentMethod, number> {
  return { cash: 0, debit: 0, credit: 0, transfer: 0, qr: 0, account: 0 };
}

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
  collections: readonly CustomerPayment[];
}): DaySummary {
  const totalsByMethod = emptyByMethod();
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
  const collectionsByMethod = emptyByMethod();
  let collectionsTotal = 0;
  for (const collection of params.collections) {
    collectionsTotal += collection.total;
    for (const payment of collection.payments) {
      collectionsByMethod[payment.method] += payment.amount;
    }
  }
  for (const method of Object.keys(collectionsByMethod) as PaymentMethod[]) {
    collectionsByMethod[method] = roundAmount(collectionsByMethod[method]);
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
      collections: collectionsByMethod.cash,
    },
    collections: { total: roundAmount(collectionsTotal), count: params.collections.length },
    collectionsByMethod,
  };
}

/** La pestaña Movimientos: ventas, movimientos de caja, arqueos y cobranzas del día, por hora. */
export function buildDayEntries(params: {
  sales: readonly Sale[];
  movements: readonly CashMovement[];
  counts: readonly CashCount[];
  collections: readonly CustomerPayment[];
}): DayEntry[] {
  return [
    ...params.sales.map((sale): DayEntry => ({ kind: 'sale', at: sale.createdAt, sale })),
    ...params.movements.map((movement): DayEntry => ({
      kind: 'movement',
      at: movement.createdAt,
      movement,
    })),
    ...params.counts.map((count): DayEntry => ({ kind: 'count', at: count.createdAt, count })),
    ...params.collections.map((payment): DayEntry => ({
      kind: 'collection',
      at: payment.createdAt,
      payment,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}
