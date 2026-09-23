import { CartView } from '../components/CartView.tsx';
import { CommandBarInput } from '../components/CommandBarInput.tsx';
import { StatusBar } from '../components/StatusBar.tsx';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { dismissCommandBarOverlay } from '../keyboard/command-bar-controller.ts';

/**
 * Teclado + mouse (Etapa 2 de #94): ningún click le saca el foco a la barra
 * de comandos, y un click fuera del overlay lo cierra como Esc (#28), sin
 * tocar lo tipeado. Solo el botón izquierdo: rueda y autoscroll siguen.
 */
function handleMouseDown(event: MouseEvent): void {
  keepFocusOnMouseDown(event);
  if (event.button !== 0) {
    return;
  }
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest('[data-command-bar-overlay], .command-bar-input') === null
  ) {
    dismissCommandBarOverlay();
  }
}

/**
 * Pantalla de venta: barra de estado arriba (info pasiva, "chrome" oscuro),
 * carrito en el medio (contenido claro, único que hace scroll — ver
 * `height`+`overflow` de abajo), barra de comandos abajo (siempre enfocada,
 * "chrome" oscuro) — ver "UX keyboard-first" en CLAUDE.md.
 *
 * El input queda cerca de las manos y de donde aparece la línea nueva
 * (`addProductLine` siempre agrega al final del carrito, o sea justo arriba
 * del input) — decisión tomada con el usuario tras comparar ambos extremos;
 * antes del pase de diseño estaba arriba. El menú de comandos/resultados
 * (`CommandBarInput.tsx`) se abre hacia arriba como overlay en vez de
 * empujar el carrito — de paso resuelve la inestabilidad de layout que
 * causaba estar en flujo normal.
 *
 * `height: 'var(--app-height)'` + `overflow: 'hidden'` en la raíz (no
 * `minHeight`): con `min-height` nada le pone un techo real a este
 * contenedor, así que un carrito largo hacía crecer el documento entero y el
 * header/footer se desplazaban con el scroll de la página en vez de quedar
 * fijos. `--app-height` (`tokens.css`, Ciclo 8) es `100svh` ya compensado
 * para el `zoom` responsive de `.app-zoom-wrapper` — usarlo acá en vez de
 * `100svh` directo es lo que hace que la pantalla siga ocupando el alto
 * real de la ventana en anchos angostos, en vez de quedar más baja que la
 * ventana.
 *
 * `<main>` ya no scrollea directo (issue #18): el único sector con scroll
 * de la pantalla principal es la lista de artículos, dentro de `CartView`
 * — Cliente/Total quedan fijos. Por eso `overflow: 'hidden'` +
 * `minHeight: 0` acá también (mismo motivo que en la raíz): sin el
 * `minHeight: 0`, este contenedor flex crecería con el contenido en vez de
 * dejar que el scroll real, un nivel más adentro, se haga cargo.
 */
export function SaleScreen() {
  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        height: 'var(--app-height)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <StatusBar />
      <main style={{ flex: 1, overflow: 'hidden', minHeight: 0, padding: 'var(--space-3)' }}>
        <CartView />
      </main>
      <footer
        style={{
          position: 'relative',
          padding: 'var(--space-3)',
          background: 'var(--color-chrome-bg)',
          borderTop: '2px solid var(--color-chrome-border)',
        }}
      >
        <CommandBarInput />
      </footer>
    </div>
  );
}
