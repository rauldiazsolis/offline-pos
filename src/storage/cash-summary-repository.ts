import type { CustomerPayment } from '../domain/customer-payment.ts';
import {
  buildDayEntries,
  calculateDaySummary,
  type DayEntry,
  type DaySummary,
} from '../domain/day-summary.ts';
import type { Sale } from '../domain/sale.ts';
import {
  collectionDateKey,
  localDateKey,
  localDayRange,
  saleDateKey,
  shiftDateKey,
} from '../domain/ticket-number.ts';
import { getCashBalance, type CashBalance } from './cash-repository.ts';
import { db } from './db.ts';
import { loadPaymentVoidOriginals, loadVoidedPaymentIds } from './customer-payment-repository.ts';
import { loadVoidedSaleIds, loadVoidOriginals } from './sale-repository.ts';

/** Lo que muestra `/RESUMEN` para un día calendario (spec de #100, §5). */
export type DayView = {
  /** El día, como clave local `'YYYY-MM-DD'`. */
  date: string;
  isToday: boolean;
  /** El día más viejo con datos locales (o hoy): límite de la navegación hacia atrás. */
  oldestDate: string;
  sales: Sale[];
  entries: DayEntry[];
  summary: DaySummary;
  /** Ventas anuladas (#99): con un ticket que las anula, o con el status legado. */
  voidedSaleIds: Set<string>;
  /** Para cada ticket de anulación, la venta que anula (si sigue en la base). */
  voidOriginals: Map<string, Sale>;
  /** Cobranzas anuladas (#125): con otra cobranza que las anula. */
  voidedPaymentIds: Set<string>;
  /** Para cada anulación de cobranza, la cobranza que anula (si sigue en la base). */
  paymentVoidOriginals: Map<string, CustomerPayment>;
  /** Cobranzas del día (#101), agrupadas por `receipt.date` si lo tienen. */
  collections: CustomerPayment[];
  /** Nombre de cada cliente de las cobranzas del día (el que siga en la base). */
  customerNames: Map<string, string>;
  /** Saldo de efectivo actual, solo si el día es hoy. */
  balance?: CashBalance;
};

async function oldestDataAt(): Promise<string | undefined> {
  const firsts = await Promise.all([
    db.sales.orderBy('createdAt').first(),
    db.cashMovements.orderBy('createdAt').first(),
    db.cashCounts.orderBy('createdAt').first(),
    db.customerPayments.orderBy('createdAt').first(),
  ]);
  return firsts
    .flatMap((item) => (item !== undefined ? [item.createdAt] : []))
    .sort()
    .at(0);
}

/**
 * Las ventas, los movimientos de caja, los arqueos y las cobranzas de un día local. Las ventas se
 * agrupan por `ticket.date` y las cobranzas por `receipt.date` si lo tienen (uno numerado antes de
 * la medianoche puede tener `createdAt` del día siguiente si el reloj se corrigió); por eso se leen
 * con un día más a cada lado.
 */
export async function getDaySummary(date: string, now: string): Promise<DayView> {
  const today = localDateKey(now);
  const day = localDayRange(date);
  const wideFrom = localDayRange(shiftDateKey(date, -1)).from;
  const wideTo = localDayRange(shiftDateKey(date, 1)).to;
  const [candidates, movements, counts, collectionCandidates, oldest] = await Promise.all([
    db.sales.where('createdAt').between(wideFrom, wideTo, true, false).toArray(),
    db.cashMovements.where('createdAt').between(day.from, day.to, true, false).toArray(),
    db.cashCounts.where('createdAt').between(day.from, day.to, true, false).toArray(),
    db.customerPayments.where('createdAt').between(wideFrom, wideTo, true, false).toArray(),
    oldestDataAt(),
  ]);
  const sales = candidates.filter((sale) => saleDateKey(sale) === date);
  const collections = collectionCandidates.filter((payment) => collectionDateKey(payment) === date);
  const customers = await db.customers.bulkGet([
    ...new Set(collections.map((payment) => payment.customerId)),
  ]);
  const customerNames = new Map(
    customers.flatMap((customer) => (customer !== undefined ? [[customer.id, customer.name]] : [])),
  );
  const voidedSaleIds = await loadVoidedSaleIds(sales.map((sale) => sale.id));
  for (const sale of sales) {
    if (sale.status === 'voided') {
      voidedSaleIds.add(sale.id);
    }
  }
  const voidedPaymentIds = await loadVoidedPaymentIds(collections.map((payment) => payment.id));
  const oldestKey = oldest !== undefined ? localDateKey(oldest) : today;
  const view: DayView = {
    date,
    isToday: date === today,
    oldestDate: oldestKey < today ? oldestKey : today,
    sales,
    entries: buildDayEntries({ sales, movements, counts, collections }),
    summary: calculateDaySummary({
      sales,
      movements,
      voidedSaleIds,
      voidedPaymentIds,
      collections,
    }),
    voidedSaleIds,
    voidOriginals: await loadVoidOriginals(sales),
    voidedPaymentIds,
    paymentVoidOriginals: await loadPaymentVoidOriginals(collections),
    collections,
    customerNames,
  };
  return date === today ? { ...view, balance: await getCashBalance() } : view;
}
