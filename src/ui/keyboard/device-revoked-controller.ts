import type { Result } from '../../domain/result.ts';
import { buildPendingExportFile, type PendingExportFile } from '../../sync/pending-export.ts';
import { unlinkTerminal } from '../../sync/unlink-terminal.ts';
import { downloadPendingFile, reloadPage } from '../device-revoked-browser.ts';
import { describeError } from '../errors.ts';
import {
  deviceRevokedScreenSignal,
  type DeviceRevokedPending,
} from '../state/device-revoked-screen.ts';

/**
 * "Esta caja fue vinculada en otro dispositivo" (4.7.0, #230): la lógica de la pantalla, la misma
 * para escritorio y celular. Dos salidas: bajar lo pendiente en un `.json` y desvincular la
 * terminal (con un segundo paso de confirmación). El sync ya está cortado por la marca
 * (`sync/device-revoked.ts`): acá no se dispara ningún ciclo.
 */
export type DeviceRevokedDeps = {
  buildFile: () => Promise<PendingExportFile>;
  download: (file: PendingExportFile) => void;
  unlink: () => Promise<Result<void>>;
  /**
   * Después de desvincular, recargar: el arranque encuentra la terminal sin configurar y abre
   * `/CONFIG` en modo requerido, con todo el estado en memoria (venta en curso, cliente,
   * movimientos, guía) vuelto a leer de la base vacía.
   */
  reload: () => void;
};

const browserDeps: DeviceRevokedDeps = {
  buildFile: () => buildPendingExportFile(),
  download: downloadPendingFile,
  unlink: unlinkTerminal,
  reload: reloadPage,
};

function pendingOf(file: PendingExportFile): DeviceRevokedPending {
  return { notSent: file.data.notSent.summary, sentUnconfirmed: file.data.sentUnconfirmed.summary };
}

/**
 * Al montar la pantalla: vuelve al primer paso (síncrono, antes del `await`) y cuenta lo
 * pendiente. Conserva el archivo ya bajado en esta sesión.
 */
export async function loadDeviceRevokedPending(
  deps: DeviceRevokedDeps = browserDeps,
): Promise<void> {
  const { exportedFile } = deviceRevokedScreenSignal.value;
  deviceRevokedScreenSignal.value = {
    phase: 'idle',
    ...(exportedFile !== undefined ? { exportedFile } : {}),
  };
  const file = await deps.buildFile();
  deviceRevokedScreenSignal.value = {
    ...deviceRevokedScreenSignal.value,
    pending: pendingOf(file),
  };
}

/** Enter o "Exportar datos locales pendientes (.json)": arma el archivo y lo baja. */
export async function exportDeviceRevokedPending(
  deps: DeviceRevokedDeps = browserDeps,
): Promise<void> {
  const current = deviceRevokedScreenSignal.value;
  if (current.phase !== 'idle') {
    return;
  }
  deviceRevokedScreenSignal.value = { ...current, phase: 'exporting' };
  const file = await deps.buildFile();
  deps.download(file);
  deviceRevokedScreenSignal.value = {
    phase: 'idle',
    pending: pendingOf(file),
    exportedFile: file.fileName,
  };
}

/** "Desvincular esta terminal": abre el segundo paso. */
export function askUnlinkTerminal(): void {
  const current = deviceRevokedScreenSignal.value;
  if (current.phase !== 'idle') {
    return;
  }
  const { error: _error, ...rest } = current;
  deviceRevokedScreenSignal.value = { ...rest, phase: 'confirming' };
}

/** Esc o "Volver" en el segundo paso. */
export function cancelUnlinkTerminal(): void {
  const current = deviceRevokedScreenSignal.value;
  if (current.phase !== 'confirming') {
    return;
  }
  const { error: _error, ...rest } = current;
  deviceRevokedScreenSignal.value = { ...rest, phase: 'idle' };
}

/** Enter o "Desvincular" en el segundo paso. Con un error, se queda ahí y lo muestra. */
export async function confirmUnlinkTerminal(deps: DeviceRevokedDeps = browserDeps): Promise<void> {
  const current = deviceRevokedScreenSignal.value;
  if (current.phase !== 'confirming') {
    return;
  }
  const { error: _error, ...rest } = current;
  deviceRevokedScreenSignal.value = { ...rest, phase: 'unlinking' };
  const result = await deps.unlink();
  if (result.ok) {
    deps.reload();
    return;
  }
  deviceRevokedScreenSignal.value = { ...rest, phase: 'confirming', error: describeError(result) };
}
