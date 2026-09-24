import { splitConnectorCustomers } from '../domain/customer.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { db } from '../storage/db.ts';
import { clearAllTables, countLocalCatalog } from '../storage/local-data.ts';
import { applySnapshotReconciled } from '../storage/reconcile.ts';
import { setCatalogRepository } from '../ui/state/catalog.ts';
import { setCustomerRepository } from '../ui/state/customer-repository.ts';
import { refreshStockSnapshot } from '../ui/state/stock.ts';
import {
  setActiveConnectorType,
  setConnectionState,
  setLastSyncFailure,
  setLastSyncedAt,
  setLocalCatalogCounts,
  setSyncConfigured,
  setSyncStatus,
} from '../ui/state/sync.ts';
import { loadSyncConfig, saveSyncConfig, type SyncConfig } from './config.ts';
import { connectionState } from './connection-state.ts';
import { withTimeout, type ProbeSnapshot } from './connection.ts';
import type { Connector } from './connector.ts';
import { createConnector } from './connector-registry.ts';
import { clearSyncCursors, setCustomersCursor, setProductsCursor } from './cursor.ts';
import { acquireSyncLockWaiting, pushPendingLot } from './engine.ts';
import { clearPushLotState } from './push-lot.ts';

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
      pushPendingLot(connector, new Date().toISOString(), { ignoreBackoff: true }).then(() =>
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
  /** Etapa 2 (#97): el usuario elige; nunca se borra solo por cambiar de origen. */
  local: 'keep' | 'wipe';
  /** El endpoint cambió: los lotes del backend viejo no le sirven al nuevo. */
  originChanged: boolean;
  now: string;
  lockWaitMs?: number;
};

/**
 * Aplica una conexión ya probada (Etapa 2b, #76):
 * 1. toma el cerrojo de sync (ningún ciclo se intercala);
 * 2. **una sola transacción Dexie** sobre todas las tablas — si algo falla
 *    acá, no cambió nada. Con `wipe` limpia todo y carga el snapshot; con
 *    `keep` (Etapa 2 de #94) lo reconcilia como una foto completa y deja
 *    intactos ventas, turnos, movimientos, outbox y venta en curso;
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
    try {
      await db.transaction('rw', db.tables, async () => {
        if (params.local === 'wipe') {
          const { customers, accounts } = splitConnectorCustomers(params.snapshot.customers, {
            now: params.now,
          });
          await clearAllTables();
          await db.products.bulkPut(params.snapshot.products);
          await db.stock.bulkPut(params.snapshot.stock);
          await db.customers.bulkPut(customers);
          await db.customerAccounts.bulkPut(accounts);
          return;
        }
        // Mantener: la foto es la fuente de verdad del catálogo y los clientes
        // (desaparece lo del backend anterior); lo demás queda intacto. Con
        // otro origen, un backend nuevo vacío es legítimo y sí vacía la tabla.
        await applySnapshotReconciled(params.snapshot, {
          now: params.now,
          allowEmptyTables: params.originChanged,
        });
      });
    } catch (error) {
      return err('connection/apply-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    clearSyncCursors();
    // Mismo origen: un lote congelado cuyo ack se perdió tiene que reenviarse con SU
    // idempotency_id, o el backend lo recibiría duplicado. Otro origen: el backend nuevo no
    // conoce esos lotes y los pendientes salen en uno nuevo.
    if (params.local === 'wipe' || params.originChanged) {
      clearPushLotState();
    }
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
    setActiveConnectorType(params.candidate.type);
    setSyncConfigured(true);
    setLastSyncedAt(params.now);
    setLastSyncFailure(null);
    setLocalCatalogCounts(await countLocalCatalog());
    await refreshStockSnapshot();
    setSyncStatus('online-idle');
    return ok(undefined);
  } finally {
    release();
  }
}

/**
 * Camino "solo terminal" del wizard (Etapa 2, #97): la conexión no cambió, así
 * que no hay prueba ni cerrojo ni IndexedDB — solo se guarda sucursal, punto de
 * venta y locale sobre la config actual, conservando `verifiedAt`. Los eventos
 * ya encolados conservan su `origin`.
 */
export function applyTerminalSettings(terminal: {
  branch: string;
  pointOfSale: string;
  locale: string;
}): Result<void> {
  const current = loadSyncConfig();
  if (!current.ok) {
    return current;
  }
  const next: SyncConfig = {
    ...current.value,
    branch: terminal.branch.trim(),
    pointOfSale: terminal.pointOfSale.trim(),
  };
  const locale = terminal.locale.trim();
  if (locale !== '') {
    next.locale = locale;
  } else {
    delete next.locale;
  }
  const saved = saveSyncConfig(next);
  if (!saved.ok) {
    return saved;
  }
  const state = connectionState(ok(next));
  setConnectionState(state);
  // De `incomplete` a `active`: ahora sí hay comandos del conector (ver `bootstrap`).
  setActiveConnectorType(state === 'active' ? next.type : null);
  return ok(undefined);
}
