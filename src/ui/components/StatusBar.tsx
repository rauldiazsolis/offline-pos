import { describeError } from '../errors.ts';
import { enterDiagnosticoScreen } from '../keyboard/diagnostico-controller.ts';
import { contractRequirement, MIN_BACKEND_CONTRACT } from '../../domain/contract-version.ts';
import {
  backendNoticesSignal,
  backendStatusSignal,
  demoRevokedSignal,
  lastPullApplicationSignal,
  lastSyncFailureSignal,
  lastSyncedAtSignal,
  localCatalogCountsSignal,
  pendingOutboxCountSignal,
  syncConfiguredSignal,
  syncStatusSignal,
} from '../state/sync.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { applyAppUpdate } from '../keyboard/app-update-controller.ts';
import { enterCashScreen } from '../keyboard/cash-controller.ts';
import { appUpdateSignal } from '../state/app-update.ts';
import { cashCountOverdueSignal } from '../state/cash.ts';
import { mostSevere } from '../../sync/backend-notices.ts';
import type { NoticeSeverity } from '../../sync/connector.ts';

/** Color de "Avisos (N)" según el aviso más grave (4.4.0, #128). */
const NOTICE_COLOR: Record<NoticeSeverity, string> = {
  critical: 'var(--color-danger)',
  warning: 'var(--color-chrome-warning)',
  info: 'var(--color-chrome-text-muted)',
};

/**
 * Barra de estado, al pie de la venta, debajo de la barra de comandos (#193; antes estaba arriba,
 * en el extremo opuesto). Hasta la Etapa 2
 * de #94 era a propósito no interactiva; desde ahí un click abre
 * `/DIAGNOSTICO` — lo mismo que el comando, patrón teclado + mouse (ver
 * "Teclado y mouse" en AGENTS.md). No entra en el orden de Tab: el teclado
 * sigue llegando por `/DIAGNOSTICO`, y el click no le saca el foco a la barra
 * de comandos (`keepFocusOnMouseDown` en la pantalla de venta). Lee solo los signals de
 * `state/sync.ts` — no toca `navigator.onLine` directo, eso ya lo resuelve
 * `sync/engine.ts`. Los 4 textos son los de §7 del doc de diseño.
 *
 * A la derecha, independiente del estado de sync y de la conectividad, el aviso "Sin arqueo en
 * 24 h" (Etapa 5 de #94, #100): un botón que abre `/CAJA` en Arqueo sin abrir `/DIAGNOSTICO` y
 * sin sacarle el foco a la barra de comandos. Antes, "Avisos (N)" (4.4.0, #128): los avisos
 * vigentes del backend, con el color del más grave; el click abre `/DIAGNOSTICO`. Nunca bloquean.
 * Primero de todos, "Versión nueva (/ACTUALIZAR)" (#54) cuando el service worker ya descargó una:
 * el click la aplica como el comando ("Actualizando…" y deshabilitado mientras tanto).
 * Con la demo revocada (#176), el estado dice "La demo terminó". La marca DEMO y el botón de la
 * demo viven en el encabezado (`TerminalHeader.tsx`, #193).
 */
/** Color del punto de estado — misma info que el texto, reforzada visualmente (pase de diseño). */
function statusColor(): string {
  const status = syncStatusSignal.value;
  if (!syncConfiguredSignal.value || status === 'offline') {
    return 'var(--color-chrome-text-muted)';
  }
  if (demoRevokedSignal.value !== null) {
    return 'var(--color-danger)';
  }
  const backend = backendStatusSignal.value;
  if (backend.kind === 'incompatible') {
    return 'var(--color-danger)';
  }
  if (backend.kind === 'maintenance') {
    return 'var(--color-chrome-warning)';
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
  // #176: el sync ya no corre; la barra ofrece una demo nueva.
  if (demoRevokedSignal.value !== null) {
    return 'La demo terminó';
  }
  // 4.0.0 (#99): detrás de "sin configurar" y de offline, delante del resto. La venta sigue.
  const backend = backendStatusSignal.value;
  if (backend.kind === 'incompatible') {
    return `Backend incompatible (contrato ${backend.backendVersion}, se necesita ${contractRequirement(MIN_BACKEND_CONTRACT)})`;
  }
  if (backend.kind === 'maintenance') {
    return backend.info.message !== undefined
      ? `Backend en mantenimiento: ${backend.info.message}`
      : 'Backend en mantenimiento';
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
  const noticeColor = NOTICE_COLOR[mostSevere(backendNoticesSignal.value) ?? 'info'];
  return (
    <div
      class="status-bar"
      title="Ver diagnóstico de sincronización (/DIAGNOSTICO)"
      onClick={enterDiagnosticoScreen}
      style={{
        padding: 'var(--space-2) var(--space-3)',
        color: 'var(--color-chrome-text-muted)',
        fontSize: 'var(--font-size-sm)',
        background: 'var(--color-chrome-bg)',
        borderTop: '2px solid var(--color-chrome-border)',
      }}
    >
      <div
        data-testid="status-bar-sync"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
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

        {/* Los botones nunca parten su etiqueta (#111): si falta lugar, se parte el estado de la izquierda. */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {appUpdateSignal.value !== 'none' && (
            <button
              type="button"
              tabIndex={-1}
              class="btn-primary"
              disabled={appUpdateSignal.value === 'applying'}
              onMouseDown={keepFocusOnMouseDown}
              onClick={(event) => {
                event.stopPropagation();
                void applyAppUpdate();
              }}
              title="Aplicar la versión nueva del POS (/ACTUALIZAR)"
              style={{
                border: '1px solid var(--color-accent)',
                borderRadius: 'var(--radius-sm, 6px)',
                padding: '2px 8px',
                fontSize: 'var(--font-size-sm)',
                cursor: 'pointer',
              }}
            >
              {appUpdateSignal.value === 'applying' ? 'Actualizando…' : 'Versión nueva (/ACTUALIZAR)'}
            </button>
          )}
          {backendNoticesSignal.value.length > 0 && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={keepFocusOnMouseDown}
              onClick={(event) => {
                event.stopPropagation();
                enterDiagnosticoScreen();
              }}
              title="Ver los avisos del backend (/DIAGNOSTICO)"
              style={{
                background: 'transparent',
                color: noticeColor,
                border: `1px solid ${noticeColor}`,
                borderRadius: 'var(--radius-sm, 6px)',
                padding: '2px 8px',
                fontSize: 'var(--font-size-sm)',
                cursor: 'pointer',
              }}
            >
              Avisos ({String(backendNoticesSignal.value.length)})
            </button>
          )}
          {cashCountOverdueSignal.value && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={keepFocusOnMouseDown}
              onClick={(event) => {
                event.stopPropagation();
                enterCashScreen('count');
              }}
              title="Hacer un arqueo (/CAJA)"
              style={{
                background: 'transparent',
                color: 'var(--color-chrome-warning)',
                border: '1px solid var(--color-chrome-warning)',
                borderRadius: 'var(--radius-sm, 6px)',
                padding: '2px 8px',
                fontSize: 'var(--font-size-sm)',
                cursor: 'pointer',
              }}
            >
              Sin arqueo en 24 h
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
