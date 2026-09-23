import type { JSX } from 'preact';
import type { ScrollThumb } from '../hooks/use-scroll-indicator.ts';

/**
 * Barra angosta, puramente informativa (`pointer-events: none` — en ningún
 * caso es accionable, ni con click ni con drag) que muestra la proporción
 * visible/oculta de una lista con scroll, en el borde donde iría la
 * scrollbar nativa (que se oculta vía CSS en el contenedor — ver
 * `cart-view.css`/`CommandBarInput.tsx`). El wheel y el autoscroll nativo
 * por click en la ruedita del mouse siguen andando igual: ninguno de los
 * dos depende de que la scrollbar sea visible.
 *
 * `variant` adapta el color al fondo — claro (carrito) u oscuro (overlays
 * de `CommandBarInput`, "chrome" oscuro).
 *
 * Los "bigotes" (Ciclo 8, punto 7) son dos marcas fijas en los extremos del
 * carril — a diferencia del thumb (que se mueve y cambia de alto según
 * cuánto se ve), estas no se mueven nunca: enmarcan el carril completo para
 * reforzar "hay contenido de este lado" incluso cuando el thumb, por ser
 * chico, queda lejos de ese extremo. Más oscuros/sólidos que el thumb y que
 * el riel (pedido del usuario tras ver la primera versión, donde los tres
 * eran del mismo color y costaba distinguirlos) — un riel fino de punta a
 * punta detrás del thumb rellena el hueco visual entre este y cada bigote
 * cuando el thumb no llega hasta el extremo. `topOffset` corre el carril
 * entero (bigotes incluidos) hacia abajo — lo usa el carrito para no
 * invadir la zona del `<thead>` sticky (`cart-view.css`): el bigote tiene
 * que tener relación visual directa con el área de contenido de la lista,
 * no con el header. Los overlays de `CommandBarInput` no tienen header
 * propio, así que usan el default (`0`).
 */
export function ScrollIndicatorBar({
  thumb,
  variant,
  topOffset = '0px',
}: {
  thumb: ScrollThumb;
  variant: 'light' | 'dark';
  topOffset?: string;
}): JSX.Element | null {
  if (!thumb.visible) {
    return null;
  }
  const railColor = variant === 'light' ? 'var(--color-border)' : 'var(--color-chrome-border)';
  const whiskerColor =
    variant === 'light' ? 'var(--color-text-muted)' : 'var(--color-chrome-text-muted)';
  const opacity = variant === 'light' ? 1 : 0.6;
  const whiskerStyle = {
    position: 'absolute' as const,
    left: 0,
    width: '100%',
    height: '2px',
    borderRadius: '1px',
    background: whiskerColor,
    opacity,
  };
  return (
    <div
      style={{
        position: 'absolute',
        top: topOffset,
        right: 0,
        bottom: 0,
        width: '4px',
        pointerEvents: 'none',
      }}
    >
      {/* Riel fino de punta a punta, detrás del thumb — rellena el hueco
          visual entre el thumb y cada bigote cuando el thumb no llega hasta
          el extremo (antes, esos huecos quedaban vacíos, sin relación
          visual con el carril completo). */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '1.5px',
          width: '1px',
          background: railColor,
          opacity,
        }}
      />
      <div style={{ ...whiskerStyle, top: 0 }} />
      <div
        style={{
          position: 'absolute',
          top: `${String(thumb.topRatio * 100)}%`,
          height: `${String(thumb.sizeRatio * 100)}%`,
          width: '100%',
          borderRadius: '2px',
          background: railColor,
          opacity,
        }}
      />
      <div style={{ ...whiskerStyle, bottom: 0 }} />
    </div>
  );
}
