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
/** Color del punto de estado — misma info que el texto, reforzada visualmente (pase de diseño). */
function statusColor(): string {
  const status = syncStatusSignal.value;
  if (!syncConfiguredSignal.value || status === 'offline') {
    return 'var(--color-chrome-text-muted)';
  }
  if (status === 'syncing') {
    return 'var(--color-accent)';
  }
  if (status === 'sync-error') {
    return 'var(--color-danger)';
  }
  return 'var(--color-success)';
}

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
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        color: 'var(--color-chrome-text-muted)',
        fontSize: 'var(--font-size-sm)',
        background: 'var(--color-chrome-bg)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: statusColor(),
          flexShrink: 0,
        }}
      />
      {statusText()}
    </div>
  );
}
