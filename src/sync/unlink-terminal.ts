import { err, ok, type Result } from '../domain/result.ts';
import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { db } from '../storage/db.ts';
import { clearAllTables, countLocalCatalog } from '../storage/local-data.ts';
import { isTrainingMode } from '../storage/training-mode.ts';
import { setCatalogRepository } from '../ui/state/catalog.ts';
import { setCustomerRepository } from '../ui/state/customer-repository.ts';
import { refreshCustomerBalances } from '../ui/state/customer-balance.ts';
import { refreshStockSnapshot } from '../ui/state/stock.ts';
import {
  setActiveConnectorType,
  setBackendCheckDue,
  setBackendStatus,
  setConnectionState,
  setDemoSession,
  setLastPullApplication,
  setLastSyncFailure,
  setLocalCatalogCounts,
  setPendingOutboxCount,
  setPushLotIssues,
  setSyncConfigured,
  setTerminalIdentity,
} from '../ui/state/sync.ts';
import { saveBackendCapabilities } from './backend-capabilities.ts';
import { saveBackendCompany } from './backend-company.ts';
import { saveBackendNotices } from './backend-notices.ts';
import { saveBackendPortal } from './backend-portal.ts';
import { clearSyncConfig } from './config.ts';
import { clearSyncCursors } from './cursor.ts';
import { clearDemoRevoked } from './demo-revoked.ts';
import { clearDeviceRevoked } from './device-revoked.ts';
import { acquireSyncLockWaiting } from './engine.ts';
import { clearPushLotState } from './push-lot.ts';
import { RESET_LOCK_WAIT_MS } from './terminal-data.ts';

/**
 * Desvincular la terminal (4.7.0, #230): la salida de "caja vinculada en otro dispositivo". Deja
 * la terminal sin conexión (`unconfigured`: la app muestra `/CONFIG` en modo requerido) y sin
 * datos locales: borra todas las tablas (`clearAllTables`, como "Borrar" en `/CONFIG`), la config,
 * los cursores, el estado de lotes, las capacidades, la empresa, el portal, los avisos, la demo
 * revocada y la marca de caja revocada. Lo pendiente se pierde: la UI ofrece antes exportarlo
 * (`pending-export.ts`).
 *
 * A diferencia de `pos.reset()` (`terminal-data.ts::resetTerminal`), que borra todas las claves de
 * la carpeta, **conserva**: el id de dispositivo (es este equipo, no la caja; borrarlo dispararía
 * en el próximo arranque el aviso de identidad perdida y otro borrado, y un claim nuevo desde acá
 * lo vincula igual), los contadores de ticket y recibo (la numeración nunca se repite, como con
 * "Borrar"), `/IMPRESORA` y la vista elegida. No da de baja el service worker.
 *
 * Toma el cerrojo de sync mientras borra. Deja los signals como una terminal sin configurar y
 * los repositorios en memoria vacíos; la venta en curso y el cliente adjunto en memoria los limpia
 * la UI (`ui/session-reset.ts::resetSessionAfterWipe`) antes de abrir el wizard requerido, o
 * recarga. En entrenamiento no se puede: la base abierta es la de práctica.
 */
export async function unlinkTerminal(): Promise<Result<void>> {
  if (isTrainingMode()) {
    return err('terminal/unlink-in-training', undefined);
  }
  const release = await acquireSyncLockWaiting(RESET_LOCK_WAIT_MS);
  if (release === undefined) {
    return err('connection/sync-busy', undefined);
  }
  try {
    try {
      await db.transaction('rw', db.tables, clearAllTables);
    } catch (error) {
      return err('terminal/reset-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    clearSyncConfig();
    clearSyncCursors();
    clearPushLotState();
    saveBackendCapabilities(undefined);
    saveBackendCompany(undefined);
    saveBackendPortal(undefined);
    saveBackendNotices([]);
    clearDemoRevoked();
    clearDeviceRevoked();

    setConnectionState('unconfigured');
    setActiveConnectorType(null);
    setDemoSession(null);
    setTerminalIdentity(null);
    setSyncConfigured(false);
    setBackendStatus({ kind: 'unknown' });
    setBackendCheckDue(true);
    setLastSyncFailure(null);
    setLastPullApplication(null);
    setPushLotIssues(null);
    setPendingOutboxCount(0);
    setCatalogRepository(await loadCatalogRepository());
    setCustomerRepository(await loadCustomerRepository());
    setLocalCatalogCounts(await countLocalCatalog());
    await refreshStockSnapshot();
    await refreshCustomerBalances();
    return ok(undefined);
  } finally {
    release();
  }
}
