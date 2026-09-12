import { Component, type ComponentChildren } from 'preact';

type Props = { children: ComponentChildren };
type State = { error: Error | null };

/**
 * Manejador global de errores que ocurren dentro del árbol de componentes
 * (ver "Manejo de errores" en CLAUDE.md) — lo que pasa fuera del árbol
 * (bootstrap, listeners) lo cubre `fatal-error.ts`. Por ahora siempre
 * decide "no se puede continuar", sin intento de retry silencioso.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static override getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override render() {
    const { error } = this.state;
    if (error) {
      return (
        <main
          style={{
            minHeight: '100svh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-2)',
            textAlign: 'center',
            padding: 'var(--space-4)',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>
            Ocurrió un error inesperado
          </h1>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{error.message}</p>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            Recargá la página para reintentar.
          </p>
        </main>
      );
    }
    return this.props.children;
  }
}
