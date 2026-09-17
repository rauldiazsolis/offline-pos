import type { Signal } from '@preact/signals';
import { useRef } from 'preact/hooks';

const STEP_PX = 64;

export type TicketListNavigation = {
  containerRef: (el: HTMLDivElement | null) => void;
  ticketRef: (index: number) => (el: HTMLDivElement | null) => void;
  handleKeyDown: (event: KeyboardEvent) => boolean;
};

/**
 * Navegación de teclado de la pestaña Tickets de `/RESUMEN` — mecánica validada contra un
 * prototipo interactivo (ver spec, sección "Interacción de teclado, pestaña Tickets"). Resumen:
 *
 * - Selección por ticket completo, geométrica: qué ticket tiene la cabecera pegada arriba en una
 *   posición de scroll dada (`indexAtScrollPosition`), con la corrección de que una cabecera
 *   `position: sticky` se empuja fuera de vista una franja tan ancha como ella misma *antes* de
 *   llegar al `offsetTop` del siguiente ticket (no puede stickear más allá del borde inferior de
 *   su propio contenedor).
 * - Scroll instantáneo, no animado (`behavior: 'smooth'` se pisa a sí mismo con teclas repetidas
 *   rápido — auto-repeat real del teclado).
 * - Un paso de flecha se recorta si saltearía la ventana de selección completa de un ticket corto,
 *   para pararse justo en su borde en vez de seguir de largo.
 * - Cuando ya no hay scroll disponible en una dirección pero todavía quedan tickets (tramo final
 *   más corto que el viewport, donde ningún ticket ahí llega a pegar su cabecera del todo arriba),
 *   el cursor camina directo, un ticket a la vez, sin acompañarse de scroll.
 */
export function useTicketListNavigation(
  selectedIndex: Signal<number>,
  ticketCount: number,
): TicketListNavigation {
  const containerElRef = useRef<HTMLDivElement | null>(null);
  const ticketElsRef = useRef(new Map<number, HTMLDivElement>());
  const scrollTargetRef = useRef(0);

  function els(): HTMLDivElement[] {
    const map = ticketElsRef.current;
    const result: HTMLDivElement[] = [];
    for (let i = 0; i < ticketCount; i++) {
      const el = map.get(i);
      if (el !== undefined) result.push(el);
    }
    return result;
  }

  function maxScroll(container: HTMLDivElement): number {
    return container.scrollHeight - container.clientHeight;
  }

  function indexAtScrollPosition(pos: number): number {
    const list = els();
    if (list.length === 0) return 0;
    let chosen = 0;
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el === undefined || el.offsetTop > pos) break;
      chosen = i;
    }
    const chosenEl = list[chosen];
    if (chosenEl === undefined) return chosen;
    const header = chosenEl.querySelector<HTMLElement>('.ticket__header');
    const headerH = header !== null ? header.offsetHeight : 0;
    const pushOff = chosenEl.offsetTop + chosenEl.offsetHeight - headerH;
    if (pos >= pushOff && chosen < list.length - 1) chosen += 1;
    return chosen;
  }

  function applyScroll(container: HTMLDivElement, target: number): void {
    const max = maxScroll(container);
    scrollTargetRef.current = Math.max(0, Math.min(target, max));
    container.scrollTop = scrollTargetRef.current;
    // `Signal.value =` es la forma correcta de actualizar un signal reactivo (no una mutación de
    // prop) — la regla react-hooks/immutability no distingue signals de props comunes.
    // eslint-disable-next-line react-hooks/immutability
    selectedIndex.value = indexAtScrollPosition(scrollTargetRef.current);
  }

  function selectIndex(container: HTMLDivElement, idx: number): void {
    const list = els();
    const target = list[idx];
    if (target === undefined) return;
    const max = maxScroll(container);
    scrollTargetRef.current = Math.min(target.offsetTop, max);
    container.scrollTop = scrollTargetRef.current;
    // Ver comentario en applyScroll.
    // eslint-disable-next-line react-hooks/immutability
    selectedIndex.value = idx;
  }

  function stepScroll(container: HTMLDivElement, direction: 1 | -1): void {
    const list = els();
    if (list.length === 0) return;
    const curIdx = selectedIndex.value;
    const max = maxScroll(container);
    let proposed = Math.max(0, Math.min(scrollTargetRef.current + direction * STEP_PX, max));
    const proposedIdx = indexAtScrollPosition(proposed);
    if (direction > 0 && proposedIdx > curIdx + 1 && curIdx + 1 < list.length) {
      const next = list[curIdx + 1];
      if (next !== undefined) proposed = Math.min(next.offsetTop, max);
    } else if (direction < 0 && proposedIdx < curIdx - 1 && curIdx - 1 >= 0) {
      const prev = list[curIdx - 1];
      if (prev !== undefined) proposed = Math.min(prev.offsetTop, max);
    }
    if (proposed === scrollTargetRef.current) {
      if (direction > 0 && curIdx < list.length - 1) selectIndex(container, curIdx + 1);
      else if (direction < 0 && curIdx > 0) selectIndex(container, curIdx - 1);
      return;
    }
    applyScroll(container, proposed);
  }

  function handleKeyDown(event: KeyboardEvent): boolean {
    const container = containerElRef.current;
    if (container === null) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      stepScroll(container, 1);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      stepScroll(container, -1);
      return true;
    }
    if (event.key === 'PageDown') {
      event.preventDefault();
      selectIndex(container, Math.min(selectedIndex.value + 1, ticketCount - 1));
      return true;
    }
    if (event.key === 'PageUp') {
      event.preventDefault();
      selectIndex(container, Math.max(selectedIndex.value - 1, 0));
      return true;
    }
    return false;
  }

  return {
    containerRef: (el) => {
      containerElRef.current = el;
    },
    ticketRef: (index) => (el) => {
      if (el === null) ticketElsRef.current.delete(index);
      else ticketElsRef.current.set(index, el);
    },
    handleKeyDown,
  };
}
