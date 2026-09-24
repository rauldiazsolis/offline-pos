import { splitConnectorCustomers } from '../domain/customer.ts';
import { isLegacyOutboxType, type OutboxEvent } from '../domain/outbox.ts';
import { reapplyEffects } from '../domain/reapply.ts';
import { err, ok, type Result } from '../domain/result.ts';
import type { PullBatchResult } from '../sync/connector.ts';
import { adjustPull } from '../sync/pull-adjust.ts';
import { db } from './db.ts';
import { applySnapshotReconciled, type SnapshotTable } from './reconcile.ts';

export type PullApplyInput = {
  full: boolean;
  result: PullBatchResult;
  /** Algún lote `processing` (o equivalente): stock y saldo quedan los locales. */
  retain: boolean;
  /** Eventos de lotes `queued` (ya `synced`) a reaplicar además de los pendientes. */
  queuedEventIds: readonly string[];
  now: string;
};

export type PullApplyReport = { skipped: SnapshotTable[]; reappliedEvents: number };

/** Pendientes del outbox ∪ eventos de lotes en cola, deduplicados; nunca un tipo que el contrato ya no tiene. */
async function eventsToReapply(queuedEventIds: readonly string[]): Promise<OutboxEvent[]> {
  const pending = await db.outbox.where('status').equals('pending').toArray();
  const queued = (await db.outbox.bulkGet([...queuedEventIds])).filter(
    (event): event is OutboxEvent => event !== undefined,
  );
  const byId = new Map<string, OutboxEvent>();
  for (const event of [...queued, ...pending]) {
    if (!isLegacyOutboxType(event.type)) {
      byId.set(event.id, event);
    }
  }
  return [...byId.values()];
}

/**
 * Aplica un pull (spec de #98, §1) en **una** transacción: datos maestros y
 * bloqueos siempre; stock y saldo del backend más los eventos que el backend
 * todavía no refleja, o los locales si hay que retener. El outbox se lee
 * adentro, así una venta cerrada mientras el pull estaba en vuelo entra en la
 * reaplicación. Delta: `bulkPut`. Foto completa: `applySnapshotReconciled`
 * (bajas incluidas). Cursores y repositorios en memoria son del motor.
 */
export async function applyPull(input: PullApplyInput): Promise<Result<PullApplyReport>> {
  try {
    return ok(
      await db.transaction(
        'rw',
        [db.products, db.stock, db.customers, db.customerAccounts, db.outbox],
        async () => {
          const events = input.retain ? [] : await eventsToReapply(input.queuedEventIds);
          const localAccounts = input.retain ? await db.customerAccounts.toArray() : [];
          const adjusted = adjustPull({
            customers: input.result.customers.items,
            stock: input.result.stock,
            retain: input.retain,
            effects: reapplyEffects(events),
            localStock: input.retain ? await db.stock.toArray() : [],
            localBalances: new Map(
              localAccounts.map((account) => [account.customerId, account.balance]),
            ),
            now: input.now,
          });

          if (input.full) {
            const { skipped } = await applySnapshotReconciled(
              {
                products: input.result.products.items,
                stock: adjusted.stock,
                customers: adjusted.customers,
                cursors: {},
              },
              { now: input.now },
            );
            return { skipped, reappliedEvents: events.length };
          }

          if (input.result.products.items.length > 0) {
            await db.products.bulkPut(input.result.products.items);
          }
          if (adjusted.stock.length > 0) {
            await db.stock.bulkPut(adjusted.stock);
          }
          if (adjusted.customers.length > 0) {
            const { customers, accounts } = splitConnectorCustomers(adjusted.customers, {
              now: input.now,
            });
            await db.customers.bulkPut(customers);
            if (accounts.length > 0) {
              await db.customerAccounts.bulkPut(accounts);
            }
          }
          return { skipped: [], reappliedEvents: events.length };
        },
      ),
    );
  } catch (error) {
    return err('sync/reconcile-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
