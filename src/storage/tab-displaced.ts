import { storageKey } from './storage-namespace.ts';

/**
 * Marca de "a esta pestaña la desplazaron" (#175): la pone la pestaña que suelta el control justo
 * antes de recargarse, y la lee la pantalla de la segunda pestaña al cargar. `sessionStorage` es de
 * esta pestaña y sobrevive a su propio reload. Best-effort: si el navegador no deja usarlo, solo se
 * pierde el aviso.
 */
const DISPLACED_KEY = storageKey('tab-displaced');

export function markTabDisplaced(): void {
  try {
    sessionStorage.setItem(DISPLACED_KEY, '1');
  } catch {
    // Sin `sessionStorage` solo se pierde el aviso.
  }
}

/** Lee y borra la marca: el aviso se muestra una sola vez. */
export function consumeTabDisplaced(): boolean {
  try {
    const displaced = sessionStorage.getItem(DISPLACED_KEY) !== null;
    sessionStorage.removeItem(DISPLACED_KEY);
    return displaced;
  } catch {
    return false;
  }
}
