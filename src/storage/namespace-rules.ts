/**
 * Puras y sin `window`: también las usa el service worker (#54), donde no hay `location` de página.
 */
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
