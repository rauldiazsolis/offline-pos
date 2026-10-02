import { waitForIdleWriteTransactions } from '../storage/transaction-tracker.ts';
import { acquireSyncLockWaiting } from '../sync/engine.ts';
import { setSyncPaused } from './state/sync.ts';

/**
 * Lo que hace la pestaña que manda antes de soltar el control (#175), sin cortar nada a medias y
 * con un tope: pausa el sync (no arranca ningún ciclo nuevo), espera el cerrojo de sync (así termina
 * el push o pull en vuelo, aplicar una conexión o `pos.reset()`) y se queda con él, y espera a que no
 * quede ninguna escritura de IndexedDB abierta (un cobro que se está guardando). El cerrojo de sync
 * nunca se suelta: después de esto la pestaña se recarga.
 */
export async function prepareTabRelease(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  setSyncPaused(true);
  await acquireSyncLockWaiting(timeoutMs);
  await waitForIdleWriteTransactions(Math.max(0, deadline - Date.now()));
}
