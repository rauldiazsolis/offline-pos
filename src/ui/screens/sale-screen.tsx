import { CartView } from '../components/CartView.tsx';
import { CommandBarInput } from '../components/CommandBarInput.tsx';
import { StatusBar } from '../components/StatusBar.tsx';

/**
 * Pantalla de venta: barra de comandos arriba (siempre enfocada, "chrome"
 * oscuro), carrito en el medio (contenido claro), barra de estado abajo
 * (extremo opuesto, "chrome" oscuro) — ver "UX keyboard-first" en CLAUDE.md.
 */
export function SaleScreen() {
  return (
    <div
      style={{
        minHeight: '100svh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <header
        style={{
          padding: 'var(--space-3)',
          background: 'var(--color-chrome-bg)',
          borderBottom: '2px solid var(--color-chrome-border)',
        }}
      >
        <CommandBarInput />
      </header>
      <main style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)' }}>
        <CartView />
      </main>
      <StatusBar />
    </div>
  );
}
