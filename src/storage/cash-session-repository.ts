import {
  calculateCashSessionSummary,
  closeCashSession,
  openCashSession,
  type CashSession,
  type CashSessionSummary,
} from '../domain/cash-session.ts';
import { buildOutboxEventForCashSession } from '../domain/outbox.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { db } from './db.ts';
import { newId } from './ids.ts';

/**
 * Nunca va a haber más que un puñado de turnos guardados (uno por turno de
 * caja, no por venta) — un `toArray()` + `find()` alcanza, sin necesidad de
 * un índice Dexie dedicado a "abierto/cerrado" (ver comentario en `db.ts`).
 */
export async function getCurrentOpenCashSession(): Promise<CashSession | undefined> {
  const sessions = await db.cashSessions.toArray();
  return sessions.find((session) => session.closedAt === undefined);
}

/** El turno cerrado más reciente, si hay alguno — mismo criterio de "toArray() alcanza" que getCurrentOpenCashSession. */
export async function getMostRecentClosedCashSession(): Promise<CashSession | undefined> {
  const sessions = await db.cashSessions.toArray();
  const closed = sessions.filter((session) => session.closedAt !== undefined);
  closed.sort((a, b) => (b.closedAt as string).localeCompare(a.closedAt as string));
  return closed[0];
}

/** Resuelve las `Sale[]` reales de `session.sales` y calcula el resumen (pura, `domain/cash-session.ts`). */
async function summarize(session: CashSession): Promise<CashSessionSummary> {
  const sales = await db.sales.bulkGet(session.sales);
  return calculateCashSessionSummary(
    session,
    sales.filter((sale) => sale !== undefined),
  );
}

/**
 * El resumen "en vivo" del turno abierto — reusado por la pantalla de
 * `/CAJA` mientras el turno sigue abierto (antes de decidir cerrarlo) y por
 * `closeCashSessionAndPersist` (mismo cálculo, distinto momento).
 */
export async function getOpenCashSessionSummary(): Promise<
  { session: CashSession; summary: CashSessionSummary } | undefined
> {
  const session = await getCurrentOpenCashSession();
  if (session === undefined) {
    return undefined;
  }
  return { session, summary: await summarize(session) };
}

/**
 * Abre un turno nuevo. Sin evento de outbox — un turno abierto no se
 * sincroniza, mismo criterio que una `Sale` con `status: 'open'` (ver
 * `domain/cash-session.ts`).
 */
export async function openCashSessionAndPersist(params: {
  openingAmount: number;
}): Promise<Result<CashSession>> {
  const existing = await getCurrentOpenCashSession();
  if (existing !== undefined) {
    return err('cash-session/already-open', undefined);
  }

  const now = new Date().toISOString();
  const result = openCashSession({ id: newId(), openingAmount: params.openingAmount, now });
  if (!result.ok) {
    return result;
  }

  try {
    await db.cashSessions.add(result.value);
  } catch (error) {
    return err('cash-session/persist-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return ok(result.value);
}

/**
 * Cierra el turno abierto: calcula el resumen (arqueo) contra las `Sale[]`
 * reales del turno y encola el evento de outbox recién al cerrar, en la
 * misma transacción que persiste la sesión cerrada.
 */
export async function closeCashSessionAndPersist(params: {
  closingAmount: number;
}): Promise<Result<{ session: CashSession; summary: CashSessionSummary }>> {
  const openSession = await getCurrentOpenCashSession();
  if (openSession === undefined) {
    return err('cash-session/none-open', undefined);
  }

  const now = new Date().toISOString();
  const closeResult = closeCashSession(openSession, { closingAmount: params.closingAmount, now });
  if (!closeResult.ok) {
    return closeResult;
  }
  const closed = closeResult.value;
  const summary = await summarize(closed);

  try {
    await db.transaction('rw', db.cashSessions, db.outbox, async () => {
      await db.cashSessions.put(closed);
      await db.outbox.add(buildOutboxEventForCashSession(closed, { now }));
    });
  } catch (error) {
    return err('cash-session/persist-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return ok({ session: closed, summary });
}
