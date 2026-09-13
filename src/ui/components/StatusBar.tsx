import {
  lastSyncedAtSignal,
  pendingOutboxCountSignal,
  syncConfiguredSignal,
  syncStatusSignal,
} from '../state/sync.ts';

/**
 * Barra de estado (extremo opuesto a la barra de comandos, nunca interactiva
 * — ver "UX keyboard-first" en CLAUDE.md). Lee solo los signals de
 * `state/sync.ts` — no toca `navigator.onLine` directo, eso ya lo resuelve
 * `sync/engine.ts`. Los 4 textos son los de §7 del doc de diseño.
 */
function statusText(): string {
  const status = syncStatusSignal.value;
  const pending = pendingOutboxCountSignal.value;

  if (status === 'offline') {
    return `Sin conexión (${String(pending)})`;
  }
  if (!syncConfiguredSignal.value) {
    return 'Sin configurar — /CONFIG';
  }
  if (status === 'syncing') {
    return `Sincronizando (${String(pending)})`;
  }
  if (status === 'sync-error') {
    return 'Problema de sincronización';
  }

  const lastSyncedAt = lastSyncedAtSignal.value;
  return lastSyncedAt !== null
    ? `Sincronizado (${new Date(lastSyncedAt).toLocaleTimeString()})`
    : 'Sincronizado';
}

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
      {statusText()}
    </div>
  );
}
