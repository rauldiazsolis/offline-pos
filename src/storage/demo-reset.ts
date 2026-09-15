import { err, ok, type Result } from '../domain/result.ts';
import { loadSyncConfig } from '../sync/config.ts';
import { clearSyncCursors } from '../sync/cursor.ts';
import { resetDemoBackend } from '../sync/demo-backend-reset.ts';
import { runSyncCycle } from '../sync/engine.ts';
import { db } from './db.ts';

/**
 * `/DEMO_RESET` (Ciclo 8, retomado en Fase 7 — issue #36): vuelve la
 * terminal a un estado limpio para reiniciar una demo. Desde que los datos
 * de demo viven en el minibackend (no en un fixture local, ver
 * `docs/superpowers/specs/2026-09-15-fase-7-minibackend-demo-design.md`),
 * el orden importa:
 *
 * 1. Si hay `/CONFIG` configurado, primero `POST /_demo/reset` contra el
 *    backend — si falla (backend no disponible), se corta acá, sin tocar
 *    nada local: dejar la terminal vacía sin poder repoblarla sería peor
 *    que no resetear nada.
 * 2. Borra todo lo local (catálogo, stock, clientes, cuentas, ventas,
 *    movimientos, turnos de caja, la venta en curso y el outbox pendiente).
 * 3. Limpia los cursores de pull (si no, el resync del paso 4 solo traería
 *    deltas desde el cursor viejo).
 * 4. Si había `/CONFIG`, dispara un resync completo (`runSyncCycle`) para
 *    repoblar desde el backend ya reseteado — reusa el motor de sync
 *    existente en vez de duplicar su lógica de pull.
 *
 * Sin `/CONFIG`, se saltan los pasos 1 y 4: la terminal queda vacía (mismo
 * criterio que `bootstrap.ts`, que tampoco siembra nada localmente).
 *
 * A propósito NO toca la configuración de `/CONFIG` (URL, API key, locale)
 * — es la conexión de esta terminal, no un dato de demo.
 */
export async function demoReset(): Promise<Result<void>> {
  const configResult = loadSyncConfig();

  if (configResult.ok) {
    const backendReset = await resetDemoBackend(configResult.value.baseUrl);
    if (!backendReset.ok) {
      return backendReset;
    }
  }

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

  if (configResult.ok) {
    await runSyncCycle();
  }

  return ok(undefined);
}
