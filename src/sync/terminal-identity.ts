import { buildEventOrigin, type EventOrigin } from '../domain/event-origin.ts';
import { db } from '../storage/db.ts';
import { clearAllTables } from '../storage/local-data.ts';
import { loadSyncConfig, saveSyncConfig, type SyncConfig } from './config.ts';
import { clearSyncCursors } from './cursor.ts';
import { clearPushLotState } from './push-lot.ts';

export const DEVICE_ID_KEY = 'offline-pos:device-id';

/** Id resuelto al arrancar (`resolveDeviceIdentity`); nunca se crea después. */
let cachedDeviceId: string | undefined;

export type IdentityResolution =
  { status: 'existing' } | { status: 'created'; wipedLocalData: boolean };

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
    cachedDeviceId = stored;
    return { status: 'existing' };
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
  cachedDeviceId = created;
  return { status: 'created', wipedLocalData };
}

/**
 * Id de dispositivo: viaja una vez por request de push y de pull (contrato
 * v3). Nunca crea uno: si alguien borra la clave a mitad de sesión, la
 * terminal sigue con el id en memoria hasta recargar, y recién ahí
 * `resolveDeviceIdentity` aplica el ciclo de vida. Llamarlo antes de resolver
 * es un bug (invariante), no un error de negocio.
 */
export function getDeviceId(): string {
  if (cachedDeviceId === undefined) {
    throw new Error('getDeviceId() antes de resolveDeviceIdentity()');
  }
  return cachedDeviceId;
}

/** Para `pos.deviceId()`, que existe antes del arranque: `null` si todavía no se resolvió. */
export function peekDeviceId(): string | null {
  return cachedDeviceId ?? null;
}

/** Solo tests (`src/test/setup.ts`): fija o limpia el id en memoria. */
export function setDeviceIdForTests(id: string | undefined): void {
  cachedDeviceId = id;
}

/** Sucursal y punto de venta actuales de `/CONFIG`, para estampar en un evento al encolarlo. */
export function currentEventOrigin(): EventOrigin {
  const config = loadSyncConfig();
  if (!config.ok) {
    return {};
  }
  return buildEventOrigin({ branch: config.value.branch, pointOfSale: config.value.pointOfSale });
}
