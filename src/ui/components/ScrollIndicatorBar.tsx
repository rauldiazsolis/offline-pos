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
 */
export function ScrollIndicatorBar({
  thumb,
  variant,
}: {
  thumb: ScrollThumb;
  variant: 'light' | 'dark';
}): JSX.Element | null {
  if (!thumb.visible) {
    return null;
  }
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: '4px',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: `${String(thumb.topRatio * 100)}%`,
          height: `${String(thumb.sizeRatio * 100)}%`,
          width: '100%',
          borderRadius: '2px',
          background: variant === 'light' ? 'var(--color-border)' : 'var(--color-chrome-border)',
          opacity: variant === 'light' ? 1 : 0.6,
        }}
      />
    </div>
  );
}
