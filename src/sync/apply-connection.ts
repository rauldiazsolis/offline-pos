import { splitConnectorCustomers } from '../domain/customer.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { db } from '../storage/db.ts';
import { clearAllTables, countLocalCatalog } from '../storage/local-data.ts';
import { setCatalogRepository } from '../ui/state/catalog.ts';
import { setCustomerRepository } from '../ui/state/customer-repository.ts';
import {
  setConnectionState,
  setLastSyncFailure,
  setLastSyncedAt,
  setLocalCatalogCounts,
  setSyncConfigured,
  setSyncStatus,
} from '../ui/state/sync.ts';
import { saveSyncConfig, type SyncConfig } from './config.ts';
import { withTimeout, type ProbeSnapshot } from './connection.ts';
import type { Connector } from './connector.ts';
import { createConnector } from './connector-registry.ts';
import { clearSyncCursors, setCustomersCursor, setProductsCursor } from './cursor.ts';
import { acquireSyncLockWaiting, pushPendingEvents } from './engine.ts';

export const FLUSH_TIMEOUT_MS = 10_000;
export const APPLY_LOCK_WAIT_MS = 30_000;

/**
 * Último intento de enviar el outbox al conector **actual** antes de borrar
 * los datos al cambiar de conexión (Etapa 2b, #76). Best-effort: ignora el
 * backoff, toma el cerrojo de sync y lleva un tope de tiempo — si el backend
 * viejo ya no responde, no cuelga el cambio (lo que quede pendiente se
 * cuenta como "sin enviar" en la confirmación). Si vence el tiempo, el envío
 * en vuelo sigue por su cuenta pero ya sin cerrojo; es inocuo porque cada
 * evento viaja con su `Idempotency-Key`.
 */
export async function flushPendingBeforeWipe(
  current: SyncConfig,
  options: { timeoutMs?: number; connector?: Connector } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? FLUSH_TIMEOUT_MS;
  const release = await acquireSyncLockWaiting(timeoutMs);
  if (release === undefined) {
    return;
  }
  try {
    const connector = options.connector ?? createConnector(current);
    await withTimeout(
      pushPendingEvents(connector, new Date().toISOString(), { ignoreBackoff: true }).then(() =>
        ok(undefined),
      ),
      timeoutMs,
    );
  } finally {
    release();
  }
}

export type ApplyConnectionParams = {
  candidate: SyncConfig;
  snapshot: ProbeSnapshot;
  wipe: boolean;
  now: string;
  lockWaitMs?: number;
};

/**
 * Aplica una conexión ya probada (Etapa 2b, #76):
 * 1. toma el cerrojo de sync (ningún ciclo se intercala);
 * 2. **una sola transacción Dexie** sobre todas las tablas: limpia si `wipe`
 *    y carga el snapshot — si algo falla acá, no cambió nada;
 * 3. reinicia los cursores, fija los del snapshot y reconstruye los
 *    repositorios en memoria;
 * 4. **al final** guarda la config con `verifiedAt`, así nunca queda una
 *    config activa con datos de otro backend.
 *
 * Riesgo residual aceptado: el guardado de la config vive en `localStorage`,
 * que no puede entrar en la transacción de Dexie. Si ese `setItem` (de un
 * string chico) fallara *después* del commit, el usuario ve el error y el
 * próximo arranque encuentra la config anterior con datos nuevos.
 */
export async function applyConnection(params: ApplyConnectionParams): Promise<Result<void>> {
  const release = await acquireSyncLockWaiting(params.lockWaitMs ?? APPLY_LOCK_WAIT_MS);
  if (release === undefined) {
    return err('connection/apply-failed', { message: 'hay una sincronización en curso' });
  }

  try {
    const { customers, accounts } = splitConnectorCustomers(params.snapshot.customers, {
      now: params.now,
    });

    try {
      await db.transaction('rw', db.tables, async () => {
        if (params.wipe) {
          await clearAllTables();
        }
        await db.products.bulkPut(params.snapshot.products);
        await db.stock.bulkPut(params.snapshot.stock);
        await db.customers.bulkPut(customers);
        await db.customerAccounts.bulkPut(accounts);
      });
    } catch (error) {
      return err('connection/apply-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    clearSyncCursors();
    if (params.snapshot.cursors.products !== undefined) {
      setProductsCursor(params.snapshot.cursors.products);
    }
    if (params.snapshot.cursors.customers !== undefined) {
      setCustomersCursor(params.snapshot.cursors.customers);
    }
    setCatalogRepository(await loadCatalogRepository());
    setCustomerRepository(await loadCustomerRepository());

    const saved = saveSyncConfig({ ...params.candidate, verifiedAt: params.now });
    if (!saved.ok) {
      return err('connection/apply-failed', { message: 'no se pudo guardar la configuración' });
    }

    setConnectionState('active');
    setSyncConfigured(true);
    setLastSyncedAt(params.now);
    setLastSyncFailure(null);
    setLocalCatalogCounts(await countLocalCatalog());
    setSyncStatus('online-idle');
    return ok(undefined);
  } finally {
    release();
  }
}
