import { db } from '../../storage/db.ts';
import { summarizeLocalData, type LocalDataSummary } from '../../storage/local-data.ts';
import { STORAGE_NAMESPACE, storageKey } from '../../storage/storage-namespace.ts';
import {
  clearTrainingKeys,
  copyOperationalStateToTraining,
  prepareTrainingDatabase,
} from '../../storage/training-copy.ts';
import {
  TRAINING_MARK_KEY,
  isTrainingMode,
  trainingDatabaseName,
} from '../../storage/training-mode.ts';
import { flushPendingBeforeWipe } from '../../sync/apply-connection.ts';
import { loadSyncConfig } from '../../sync/config.ts';
import { runPushThenPull } from '../../sync/engine.ts';
import { commandBarWarningSignal } from '../state/command-bar.ts';
import { setSyncPaused } from '../state/sync.ts';
import { trainingScreenSignal } from '../state/training.ts';
import { RELEASE_WAIT_MS } from '../tab-leadership.ts';
import { prepareTabRelease } from '../tab-release.ts';
import { saleInProgress } from './app-update-controller.ts';
import { describeTrainingDiscard } from './training-model.ts';

/** "Saliste del entrenamiento." después de la recarga: de esta pestaña, sobrevive a su reload. */
export const TRAINING_EXITED_KEY = storageKey('training-exited');

export type TrainingDeps = {
  hasSaleInProgress: () => boolean;
  summarize: () => Promise<LocalDataSummary>;
  /** Clientes dados de alta en esta base (su evento `customer` en el outbox). */
  countCreatedCustomers: () => Promise<number>;
  /** Último envío de lo real pendiente, como "Borrar" en `/CONFIG`; sin red no hace nada. */
  flushReal: () => Promise<void>;
  /** Copia lo maestro a la base de entrenamiento y los cursores a sus claves. */
  prepareTrainingData: () => Promise<void>;
  writeMark: (startedAt: string) => void;
  clearTraining: () => void;
  noteExited: () => void;
  pauseSync: () => void;
  resumeSync: () => void;
  prepareRelease: (timeoutMs: number) => Promise<() => void>;
  reload: () => void;
  now: () => string;
};

const browserDeps: TrainingDeps = {
  hasSaleInProgress: saleInProgress,
  summarize: summarizeLocalData,
  countCreatedCustomers: () => db.outbox.filter((event) => event.type === 'customer').count(),
  flushReal: async () => {
    const config = loadSyncConfig();
    if (config.ok && navigator.onLine) {
      await flushPendingBeforeWipe(config.value);
    }
  },
  prepareTrainingData: async () => {
    await prepareTrainingDatabase(db, trainingDatabaseName(STORAGE_NAMESPACE));
    copyOperationalStateToTraining();
  },
  writeMark: (startedAt) => {
    localStorage.setItem(TRAINING_MARK_KEY, JSON.stringify({ startedAt }));
  },
  clearTraining: () => {
    clearTrainingKeys();
  },
  noteExited: () => {
    try {
      sessionStorage.setItem(TRAINING_EXITED_KEY, '1');
    } catch {
      // Sin `sessionStorage` solo se pierde el aviso.
    }
  },
  pauseSync: () => {
    setSyncPaused(true);
  },
  resumeSync: () => {
    setSyncPaused(false);
    void runPushThenPull();
  },
  prepareRelease: prepareTabRelease,
  reload: () => {
    window.location.reload();
  },
  now: () => new Date().toISOString(),
};

/** Lee y borra el aviso de salida (lo muestra `bootstrap` una sola vez). */
export function consumeTrainingExited(): boolean {
  try {
    const exited = sessionStorage.getItem(TRAINING_EXITED_KEY) !== null;
    sessionStorage.removeItem(TRAINING_EXITED_KEY);
    return exited;
  } catch {
    return false;
  }
}

/**
 * `/ENTRENAMIENTO` y el botón de la franja (#177). Apagado, abre "Entrar al entrenamiento" (nunca con
 * una venta en curso); prendido, "Salir del entrenamiento" con lo que se descarta (salir con una
 * venta de práctica a medias sí se puede: se descarta). Mientras la pantalla está abierta el sync
 * queda pausado, como en "Abrir una demo".
 */
export async function toggleTraining(deps: TrainingDeps = browserDeps): Promise<void> {
  if (trainingScreenSignal.value !== null) {
    return;
  }
  if (!isTrainingMode() && deps.hasSaleInProgress()) {
    commandBarWarningSignal.value = 'Terminá o descartá la venta para entrar al entrenamiento.';
    return;
  }
  deps.pauseSync();
  if (isTrainingMode()) {
    // La pantalla aparece recién con los conteos: contar la base local es inmediato.
    const [summary, createdCustomers] = await Promise.all([
      deps.summarize(),
      deps.countCreatedCustomers(),
    ]);
    trainingScreenSignal.value = {
      mode: 'exit',
      phase: 'ready',
      discard: describeTrainingDiscard(summary, createdCustomers),
    };
    return;
  }
  trainingScreenSignal.value = { mode: 'enter', phase: 'checking', pending: 0 };
  const summary = await deps.summarize();
  trainingScreenSignal.value = { mode: 'enter', phase: 'ready', pending: summary.pendingOutbox };
}

/** Esc, "Cancelar" o "Seguir entrenando": no toca nada. */
export function cancelTraining(deps: TrainingDeps = browserDeps): void {
  if (trainingScreenSignal.value?.phase !== 'ready') {
    return;
  }
  trainingScreenSignal.value = null;
  deps.resumeSync();
}

/** Enter: entra (envía lo real, copia, marca) o sale (borra las claves); en los dos, recarga. */
export async function confirmTraining(deps: TrainingDeps = browserDeps): Promise<void> {
  const current = trainingScreenSignal.value;
  if (current?.phase !== 'ready') {
    return;
  }
  if (current.mode === 'enter') {
    trainingScreenSignal.value = { ...current, phase: 'starting' };
    try {
      await deps.flushReal();
    } catch {
      // Sin red o con el backend caído se entra igual: lo real sale al terminar el entrenamiento.
    }
    await deps.prepareTrainingData();
    deps.writeMark(deps.now());
  } else {
    trainingScreenSignal.value = { ...current, phase: 'leaving' };
    deps.clearTraining();
    deps.noteExited();
  }
  // Como /ACTUALIZAR: termina el sync y las escrituras en curso antes de recargar.
  await deps.prepareRelease(RELEASE_WAIT_MS);
  deps.reload();
}
