import { err, ok, type Result } from '../domain/result.ts';
import { clearSyncCursors } from '../sync/cursor.ts';
import { db } from './db.ts';
import { seedCatalogIfEmpty } from './seed-catalog.ts';
import { seedCustomersIfEmpty } from './seed-customers.ts';

/**
 * `/DEMO_RESET` (Ciclo 8, retoma el issue #36): vuelve la terminal a un
 * estado local limpio para reiniciar una demo — borra catálogo, stock,
 * clientes, cuentas corrientes, ventas, movimientos de stock/cuenta, turnos
 * de caja, la venta en curso y el outbox pendiente, y vuelve a sembrar
 * catálogo y clientes desde el fixture local (mismas funciones que usa
 * `bootstrap.ts`) para que la terminal quede operable de inmediato, sin
 * depender de una reconexión al backend. Los cursores de pull también se
 * limpian (`sync/cursor.ts::clearSyncCursors`) — si no, el próximo pull solo
 * traería deltas desde el cursor viejo y nunca repondría lo que se acaba de
 * borrar localmente.
 *
 * A propósito NO toca la configuración de `/CONFIG` (URL del backend, API
 * key, locale) — decisión explícita del usuario: es la conexión de esta
 * terminal, no un dato de demo, y perderla obligaría a reconfigurar el
 * backend en cada reset.
 */
export async function demoReset(): Promise<Result<void>> {
  try {
    await db.transaction(
      'rw',
      [
        db.products,
        db.stock,
        db.sales,
        db.stockMovements,
        db.outbox,
        db.customers,
        db.customerAccounts,
        db.accountMovements,
        db.draftCart,
        db.cashSessions,
      ],
      async () => {
        await Promise.all([
          db.products.clear(),
          db.stock.clear(),
          db.sales.clear(),
          db.stockMovements.clear(),
          db.outbox.clear(),
          db.customers.clear(),
          db.customerAccounts.clear(),
          db.accountMovements.clear(),
          db.draftCart.clear(),
          db.cashSessions.clear(),
        ]);
      },
    );
  } catch (error) {
    return err('demo/reset-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  clearSyncCursors();

  const now = new Date().toISOString();

  const catalogSeed = await seedCatalogIfEmpty({ now });
  if (!catalogSeed.ok) {
    return catalogSeed;
  }

  // No fatal, mismo criterio que bootstrap.ts: son datos de ejemplo, no algo
  // de lo que dependa poder vender.
  const customerSeed = await seedCustomersIfEmpty({ now });
  if (!customerSeed.ok) {
    console.error('No se pudieron re-sembrar los clientes de ejemplo:', customerSeed.error);
  }

  return ok(undefined);
}
