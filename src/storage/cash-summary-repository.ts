import {
  calculateCashSessionSummary,
  type CashSession,
  type CashSessionSummary,
} from '../domain/cash-session.ts';
import type { Sale } from '../domain/sale.ts';
import {
  getCurrentOpenCashSession,
  getMostRecentClosedCashSession,
} from './cash-session-repository.ts';
import { db } from './db.ts';
import { loadVoidedSaleIds, loadVoidOriginals } from './sale-repository.ts';

export type CashSummaryContext = {
  session: CashSession;
  summary: CashSessionSummary;
  sales: Sale[];
  isClosed: boolean;
  /** Ventas del turno anuladas (#99): con un ticket que las anula, o con el status legado. */
  voidedSaleIds: Set<string>;
  /** Para cada ticket de anulación del turno, la venta que anula (si sigue en la base). */
  voidOriginals: Map<string, Sale>;
};

/**
 * Compone los datos para `/RESUMEN` — a diferencia de `cash-session-repository.ts` (enfocado en el
 * ciclo de vida abrir/cerrar), esto arma la vista de consulta: el turno abierto si hay uno, si no
 * el cerrado más reciente (gate caso 3), o `undefined` si nunca hubo ningún turno (gate caso 1).
 */
export async function getCashSummaryContext(): Promise<CashSummaryContext | undefined> {
  const open = await getCurrentOpenCashSession();
  const session = open ?? (await getMostRecentClosedCashSession());
  if (session === undefined) {
    return undefined;
  }
  const sales = (await db.sales.bulkGet(session.sales)).filter(
    (sale): sale is Sale => sale !== undefined,
  );
  const voidedSaleIds = await loadVoidedSaleIds(session.sales);
  for (const sale of sales) {
    if (sale.status === 'voided') {
      voidedSaleIds.add(sale.id);
    }
  }
  return {
    session,
    summary: calculateCashSessionSummary(session, sales),
    sales,
    isClosed: session.closedAt !== undefined,
    voidedSaleIds,
    voidOriginals: await loadVoidOriginals(sales),
  };
}
