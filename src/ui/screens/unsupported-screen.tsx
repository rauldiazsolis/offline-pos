import { MIN_SUPPORTED_WIDTH_PX } from '../state/viewport.ts';

/**
 * Por debajo de `MIN_SUPPORTED_WIDTH_PX` (Ciclo 8), reemplaza a toda la app
 * — a esa altura, seguir zoomeando `.app-zoom-wrapper` (`tokens.css`)
 * dejaría el contenido ilegible en vez de solo chico. Fuera del wrapper
 * zoomeado a propósito (`ui/app.tsx`): tiene que ocupar el ancho real de la
 * ventana, angosta como sea, no el ancho lógico de diseño (1024px).
 */
export function UnsupportedScreen() {
  return (
    <div
      style={{
        height: '100svh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        textAlign: 'center',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Pantalla no compatible</h1>
      <p style={{ margin: 0, color: 'var(--color-text-muted)', maxWidth: '360px' }}>
        Esta aplicación necesita una ventana de al menos {MIN_SUPPORTED_WIDTH_PX}px de ancho.
        Agrandá la ventana o usá un dispositivo con una pantalla más grande.
      </p>
    </div>
  );
}
