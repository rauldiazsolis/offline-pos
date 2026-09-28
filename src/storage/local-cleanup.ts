import {
  CLEANUP_RETENTION_MS,
  planLocalCleanup,
  type CleanupCounts,
} from '../domain/local-cleanup.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { db } from './db.ts';

export type CleanupReport = { counts: CleanupCounts; anchorAt?: string };

/**
 * Borra lo sincronizado con más de 7 días (spec de #98, §4) en una sola
 * transacción; la regla es `domain/local-cleanup.ts::planLocalCleanup`. Lee
 * por los índices `createdAt` que ya existen, así solo trae candidatos.
 */
export async function runLocalCleanup(params: {
  now: string;
  protectedEventIds: ReadonlySet<string>;
}): Promise<Result<CleanupReport>> {
  const cutoff = new Date(new Date(params.now).getTime() - CLEANUP_RETENTION_MS).toISOString();
  try {
    return ok(
      await db.transaction(
        'rw',
        [
          db.sales,
          db.stockMovements,
          db.accountMovements,
          db.outbox,
          db.cashMovements,
          db.cashCounts,
          db.customerPayments,
        ],
        async () => {
          const [
            pendingEvents,
            sales,
            stockMovements,
            accountMovements,
            oldEvents,
            cashMovements,
            cashCounts,
            customerPayments,
            lastCount,
          ] = await Promise.all([
            db.outbox.where('status').equals('pending').toArray(),
            db.sales.where('createdAt').below(cutoff).toArray(),
            db.stockMovements.where('createdAt').below(cutoff).toArray(),
            db.accountMovements.where('createdAt').below(cutoff).toArray(),
            db.outbox.where('createdAt').below(cutoff).toArray(),
            db.cashMovements.where('createdAt').below(cutoff).toArray(),
            db.cashCounts.where('createdAt').below(cutoff).toArray(),
            db.customerPayments.where('createdAt').below(cutoff).toArray(),
            db.cashCounts.orderBy('createdAt').last(),
          ]);
          const plan = planLocalCleanup({
            now: params.now,
            pendingEvents,
            protectedEventIds: params.protectedEventIds,
            sales,
            stockMovements,
            accountMovements,
            syncedEvents: oldEvents.filter((event) => event.status === 'synced'),
            cashMovements,
            cashCounts,
            customerPayments,
            lastCount,
          });
          await db.sales.bulkDelete(plan.sales);
          await db.stockMovements.bulkDelete(plan.stockMovements);
          await db.accountMovements.bulkDelete(plan.accountMovements);
          await db.outbox.bulkDelete(plan.outbox);
          await db.cashMovements.bulkDelete(plan.cashMovements);
          await db.cashCounts.bulkDelete(plan.cashCounts);
          await db.customerPayments.bulkDelete(plan.customerPayments);
          return {
            counts: {
              sales: plan.sales.length,
              stockMovements: plan.stockMovements.length,
              accountMovements: plan.accountMovements.length,
              outbox: plan.outbox.length,
              cashMovements: plan.cashMovements.length,
              cashCounts: plan.cashCounts.length,
              customerPayments: plan.customerPayments.length,
            },
            ...(plan.anchorAt !== undefined ? { anchorAt: plan.anchorAt } : {}),
          };
        },
      ),
    );
  } catch (error) {
    return err('storage/cleanup-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
