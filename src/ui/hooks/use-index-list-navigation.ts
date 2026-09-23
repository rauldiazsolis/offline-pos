import type { Signal } from '@preact/signals';

const PAGE_STEP = 10;

export type IndexListNavigation = {
  handleKeyDown: (event: KeyboardEvent) => boolean;
};

/**
 * Navegación de teclado para una lista plana de filas uniformes (Productos, Medios de pago de
 * `/RESUMEN`) — a diferencia de `useTicketListNavigation`, acá no hay geometría de scroll que
 * resolver (sin cabecera sticky por ítem, todas las filas del mismo alto): una flecha mueve la
 * selección de a 1, PageUp/PageDown de a `PAGE_STEP`, siempre clampeados a los límites de la
 * lista. El propio componente que consume esto (`useScrollSelectedIntoView`) se encarga de que la
 * fila elegida quede visible.
 */
export function useIndexListNavigation(
  selectedIndex: Signal<number | null>,
  count: number,
): IndexListNavigation {
  function move(delta: number): void {
    if (count === 0) return;
    const current = selectedIndex.value ?? -1;
    selectedIndex.value = Math.max(0, Math.min(current + delta, count - 1));
  }

  function handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return true;
    }
    if (event.key === 'PageDown') {
      event.preventDefault();
      move(PAGE_STEP);
      return true;
    }
    if (event.key === 'PageUp') {
      event.preventDefault();
      move(-PAGE_STEP);
      return true;
    }
    return false;
  }

  return { handleKeyDown };
}
