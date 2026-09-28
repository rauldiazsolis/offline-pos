import { calculateDaySummary, type DaySummary } from '../domain/day-summary.ts';
import type { Sale } from '../domain/sale.ts';
import { localDateKey, localDayRange } from '../domain/ticket-number.ts';
import { db } from './db.ts';
import { loadVoidedSaleIds, loadVoidOriginals } from './sale-repository.ts';

export type CashSummaryContext = {
  sales: Sale[];
  summary: DaySummary;
  /** Ventas anuladas (#99): con un ticket que las anula, o con el status legado. */
  voidedSaleIds: Set<string>;
  /** Para cada ticket de anulación, la venta que anula (si sigue en la base). */
  voidOriginals: Map<string, Sale>;
};

/** Compone los datos para `/RESUMEN`: las ventas del día de hoy (sin turnos desde la Etapa 5). */
export async function getCashSummaryContext(now: string): Promise<CashSummaryContext> {
  const { from, to } = localDayRange(localDateKey(now));
  const sales = await db.sales.where('createdAt').between(from, to, true, false).toArray();
  const voidedSaleIds = await loadVoidedSaleIds(sales.map((sale) => sale.id));
  for (const sale of sales) {
    if (sale.status === 'voided') {
      voidedSaleIds.add(sale.id);
    }
  }
  return {
    sales,
    summary: calculateDaySummary({ sales, movements: [], voidedSaleIds }),
    voidedSaleIds,
    voidOriginals: await loadVoidOriginals(sales),
  };
}
