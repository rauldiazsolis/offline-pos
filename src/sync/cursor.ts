/**
 * Cursor de pull del catálogo (`since`) — estado operativo interno del
 * motor, nunca tocado por la pantalla `/CONFIG`. Separado de `config.ts` a
 * propósito: son dos cosas distintas guardadas en `localStorage`.
 *
 * Best-effort a propósito: si `localStorage` falla (modo privado, cuota
 * llena), el motor simplemente vuelve a pullear el catálogo completo en el
 * próximo ciclo — no es un error de negocio que valga la pena modelar con
 * Result, perder el cursor no rompe nada, solo hace el próximo pull más caro.
 */
const PRODUCTS_CURSOR_KEY = 'offline-pos:sync-cursor:products';
const CUSTOMERS_CURSOR_KEY = 'offline-pos:sync-cursor:customers';

export function getProductsCursor(): string | undefined {
  try {
    return localStorage.getItem(PRODUCTS_CURSOR_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setProductsCursor(cursor: string): void {
  try {
    localStorage.setItem(PRODUCTS_CURSOR_KEY, cursor);
  } catch {
    /* best-effort, ver comentario de arriba */
  }
}

export function getCustomersCursor(): string | undefined {
  try {
    return localStorage.getItem(CUSTOMERS_CURSOR_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setCustomersCursor(cursor: string): void {
  try {
    localStorage.setItem(CUSTOMERS_CURSOR_KEY, cursor);
  } catch {
    /* best-effort, ver comentario de arriba */
  }
}

/**
 * Usado por `/DEMO_RESET` (Ciclo 8, `storage/demo-reset.ts`): sin esto, el
 * próximo pull solo traería deltas desde el cursor viejo y nunca repondría
 * el catálogo/clientes que el reset acaba de borrar localmente. Best-effort,
 * mismo criterio que el resto de este módulo.
 */
export function clearSyncCursors(): void {
  try {
    localStorage.removeItem(PRODUCTS_CURSOR_KEY);
    localStorage.removeItem(CUSTOMERS_CURSOR_KEY);
  } catch {
    /* best-effort, ver comentario de arriba */
  }
}
