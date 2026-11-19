import type { CashCount } from '../domain/cash-count.ts';
import { err, ok, type Result } from '../domain/result.ts';
import type { CashSnapshot } from '../sync/snapshot-schema.ts';
import { db } from './db.ts';
import { newId } from './ids.ts';

export type HydrationResult =
  | {
      kind: 'hydrated';
      sales: number;
      customerPayments: number;
      cashMovements: number;
      /** Si se creó el arqueo local del ancla (`cashAnchor`). */
      cashCount: boolean;
    }
  /** Ya había documentos locales: no se toca nada, para no duplicar. */
  | { kind: 'skipped'; reason: 'local-documents' };

/**
 * Un instante de la foto con offset (`-03:00`) a ISO UTC: los índices `createdAt` y el saldo de
 * efectivo comparan como texto, y la app guarda todo con `Z`.
 */
function utc(iso: string): string {
  return new Date(iso).toISOString();
}

/** El primero de cada id: una foto que repite un id no pisa nada. */
function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

/**
 * Hidrata la base local con la foto de la caja (`GET /snapshot`, 4.7.0, #230) en **una**
 * transacción: las ventas, las cobranzas y los movimientos de caja tal cual, y con `cashAnchor` un
 * arqueo local en `countedAt` con lo contado = `amount` y sin ajuste (el ajuste, si hubo, ya viene
 * en `cashMovements`). **Nada entra al outbox**: ya están en el backend y nunca tienen que viajar.
 * Por eso tampoco se reaplican en el pull (la reaplicación sale del outbox), ni tocan stock ni
 * saldos (el pull ya los trae con esto aplicado). Una venta o cobranza sin evento se limpia a los 7
 * días como cualquier sincronizada (`domain/local-cleanup.ts`: un evento ausente cuenta como
 * enviado), y aparecen en `/ANULAR` y `/RESUMEN` como las propias.
 *
 * Solo si lo local de documentos está vacío (ventas, cobranzas, movimientos y arqueos: una
 * terminal recién borrada o nueva); si no, no hidrata nada, para no duplicar. Los contadores de
 * ticket y recibo los sube aparte `sync/cash-snapshot.ts` (viven en `localStorage`).
 */
export async function hydrateSnapshot(snapshot: CashSnapshot): Promise<Result<HydrationResult>> {
  try {
    return await db.transaction(
      'rw',
      [db.sales, db.customerPayments, db.cashMovements, db.cashCounts],
      async (): Promise<Result<HydrationResult>> => {
        const counts = await Promise.all([
          db.sales.count(),
          db.customerPayments.count(),
          db.cashMovements.count(),
          db.cashCounts.count(),
        ]);
        if (counts.some((count) => count > 0)) {
          return ok({ kind: 'skipped', reason: 'local-documents' });
        }
        const sales = uniqueById(snapshot.recentSales).map((sale) => ({
          ...sale,
          createdAt: utc(sale.createdAt),
        }));
        const customerPayments = uniqueById(snapshot.recentCustomerPayments).map((payment) => ({
          ...payment,
          createdAt: utc(payment.createdAt),
        }));
        const cashMovements = uniqueById(snapshot.cashMovements).map((movement) => ({
          ...movement,
          createdAt: utc(movement.createdAt),
        }));
        await db.sales.bulkAdd(sales);
        await db.customerPayments.bulkAdd(customerPayments);
        await db.cashMovements.bulkAdd(cashMovements);
        const anchor = snapshot.cashAnchor;
        if (anchor !== undefined) {
          const count: CashCount = {
            id: newId(),
            expected: anchor.amount,
            counted: anchor.amount,
            createdAt: utc(anchor.countedAt),
          };
          await db.cashCounts.add(count);
        }
        return ok({
          kind: 'hydrated',
          sales: sales.length,
          customerPayments: customerPayments.length,
          cashMovements: cashMovements.length,
          cashCount: anchor !== undefined,
        });
      },
    );
  } catch (error) {
    return err('storage/hydrate-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
