const BASE_NAME = 'offline-pos';

/**
 * Nombre del almacenamiento local de la carpeta donde se sirve el POS (#148): carpetas del mismo
 * origen comparten IndexedDB y `localStorage`, así que cada versión publicada (`/0.1.0/`) usa el
 * suyo. La carpeta es todo `pathname` hasta la última `/`. En la raíz sigue siendo `offline-pos`,
 * como antes de #148: las terminales servidas en `/` no se enteran.
 */
export function storageNamespaceFor(pathname: string): string {
  const folder = pathname.slice(0, pathname.lastIndexOf('/') + 1);
  return folder === '/' || folder === '' ? BASE_NAME : `${BASE_NAME}@${folder}`;
}

/** Prefijo de las claves de `localStorage`; el `:` final evita que una carpeta abarque a otra. */
export function localStoragePrefixFor(pathname: string): string {
  return `${storageNamespaceFor(pathname)}:`;
}

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
