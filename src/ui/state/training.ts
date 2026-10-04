import { signal } from '@preact/signals';
import type { TrainingDiscard } from '../keyboard/training-model.ts';

/**
 * La pantalla de entrenamiento (#177): `null` = cerrada. Al entrar: `checking` (cuenta lo
 * pendiente), `ready` y `starting` (envía lo real, copia y recarga). Al salir: `ready` y `leaving`
 * (borra las claves y recarga). `App` la muestra delante de la pantalla activa.
 */
export type TrainingScreenState =
  /** `pending`: lo real sin enviar, ya redactado (`describeTrainingPending`); ausente si no hay. */
  | { mode: 'enter'; phase: 'checking' | 'ready' | 'starting'; pending?: string }
  | { mode: 'exit'; phase: 'ready' | 'leaving'; discard: TrainingDiscard };

export const trainingScreenSignal = signal<TrainingScreenState | null>(null);
