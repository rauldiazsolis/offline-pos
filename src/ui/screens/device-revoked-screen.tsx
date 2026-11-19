import type { TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import { formatDateTime } from '../format.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import {
  askUnlinkTerminal,
  cancelUnlinkTerminal,
  confirmUnlinkTerminal,
  exportDeviceRevokedPending,
  loadDeviceRevokedPending,
} from '../keyboard/device-revoked-controller.ts';
import {
  DEVICE_REVOKED_TITLE,
  deviceRevokedText,
  describePendingGroup,
  describeUnlink,
} from '../keyboard/device-revoked-model.ts';
import { deviceRevokedScreenSignal } from '../state/device-revoked-screen.ts';
import { deviceRevokedSignal } from '../state/sync.ts';

const textStyle = { margin: 0 };

/** Lo pendiente, en dos grupos (sin enviar y enviado sin confirmar), o que no hay nada. */
function PendingSummary() {
  const pending = deviceRevokedScreenSignal.value.pending;
  if (pending === undefined) {
    return <p style={textStyle}>Revisando lo pendiente de esta terminal…</p>;
  }
  const notSent = describePendingGroup(pending.notSent);
  const unconfirmed = describePendingGroup(pending.sentUnconfirmed);
  return (
    <div
      data-testid="device-revoked-pending"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      {notSent === undefined && unconfirmed === undefined ? (
        <p style={textStyle}>No hay nada pendiente: todo lo de esta terminal llegó al backend.</p>
      ) : (
        <>
          {notSent !== undefined && (
            <p style={{ ...textStyle, fontWeight: 'bold' }}>Sin enviar: {notSent}.</p>
          )}
          {unconfirmed !== undefined && (
            <p style={textStyle}>Enviado, sin confirmar por el backend: {unconfirmed}.</p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * "Esta caja fue vinculada en otro dispositivo" (4.7.0, #230): bloqueante, como el modo
 * requerido de `/CONFIG`. Enter exporta lo pendiente; "Desvincular" (Alt+D, por la tecla física)
 * abre un segundo paso en la misma pantalla, donde Enter desvincula y Esc vuelve.
 */
export function DeviceRevokedScreen() {
  const containerRef = useFocusOnMount<HTMLDivElement>();
  useLayoutEffect(() => {
    void loadDeviceRevokedPending();
  }, []);
  const revoked = deviceRevokedSignal.value;
  const state = deviceRevokedScreenSignal.value;
  if (revoked === undefined) {
    return null;
  }
  const confirming = state.phase === 'confirming' || state.phase === 'unlinking';
  const busy = state.phase === 'exporting' || state.phase === 'unlinking';
  const unlink = describeUnlink(state.pending, state.exportedFile);

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    // Un botón enfocado con Tab se activa solo con Enter (nativo): no duplicar la acción.
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void (confirming ? confirmUnlinkTerminal() : exportDeviceRevokedPending());
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelUnlinkTerminal();
      return;
    }
    if (event.altKey && event.code === 'KeyD') {
      event.preventDefault();
      askUnlinkTerminal();
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onMouseDown={keepFocusOnMouseDown}
      data-testid="device-revoked-screen"
      style={{
        height: 'var(--app-height)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--color-danger)' }}>
        {DEVICE_REVOKED_TITLE}
      </h1>
      <p style={textStyle}>{deviceRevokedText(revoked.message)}</p>
      <p style={{ ...textStyle, color: 'var(--color-text-muted)' }}>
        Desde {formatDateTime(revoked.at)}.
      </p>

      <PendingSummary />

      <div style={{ minHeight: 'var(--space-8)' }} role="status">
        {state.phase === 'exporting' && <p style={textStyle}>Preparando el archivo…</p>}
        {state.phase !== 'exporting' && state.exportedFile !== undefined && (
          <p style={{ ...textStyle, color: 'var(--color-success)' }}>
            Descargado: {state.exportedFile}
          </p>
        )}
      </div>

      {confirming ? (
        <div
          style={{
            border: '1px solid var(--color-danger)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          <p style={{ ...textStyle, fontWeight: 'bold' }}>{unlink.question}</p>
          {unlink.warning !== undefined && (
            <p style={{ ...textStyle, fontWeight: 'bold', color: 'var(--color-danger)' }}>
              {unlink.warning}
            </p>
          )}
          {state.error !== undefined && (
            <p role="alert" style={{ ...textStyle, color: 'var(--color-danger)' }}>
              No se pudo desvincular: {state.error}
            </p>
          )}
          {state.phase === 'unlinking' && <p style={textStyle}>Desvinculando…</p>}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              class="btn"
              disabled={busy}
              onClick={() => {
                cancelUnlinkTerminal();
              }}
            >
              Volver (Esc)
            </button>
            <button
              type="button"
              class="btn btn-danger"
              disabled={busy}
              onClick={() => void confirmUnlinkTerminal()}
            >
              Desvincular (Enter)
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy}
            onClick={() => void exportDeviceRevokedPending()}
          >
            Exportar datos locales pendientes (.json) (Enter)
          </button>
          <button
            type="button"
            class="btn btn-danger"
            disabled={busy}
            onClick={() => {
              askUnlinkTerminal();
            }}
          >
            Desvincular esta terminal (Alt+D)
          </button>
        </div>
      )}
    </div>
  );
}
