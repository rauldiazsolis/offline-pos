import { signal } from '@preact/signals';
import { storageKey } from '../../storage/storage-namespace.ts';
import { MIN_SUPPORTED_WIDTH_PX } from './viewport.ts';

/**
 * Las dos vistas del mismo POS: la de escritorio (`ui/app.tsx`) y la de celular (`mobile/`), sin
 * teclado del sistema. Son la misma terminal en la misma carpeta: comparten la base, la conexión, lo
 * pendiente y hasta la venta en curso, así que cambiar de una a la otra es instantáneo.
 */
export type UiMode = 'desktop' | 'mobile';

const UI_MODE_KEY = storageKey('ui-mode');

/** Lo elegido; sin elegir, el ancho decide: por debajo del mínimo de escritorio, la de celular. Pura. */
export function resolveUiMode(saved: string | null, width: number): UiMode {
  if (saved === 'desktop' || saved === 'mobile') {
    return saved;
  }
  return width < MIN_SUPPORTED_WIDTH_PX ? 'mobile' : 'desktop';
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(UI_MODE_KEY);
  } catch {
    return null;
  }
}

export const uiModeSignal = signal<UiMode>(resolveUiMode(readSaved(), window.innerWidth));

/** Cambia de vista y la recuerda (best-effort: si no se puede guardar, vale para esta sesión). */
export function setUiMode(mode: UiMode): void {
  try {
    localStorage.setItem(UI_MODE_KEY, mode);
  } catch {
    // Sin localStorage: el cambio vale igual hasta recargar.
  }
  uiModeSignal.value = mode;
}

/** `html.pos-mobile` activa los estilos de la vista de celular (`mobile/src/styles.css`). */
export function applyUiModeClass(mode: UiMode, root: HTMLElement = document.documentElement): void {
  root.classList.toggle('pos-mobile', mode === 'mobile');
}
