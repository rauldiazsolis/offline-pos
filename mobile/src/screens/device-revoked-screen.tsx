import { useLayoutEffect } from 'preact/hooks';
import { formatDateTime } from '../../../src/ui/format.ts';
import {
  askUnlinkTerminal,
  cancelUnlinkTerminal,
  confirmUnlinkTerminal,
  exportDeviceRevokedPending,
  loadDeviceRevokedPending,
} from '../../../src/ui/keyboard/device-revoked-controller.ts';
import {
  DEVICE_REVOKED_TITLE,
  deviceRevokedText,
  describePendingGroup,
  describeUnlink,
} from '../../../src/ui/keyboard/device-revoked-model.ts';
import { deviceRevokedScreenSignal } from '../../../src/ui/state/device-revoked-screen.ts';
import { deviceRevokedSignal } from '../../../src/ui/state/sync.ts';

/**
 * "Esta caja fue vinculada en otro dispositivo" (4.7.0, #230): la lógica es la de escritorio
 * (`device-revoked-controller.ts`); la vista, una pantalla entera con botones grandes, como
 * "Abrir una demo". Bloqueante: sin pestañas ni encabezado.
 */
export function DeviceRevokedScreen() {
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
  const pending = state.pending;
  const notSent = pending !== undefined ? describePendingGroup(pending.notSent) : undefined;
  const unconfirmed =
    pending !== undefined ? describePendingGroup(pending.sentUnconfirmed) : undefined;

  return (
    <main class="full" data-testid="device-revoked-screen">
      <h1 class="neg">{DEVICE_REVOKED_TITLE}</h1>
      <p>{deviceRevokedText(revoked.message)}</p>
      <p class="note">Desde {formatDateTime(revoked.at)}.</p>
      <div class="card" style={{ paddingBlock: '10px' }} data-testid="device-revoked-pending">
        {pending === undefined ? (
          <p class="note">Revisando lo pendiente de esta terminal…</p>
        ) : notSent === undefined && unconfirmed === undefined ? (
          <p>No hay nada pendiente: todo lo de esta terminal llegó al backend.</p>
        ) : (
          <>
            {notSent !== undefined && <p style={{ fontWeight: 700 }}>Sin enviar: {notSent}.</p>}
            {unconfirmed !== undefined && (
              <p>Enviado, sin confirmar por el backend: {unconfirmed}.</p>
            )}
          </>
        )}
      </div>
      {state.phase === 'exporting' && (
        <p class="note" role="status">
          <span class="m-spinner" /> Preparando el archivo…
        </p>
      )}
      {state.phase !== 'exporting' && state.exportedFile !== undefined && (
        <p class="note" role="status">
          Descargado: {state.exportedFile}
        </p>
      )}
      {confirming ? (
        <div class="card" style={{ borderColor: 'var(--danger)', paddingBlock: '10px' }}>
          <p style={{ fontWeight: 700 }}>{unlink.question}</p>
          {unlink.warning !== undefined && (
            <p class="neg" style={{ fontWeight: 700 }}>
              {unlink.warning}
            </p>
          )}
          {state.error !== undefined && (
            <p class="neg" role="alert">
              No se pudo desvincular: {state.error}
            </p>
          )}
          {state.phase === 'unlinking' && (
            <p class="note" role="status">
              <span class="m-spinner" /> Desvinculando…
            </p>
          )}
          <div class="stack">
            <button
              type="button"
              class="m-btn m-btn-danger m-btn-block"
              disabled={busy}
              onClick={() => void confirmUnlinkTerminal()}
            >
              Desvincular
            </button>
            <button
              type="button"
              class="m-btn m-btn-block"
              disabled={busy}
              onClick={() => {
                cancelUnlinkTerminal();
              }}
            >
              Volver
            </button>
          </div>
        </div>
      ) : (
        <div class="stack">
          <button
            type="button"
            class="m-btn m-btn-primary m-btn-block"
            disabled={busy}
            onClick={() => void exportDeviceRevokedPending()}
          >
            Exportar datos locales pendientes (.json)
          </button>
          <button
            type="button"
            class="m-btn m-btn-danger m-btn-block"
            disabled={busy}
            onClick={() => {
              askUnlinkTerminal();
            }}
          >
            Desvincular esta terminal
          </button>
        </div>
      )}
    </main>
  );
}
