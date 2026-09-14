import { useSignalEffect, type Signal } from '@preact/signals';
import { useRef } from 'preact/hooks';

/**
 * Mantiene visible el elemento correspondiente al índice seleccionado de una
 * lista — carrito, o cualquiera de los overlays de resultados de
 * `CommandBarInput` — sin importar la causa del cambio (agregar una línea,
 * cambiar su cantidad, navegar con flechas). Issue #26: las flechas sí
 * movían la selección, pero sin esto la fila resaltada podía quedar
 * invisible, fuera de la parte scrolleada de la lista.
 *
 * Devuelve una función que arma el `ref` callback para la fila de un índice
 * dado — `useScrollSelectedIntoView(signal)(index)`.
 */
export function useScrollSelectedIntoView(
  selectedIndex: Signal<number | null>,
): (index: number) => (el: HTMLElement | null) => void {
  const rows = useRef(new Map<number, HTMLElement>());

  useSignalEffect(() => {
    const index = selectedIndex.value;
    if (index === null) {
      return;
    }
    rows.current.get(index)?.scrollIntoView({ block: 'nearest' });
  });

  return (index: number) => (el: HTMLElement | null) => {
    if (el === null) {
      rows.current.delete(index);
    } else {
      rows.current.set(index, el);
    }
  };
}
