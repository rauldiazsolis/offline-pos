import { signal } from '@preact/signals';

/**
 * Ancho mínimo soportado (Ciclo 8) — por debajo de esto, `App` muestra
 * `UnsupportedScreen` en vez de seguir zoomeando el contenido (quedaría
 * ilegible). Tiene que coincidir con `--app-min-width` en `tokens.css` —
 * mismo criterio de "una sola fuente de verdad, sincronizada a mano" que ya
 * usa `--cart-table-head-h` (`cart-view.css`): no hay forma barata de leer
 * un custom property de CSS desde acá en los tests, que corren sin la hoja
 * de estilos real cargada.
 */
export const MIN_SUPPORTED_WIDTH_PX = 600;

/** Ancho de ventana en vivo — `App` lo compara contra `MIN_SUPPORTED_WIDTH_PX`. */
export const viewportWidthSignal = signal(window.innerWidth);

/**
 * `ResizeObserver` sobre `document.documentElement`, no
 * `window.addEventListener('resize', ...)` (primera versión) — mismo
 * criterio que `ui/hooks/use-scroll-indicator.ts`, que ya usa
 * `ResizeObserver` en vez de un listener suelto por la misma razón: seguir
 * el tamaño real que el navegador termina renderizando, no depender de
 * cuándo (o si) se dispara el evento `resize`. Bug real reportado por el
 * usuario: en el modo "Responsive" de Chrome DevTools, arrastrar el handle
 * de resize dejaba `window.innerWidth` desactualizado durante buena parte
 * del arrastre — el aviso de ancho mínimo (`MIN_SUPPORTED_WIDTH_PX`) recién
 * aparecía muy por debajo de los 600px reales, no exactamente ahí.
 * `ResizeObserver` está atado al pipeline de layout del navegador en vez de
 * a un evento, así que sigue el tamaño emulado con más precisión durante un
 * resize interactivo. Único lugar de la app que rastrea el tamaño del
 * viewport — mismo criterio que `navigator.onLine` en `sync/engine.ts`: un
 * solo punto, no repetido por la UI. Se llama una vez desde `main.tsx`.
 */
export function startViewportTracking(): void {
  const observer = new ResizeObserver(() => {
    viewportWidthSignal.value = window.innerWidth;
  });
  observer.observe(document.documentElement);
}
