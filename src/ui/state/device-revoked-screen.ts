import { signal } from '@preact/signals';
import type { PendingExportSummary } from '../../sync/pending-export.ts';

/** Los resúmenes de lo pendiente que muestra la pantalla (los de `buildPendingExportFile`). */
export type DeviceRevokedPending = {
  notSent: PendingExportSummary;
  sentUnconfirmed: PendingExportSummary;
};

/**
 * La pantalla "Esta caja fue vinculada en otro dispositivo" (4.7.0, #230). Se muestra mientras
 * `deviceRevokedSignal` tenga la marca (fuera del entrenamiento); esto es solo su estado propio:
 * - `idle`: las dos opciones; `exporting`, armando y bajando el archivo.
 * - `confirming`: el segundo paso de "Desvincular"; `unlinking`, borrando.
 * `pending` es `undefined` mientras se cuenta. `exportedFile`, el último archivo bajado en esta
 * sesión. `error`, el de desvincular, ya traducido.
 */
export type DeviceRevokedScreenState = {
  phase: 'idle' | 'exporting' | 'confirming' | 'unlinking';
  pending?: DeviceRevokedPending;
  exportedFile?: string;
  error?: string;
};

export const deviceRevokedScreenSignal = signal<DeviceRevokedScreenState>({ phase: 'idle' });
