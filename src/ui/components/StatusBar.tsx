/**
 * Barra de estado (extremo opuesto a la barra de comandos, nunca interactiva
 * — ver "UX keyboard-first" en CLAUDE.md). Fase 1 no tiene sync todavía, así
 * que siempre muestra "Offline"; Fase 2 reemplaza el contenido de este mismo
 * componente por `navigator.onLine` + conteo de `outbox`, sin tocar el
 * layout de la pantalla de venta.
 */
export function StatusBar() {
  return (
    <div
      style={{
        padding: 'var(--space-2) var(--space-3)',
        color: 'var(--color-text-muted)',
        fontSize: 'var(--font-size-base)',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      Offline
    </div>
  );
}
