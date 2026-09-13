import type { Page } from '@playwright/test';

/**
 * Lee todas las filas de una tabla de la base local (IndexedDB), sin pasar
 * por Dexie/el código de la app — así el test no depende de módulos internos
 * y puede correr contra el build real servido por `pnpm preview`.
 */
export function getAllFromStore<T>(page: Page, storeName: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<unknown[]>((resolve, reject) => {
        const request = indexedDB.open('offline-pos');
        request.onerror = () => {
          reject(new Error(request.error?.message ?? 'No se pudo abrir IndexedDB'));
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(name, 'readonly');
          const getAllRequest = tx.objectStore(name).getAll();
          getAllRequest.onsuccess = () => {
            resolve(getAllRequest.result);
          };
          getAllRequest.onerror = () => {
            reject(new Error(getAllRequest.error?.message ?? `No se pudo leer "${name}"`));
          };
        };
      }),
    storeName,
  ) as Promise<T[]>;
}

/**
 * Escribe una fila directo en IndexedDB, sin pasar por Dexie/el código de la
 * app — mismo criterio que `getAllFromStore`. Se usa para sembrar una
 * `CustomerAccount` que en producción vendría de un pull real (no hay
 * backend en los e2e, ver CLAUDE.md), así se puede probar la evaluación de
 * crédito offline sin necesitar un conector de verdad.
 */
export function putIntoStore(page: Page, storeName: string, value: unknown): Promise<void> {
  return page.evaluate(
    ({ name, row }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('offline-pos');
        request.onerror = () => {
          reject(new Error(request.error?.message ?? 'No se pudo abrir IndexedDB'));
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(name, 'readwrite');
          const putRequest = tx.objectStore(name).put(row);
          putRequest.onsuccess = () => {
            resolve();
          };
          putRequest.onerror = () => {
            reject(new Error(putRequest.error?.message ?? `No se pudo escribir en "${name}"`));
          };
        };
      }),
    { name: storeName, row: value },
  );
}
