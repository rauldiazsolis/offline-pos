import { buildEventOrigin, type EventOrigin } from '../domain/event-origin.ts';
import { db } from '../storage/db.ts';
import { clearAllTables } from '../storage/local-data.ts';
import { clearTrainingKeys } from '../storage/training-copy.ts';
import { isTrainingMode } from '../storage/training-mode.ts';
import { loadSyncConfig, saveSyncConfig, type SyncConfig } from './config.ts';
import { clearSyncCursors } from './cursor.ts';
import { clearPushLotState } from './push-lot.ts';
import { storageKey } from '../storage/storage-namespace.ts';
import { getDeviceId, peekDeviceId, setResolvedDeviceId } from './device-id.ts';

// El id en memoria vive en `device-id.ts` (sin dependencias, 4.7.0, #230); acá, su ciclo de vida.
export { getDeviceId, peekDeviceId };

export const DEVICE_ID_KEY = storageKey('device-id');

export type IdentityResolution =
  | { status: 'existing' }
  | { status: 'created'; wipedLocalData: boolean }
  /** #177: se perdió el id en entrenamiento; se salió del modo y `bootstrap` recarga. */
  | { status: 'training-exited' };

function readStoredDeviceId(): string | undefined {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    return stored !== null && stored !== '' ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort como `sync/cursor.ts`: si `localStorage` falla, el id vive solo en memoria. */
function storeDeviceId(id: string): void {
  try {
    localStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    /* best-effort */
  }
}

async function hasAnyLocalData(): Promise<boolean> {
  const counts = await Promise.all(db.tables.map((table) => table.count()));
  return counts.some((count) => count > 0);
}

/**
 * Ciclo de vida del id de dispositivo (Etapa 2, #97). Se llama **una sola
 * vez**, al principio de `bootstrap()`. Sin id guardado, los datos locales
 * dejan de servir (el backend no podría atribuirlos): se borran todas las
 * tablas, los cursores y el estado de lotes, y se genera un id nuevo. La config
 * de `/CONFIG` se conserva como precarga pero **sin `verifiedAt`**, así el
 * wizard obliga a volver a probar la conexión sin tener que retipearla.
 * Riesgo aceptado (epic #94): lo pendiente sin enviar se pierde.
 */
export async function resolveDeviceIdentity(): Promise<IdentityResolution> {
  const stored = readStoredDeviceId();
  if (stored !== undefined) {
    setResolvedDeviceId(stored);
    return { status: 'existing' };
  }
  // #177: sin id con la marca de entrenamiento, primero se sale del entrenamiento: el borrado de
  // siempre tiene que correr sobre la base real, no sobre la de práctica. `bootstrap` recarga.
  if (isTrainingMode()) {
    clearTrainingKeys();
    return { status: 'training-exited' };
  }

  const config = loadSyncConfig();
  const wipedLocalData = (await hasAnyLocalData()) || config.ok;
  await db.transaction('rw', db.tables, clearAllTables);
  clearSyncCursors();
  clearPushLotState();
  if (config.ok) {
    const unverified: SyncConfig = { ...config.value };
    delete unverified.verifiedAt;
    saveSyncConfig(unverified);
  }

  const created = crypto.randomUUID();
  storeDeviceId(created);
  setResolvedDeviceId(created);
  return { status: 'created', wipedLocalData };
}

/** Solo tests (`src/test/setup.ts`): fija o limpia el id en memoria. */
export function setDeviceIdForTests(id: string | undefined): void {
  setResolvedDeviceId(id);
}

/** Sucursal y punto de venta actuales de `/CONFIG`, para estampar en un evento al encolarlo. */
export function currentEventOrigin(): EventOrigin {
  const config = loadSyncConfig();
  if (!config.ok) {
    return {};
  }
  return buildEventOrigin({ branch: config.value.branch, pointOfSale: config.value.pointOfSale });
}
