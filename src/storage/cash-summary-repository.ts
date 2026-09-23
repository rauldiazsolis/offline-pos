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

export type CashSummaryContext = {
  session: CashSession;
  summary: CashSessionSummary;
  sales: Sale[];
  isClosed: boolean;
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
  return {
    session,
    summary: calculateCashSessionSummary(session, sales),
    sales,
    isClosed: session.closedAt !== undefined,
  };
}
