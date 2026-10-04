import { localStoragePrefixFor, storageNamespaceFor } from './namespace-rules.ts';

export { localStoragePrefixFor, storageNamespaceFor };

/** Se calcula una vez al cargar: la carpeta no cambia sin recargar la página. */
export const STORAGE_NAMESPACE = storageNamespaceFor(window.location.pathname);

/**
 * Todo lo que la app guarda en `localStorage` lleva este prefijo. Borrar/volcar por prefijo, no por
 * una lista de claves escrita a mano (`sync/terminal-data.ts`): una clave futura queda incluida sola.
 */
export const LOCAL_STORAGE_PREFIX = `${STORAGE_NAMESPACE}:`;

/** Clave de `localStorage` de esta carpeta. Nadie escribe a mano una clave con el prefijo. */
export function storageKey(name: string): string {
  return `${LOCAL_STORAGE_PREFIX}${name}`;
}

/**
 * Cerrojo de `navigator.locks` y canal de `BroadcastChannel` de la pestaña que manda (#175). Los dos
 * ya están separados por origen; con la carpeta, dos versiones publicadas del mismo origen tampoco se
 * bloquean entre sí.
 */
export function tabLockNameFor(pathname: string): string {
  return `${localStoragePrefixFor(pathname)}tab`;
}

export const TAB_LOCK_NAME = storageKey('tab');
