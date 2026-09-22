import { splitConnectorCustomers } from '../domain/customer.ts';
import { err, ok, type Result } from '../domain/result.ts';
import type { ProbeSnapshot } from '../sync/pull-snapshot.ts';
import { db } from './db.ts';

/** Las tablas del catálogo que una foto completa reconcilia. */
export type SnapshotTable = 'products' | 'stock' | 'customers';

/**
 * Aplica una foto **completa** del sistema externo como fuente de verdad (foto completa del
 * motor de sync): actualiza lo que llegó y **borra lo local que ya no vino** — sin esto, un
 * producto o cliente dado de baja en el origen sobreviviría para siempre (los pulls solo hacen
 * `bulkPut`, y un delta nunca informa las bajas). Todo en una sola transacción: si algo falla, no
 * cambió nada.
 *
 * Salvaguardas:
 * - Un cliente creado en esta terminal cuyo alta sigue pendiente en el outbox **se conserva**: el
 *   origen todavía no lo conoce.
 * - Si una tabla llega **vacía** y habría algo que borrar, no se borra nada de esa tabla y se la
 *   devuelve en `skipped` (un error del backend no debe vaciar el catálogo); el resto se reconcilia.
 *
 * Nunca toca ventas, turnos, movimientos de stock o de cuenta, el outbox ni la venta en curso.
 */
export async function reconcileSnapshot(
  snapshot: ProbeSnapshot,
  params: { now: string },
): Promise<Result<{ skipped: SnapshotTable[] }>> {
  const { customers, accounts } = splitConnectorCustomers(snapshot.customers, { now: params.now });
  const skipped: SnapshotTable[] = [];

  /** Claves locales que la foto no trae; vacío con algo por borrar = tabla omitida. */
  function absentKeys(
    table: SnapshotTable,
    localKeys: string[],
    incomingKeys: string[],
    protectedKeys: Set<string> = new Set(),
  ): string[] {
    const incoming = new Set(incomingKeys);
    const absent = localKeys.filter((key) => !incoming.has(key) && !protectedKeys.has(key));
    if (incomingKeys.length === 0 && absent.length > 0) {
      skipped.push(table);
      return [];
    }
    return absent;
  }

  try {
    await db.transaction(
      'rw',
      [db.products, db.stock, db.customers, db.customerAccounts, db.outbox],
      async () => {
        await db.products.bulkPut(snapshot.products);
        await db.products.bulkDelete(
          absentKeys(
            'products',
            await db.products.toCollection().primaryKeys(),
            snapshot.products.map((item) => item.id),
          ),
        );

        await db.stock.bulkPut(snapshot.stock);
        await db.stock.bulkDelete(
          absentKeys(
            'stock',
            await db.stock.toCollection().primaryKeys(),
            snapshot.stock.map((item) => item.productId),
          ),
        );

        const pendingCustomerIds = new Set(
          (await db.outbox.where('status').equals('pending').toArray()).flatMap((event) =>
            event.type === 'customer' ? [event.customer.id] : [],
          ),
        );
        await db.customers.bulkPut(customers);
        await db.customers.bulkDelete(
          absentKeys(
            'customers',
            await db.customers.toCollection().primaryKeys(),
            customers.map((item) => item.id),
            pendingCustomerIds,
          ),
        );

        // Las cuentas siguen a los clientes y al origen: la que ya no se informa (o cuyo cliente se
        // fue) se borra. Si los clientes se omitieron (llegaron vacíos), las cuentas también.
        if (!skipped.includes('customers')) {
          await db.customerAccounts.bulkPut(accounts);
          const keepAccounts = new Set(accounts.map((account) => account.customerId));
          const localAccounts = await db.customerAccounts.toCollection().primaryKeys();
          await db.customerAccounts.bulkDelete(
            localAccounts.filter((customerId) => !keepAccounts.has(customerId)),
          );
        }
      },
    );
  } catch (error) {
    return err('sync/reconcile-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return ok({ skipped });
}
