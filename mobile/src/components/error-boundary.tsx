import { Component, type ComponentChildren } from 'preact';

type Props = { children: ComponentChildren };
type State = { error: Error | null };

/**
 * El manejador global de errores dentro del árbol, como el de escritorio (`src/ui/error-boundary.tsx`)
 * pero con los estilos del mobile: siempre "no se puede continuar", sin retry silencioso.
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
        <main class="full">
          <h1>Ocurrió un error inesperado</h1>
          <p class="note">{error.message}</p>
          <p class="note">Recargá la página para reintentar.</p>
        </main>
      );
    }
    return this.props.children;
  }
}
