import { buildEventOrigin, type EventOrigin } from '../domain/event-origin.ts';
import { loadSyncConfig } from './config.ts';

export const DEVICE_ID_KEY = 'offline-pos:device-id';

let memoryFallback: string | undefined;

/**
 * Id de dispositivo (contrato v3, #96): viaja una vez por request de push y
 * de pull. Esta etapa solo lo genera y lo reusa; su ciclo de vida (sin id, la
 * terminal arranca de cero) es de la Etapa 2 (#97). Best-effort como
 * `sync/cursor.ts`: si `localStorage` falla, un id en memoria mantiene al
 * menos la misma identidad durante esta carga de la página.
 */
export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored !== null && stored !== '') {
      return stored;
    }
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    memoryFallback ??= crypto.randomUUID();
    return memoryFallback;
  }
}

/** Sucursal y punto de venta actuales de `/CONFIG`, para estampar en un evento al encolarlo. */
export function currentEventOrigin(): EventOrigin {
  const config = loadSyncConfig();
  if (!config.ok) {
    return {};
  }
  return buildEventOrigin({ branch: config.value.branch, pointOfSale: config.value.pointOfSale });
}
