import { useEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * Proporción visible/oculta de un contenedor con scroll, para dibujar un
 * indicador propio en vez de depender de la scrollbar nativa (issue: el
 * usuario prefiere ocultar la scrollbar, pero mantener alguna señal visual
 * de que hay más contenido arriba/abajo — puramente informativo, nunca
 * accionable).
 */
export type ScrollThumb = { topRatio: number; sizeRatio: number; visible: boolean };

const HIDDEN: ScrollThumb = { topRatio: 0, sizeRatio: 1, visible: false };

function computeThumb(el: HTMLElement): ScrollThumb {
  const { scrollTop, scrollHeight, clientHeight } = el;
  if (scrollHeight <= clientHeight) {
    return HIDDEN;
  }
  return {
    topRatio: scrollTop / scrollHeight,
    sizeRatio: clientHeight / scrollHeight,
    visible: true,
  };
}

/**
 * Escucha `scroll` sobre el elemento y `ResizeObserver` (el contenido
 * puede cambiar de alto sin que el usuario scrollee — ej. agregar una
 * línea al carrito) para recalcular. `visible: false` cuando el contenido
 * entra completo — no hace falta ningún indicador.
 */
export function useScrollIndicator(ref: RefObject<HTMLElement>): ScrollThumb {
  const [thumb, setThumb] = useState<ScrollThumb>(HIDDEN);

  useEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    const update = () => {
      setThumb(computeThumb(el));
    };
    update();
    el.addEventListener('scroll', update);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [ref]);

  return thumb;
}
