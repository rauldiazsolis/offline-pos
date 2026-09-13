import { CartView } from '../components/CartView.tsx';
import { CommandBarInput } from '../components/CommandBarInput.tsx';
import { StatusBar } from '../components/StatusBar.tsx';
import { attachedCustomerSignal } from '../state/customer.ts';

/**
 * Pantalla de venta: barra de comandos arriba (siempre enfocada), carrito en
 * el medio, barra de estado abajo (extremo opuesto, ver "UX keyboard-first"
 * en CLAUDE.md).
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
      <header style={{ padding: 'var(--space-3)' }}>
        <CommandBarInput />
      </header>
      <main style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-3)' }}>
        {attachedCustomerSignal.value !== undefined && (
          <p style={{ margin: '0 0 var(--space-2)', color: 'var(--color-text-muted)' }}>
            Cliente: {attachedCustomerSignal.value.name}
          </p>
        )}
        <CartView />
      </main>
      <StatusBar />
    </div>
  );
}
