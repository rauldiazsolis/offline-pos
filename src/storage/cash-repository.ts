import { buildCashCount, calculateCashBalance, type CashCount } from '../domain/cash-count.ts';
import { buildManualCashMovement, type CashMovement } from '../domain/cash-movement.ts';
import { conceptKey, rankConcepts, recordConceptUse } from '../domain/concept-ranking.ts';
import { buildOutboxEventForCashMovement } from '../domain/outbox.ts';
import { err, ok, type Result } from '../domain/result.ts';
import type { Sale } from '../domain/sale.ts';
import { currentEventOrigin } from '../sync/terminal-identity.ts';
import { db } from './db.ts';
import { FlexSearchConceptSearch } from './flexsearch-concept-search.ts';
import { newId } from './ids.ts';

/** Saldo de efectivo actual y fecha del último arqueo (`/CAJA`, `/RESUMEN`, barra de estado). */
export type CashBalance = { balance: number; lastCountAt?: string };

function persistFailed(error: unknown): Result<never> {
  return err('cash/persist-failed', {
    message: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Lo que entra en el saldo: el último arqueo y lo creado después. Se llama dentro de una
 * transacción que incluye `cashCounts`, `sales` y `cashMovements`, así el saldo que se calcula es
 * el de ese momento.
 */
async function readBalanceInputs(): Promise<{
  lastCount: CashCount | undefined;
  sales: Sale[];
  movements: CashMovement[];
}> {
  const lastCount = await db.cashCounts.orderBy('createdAt').last();
  const since = lastCount?.createdAt;
  const [sales, movements] = await Promise.all([
    since === undefined ? db.sales.toArray() : db.sales.where('createdAt').above(since).toArray(),
    since === undefined
      ? db.cashMovements.toArray()
      : db.cashMovements.where('createdAt').above(since).toArray(),
  ]);
  return { lastCount, sales, movements };
}

export async function getCashBalance(): Promise<CashBalance> {
  return db.transaction('r', [db.cashCounts, db.sales, db.cashMovements], async () => {
    const inputs = await readBalanceInputs();
    const balance = calculateCashBalance(inputs);
    return inputs.lastCount !== undefined
      ? { balance, lastCountAt: inputs.lastCount.createdAt }
      : { balance };
  });
}

/**
 * Registra un arqueo (spec de #100, §1). En **una** transacción: calcula el esperado en ese
 * momento — el que vale es este, no el que vio la pantalla —, guarda el arqueo y, si hubo
 * diferencia, su ajuste con su evento `cash-movement` en el outbox. Un arqueo sin diferencia no
 * viaja, pero queda como base del saldo.
 */
export async function recordCashCount(
  counted: number,
): Promise<Result<{ count: CashCount; adjustment?: CashMovement }>> {
  const now = new Date().toISOString();
  const origin = currentEventOrigin();
  try {
    return await db.transaction(
      'rw',
      [db.cashCounts, db.sales, db.cashMovements, db.outbox],
      async () => {
        const expected = calculateCashBalance(await readBalanceInputs());
        const built = buildCashCount({
          id: newId(),
          adjustmentId: newId(),
          expected,
          counted,
          now,
        });
        if (!built.ok) {
          return built;
        }
        await db.cashCounts.add(built.value.count);
        const { adjustment } = built.value;
        if (adjustment !== undefined) {
          await db.cashMovements.add(adjustment);
          await db.outbox.add(buildOutboxEventForCashMovement(adjustment, { now, origin }));
        }
        return built;
      },
    );
  } catch (error) {
    return persistFailed(error);
  }
}

/**
 * Registra un ingreso o egreso manual: el movimiento, su evento y la estadística del concepto, en
 * una transacción. El concepto se compara sin mayúsculas ni espacios de más, y la fila conserva la
 * grafía de la primera vez.
 */
export async function recordCashMovement(input: {
  direction: 'in' | 'out';
  amount: number;
  concept: string;
  description?: string;
}): Promise<Result<CashMovement>> {
  const now = new Date().toISOString();
  const origin = currentEventOrigin();
  const built = buildManualCashMovement({ ...input, id: newId(), now });
  if (!built.ok) {
    return built;
  }
  const movement = built.value;
  try {
    await db.transaction('rw', [db.cashMovements, db.outbox, db.cashConcepts], async () => {
      await db.cashMovements.add(movement);
      await db.outbox.add(buildOutboxEventForCashMovement(movement, { now, origin }));
      const rows = await db.cashConcepts.where('direction').equals(movement.direction).toArray();
      const existing = rows.find((row) => conceptKey(row.concept) === conceptKey(movement.concept));
      await db.cashConcepts.put(
        recordConceptUse(existing, { direction: movement.direction, concept: movement.concept, now }),
      );
    });
  } catch (error) {
    return persistFailed(error);
  }
  return ok(movement);
}

/**
 * Conceptos sugeridos para un ingreso o egreso: sin texto, los más relevantes; con texto, los que
 * coinciden (búsqueda difusa), ordenados por el mismo puntaje de uso y recencia.
 */
export async function listConceptSuggestions(
  direction: 'in' | 'out',
  query: string,
  now: string,
): Promise<string[]> {
  const rows = await db.cashConcepts.where('direction').equals(direction).toArray();
  if (query.trim() === '') {
    return rankConcepts(rows, now).map((row) => row.concept);
  }
  const keys = new Set(new FlexSearchConceptSearch(rows).search(query));
  return rankConcepts(
    rows.filter((row) => keys.has(conceptKey(row.concept))),
    now,
  ).map((row) => row.concept);
}
