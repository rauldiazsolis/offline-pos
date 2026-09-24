import { describeError } from '../errors.ts';
import { enterDiagnosticoScreen } from '../keyboard/diagnostico-controller.ts';
import {
  lastPullApplicationSignal,
  lastSyncFailureSignal,
  lastSyncedAtSignal,
  localCatalogCountsSignal,
  pendingOutboxCountSignal,
  syncConfiguredSignal,
  syncStatusSignal,
} from '../state/sync.ts';

/**
 * Barra de estado (extremo opuesto a la barra de comandos). Hasta la Etapa 2
 * de #94 era a propósito no interactiva; desde ahí un click abre
 * `/DIAGNOSTICO` — lo mismo que el comando, patrón teclado + mouse (ver
 * "Teclado y mouse" en CLAUDE.md). No entra en el orden de Tab: el teclado
 * sigue llegando por `/DIAGNOSTICO`, y el click no le saca el foco a la barra
 * de comandos (`keepFocusOnMouseDown` en la pantalla de venta). Lee solo los signals de
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
    const failure = lastSyncFailureSignal.value;
    const lastSyncedAt = lastSyncedAtSignal.value;
    const base =
      failure !== null
        ? `Problema de sincronización: ${describeError(failure)}`
        : 'Problema de sincronización';
    return lastSyncedAt !== null
      ? `${base} · última sync OK ${new Date(lastSyncedAt).toLocaleTimeString()}`
      : base;
  }

  const lastSyncedAt = lastSyncedAtSignal.value;
  const synced =
    lastSyncedAt !== null
      ? `Sincronizado (${new Date(lastSyncedAt).toLocaleTimeString()})`
      : 'Sincronizado';
  const counts = localCatalogCountsSignal.value;
  const base =
    counts !== null
      ? `${synced} · ${String(counts.products)} productos · ${String(counts.customers)} clientes`
      : synced;
  // Un pull que retuvo stock y saldos no es un error (#98): solo se avisa.
  return lastPullApplicationSignal.value?.kind === 'retained'
    ? `${base} · stock y saldos en espera del backend`
    : base;
}

export function StatusBar() {
  return (
    <div
      class="status-bar"
      title="Ver diagnóstico de sincronización (/DIAGNOSTICO)"
      onClick={enterDiagnosticoScreen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        color: 'var(--color-chrome-text-muted)',
        fontSize: 'var(--font-size-sm)',
        background: 'var(--color-chrome-bg)',
        borderBottom: '2px solid var(--color-chrome-border)',
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
