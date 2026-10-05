import { z } from 'zod';
import { storageKey } from './storage-namespace.ts';

/**
 * Modo entrenamiento (#177): con la marca prendida la app abre una base de Dexie aparte y el motor
 * nunca empuja. Se lee **una vez al cargar**, como `STORAGE_NAMESPACE`: entrar y salir recargan.
 */
export type TrainingMark = { startedAt: string };

export const TRAINING_MARK_KEY = storageKey('training');
/** Prefijo de las claves operativas del entrenamiento: se borran todas al salir. */
export const TRAINING_KEY_PREFIX = storageKey('training:');

const trainingMarkSchema = z.object({ startedAt: z.iso.datetime() });

/** La marca guardada; ausente, ilegible o con otra forma cuenta como apagada. */
export function readTrainingMark(
  storage: Pick<Storage, 'getItem'> = localStorage,
): TrainingMark | null {
  try {
    const raw = storage.getItem(TRAINING_MARK_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = trainingMarkSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

let current: TrainingMark | null = readTrainingMark();

export function trainingMark(): TrainingMark | null {
  return current;
}

export function isTrainingMode(): boolean {
  return current !== null;
}

export function setTrainingModeForTests(mark: TrainingMark | null): void {
  current = mark;
}

export function trainingDatabaseName(namespace: string): string {
  return `${namespace}#entrenamiento`;
}

/** Estado operativo del motor que no se puede mezclar con el real (cursores, lotes, contadores). */
export function operationalKeyFor(name: string, training: boolean): string {
  return training ? storageKey(`training:${name}`) : storageKey(name);
}

/** La clave operativa en el modo con que cargó la página. */
export function operationalKey(name: string): string {
  return operationalKeyFor(name, isTrainingMode());
}
