import './tokens.css';

/**
 * Placeholder de Fase 0: confirma que el pipeline (Vite + Preact + tokens
 * CSS) funciona de punta a punta. Se reemplaza por la pantalla de venta en
 * Fase 1 — ver CLAUDE.md.
 */
export function App() {
  return (
    <main
      style={{
        minHeight: '100svh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <h1 style={{ fontSize: 'var(--font-size-xl)', margin: 0 }}>offline-pos</h1>
      <p style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-text-muted)', margin: 0 }}>
        Fase 0 — base del proyecto
      </p>
    </main>
  );
}
