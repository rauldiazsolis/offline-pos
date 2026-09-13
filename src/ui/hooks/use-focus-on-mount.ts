import { useLayoutEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * Enfoca un elemento al montarse — `useLayoutEffect`, no `useEffect`, porque
 * Preact difiere `useEffect` a un frame (vía rAF): una tecla enviada muy
 * rápido después de montar (un test e2e, o `autoFocus` nativo del navegador
 * al re-insertar el elemento dinámicamente) puede perderse o simplemente no
 * disparar el foco. Ver CLAUDE.md, "Patrones establecidos" — este hook
 * consolida el patrón que ya usaban `CheckoutScreen`/`ConfigScreen`/
 * `VoidSaleScreen`/`ReceiptScreen` cada uno por su cuenta, y que
 * `CommandBarInput` no tenía (usaba `autoFocus` nativo, la causa real de un
 * bug reportado: el foco se perdía al volver de un popup con Esc).
 */
export function useFocusOnMount<T extends HTMLElement>(): RefObject<T> {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    ref.current?.focus();
  }, []);

  return ref;
}
