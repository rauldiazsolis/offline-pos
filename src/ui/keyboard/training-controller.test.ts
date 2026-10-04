import { afterEach, describe, expect, it } from 'vitest';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import { setTrainingModeForTests } from '../../storage/training-mode.ts';
import { commandBarWarningSignal } from '../state/command-bar.ts';
import { trainingScreenSignal } from '../state/training.ts';
import {
  cancelTraining,
  confirmTraining,
  toggleTraining,
  type TrainingDeps,
} from './training-controller.ts';

const now = '2026-10-04T12:00:00.000Z';

const summary: LocalDataSummary = {
  products: 1,
  customers: 1,
  sales: 2,
  cashMovements: 0,
  cashCounts: 0,
  customerPayments: 0,
  pendingOutbox: 3,
  pendingSales: 2,
  draftCartLines: 0,
};

function fakeDeps(overrides: Partial<TrainingDeps> = {}): TrainingDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    hasSaleInProgress: () => false,
    summarize: () => Promise.resolve(summary),
    countCreatedCustomers: () => Promise.resolve(0),
    flushReal: () => {
      calls.push('flush');
      return Promise.resolve();
    },
    prepareTrainingData: () => {
      calls.push('copy');
      return Promise.resolve();
    },
    writeMark: (startedAt) => {
      calls.push(`mark ${startedAt}`);
    },
    clearTraining: () => {
      calls.push('clear');
    },
    noteExited: () => {
      calls.push('exited');
    },
    pauseSync: () => {
      calls.push('pause');
    },
    resumeSync: () => {
      calls.push('resume');
    },
    prepareRelease: () => {
      calls.push('release');
      return Promise.resolve(() => undefined);
    },
    reload: () => {
      calls.push('reload');
    },
    now: () => now,
    ...overrides,
  };
}

afterEach(() => {
  setTrainingModeForTests(null);
  trainingScreenSignal.value = null;
  commandBarWarningSignal.value = null;
});

describe('entrar al entrenamiento (#177)', () => {
  it('con una venta en curso no entra y avisa', async () => {
    const deps = fakeDeps({ hasSaleInProgress: () => true });

    await toggleTraining(deps);

    expect(trainingScreenSignal.value).toBeNull();
    expect(commandBarWarningSignal.value).toBe(
      'Terminá o descartá la venta para entrar al entrenamiento.',
    );
    expect(deps.calls).toEqual([]);
  });

  it('abre la pantalla con lo pendiente real y pausa el sync', async () => {
    const deps = fakeDeps();

    await toggleTraining(deps);

    expect(trainingScreenSignal.value).toEqual({ mode: 'enter', phase: 'ready', pending: 3 });
    expect(deps.calls).toEqual(['pause']);
  });

  it('confirmar: envía lo real, copia, prende la marca, suelta y recarga, en ese orden', async () => {
    const deps = fakeDeps();
    await toggleTraining(deps);

    await confirmTraining(deps);

    expect(deps.calls).toEqual(['pause', 'flush', 'copy', `mark ${now}`, 'release', 'reload']);
  });

  it('un envío que falla no impide entrar', async () => {
    const deps = fakeDeps({ flushReal: () => Promise.reject(new Error('sin red')) });
    await toggleTraining(deps);

    await confirmTraining(deps);

    expect(deps.calls).toEqual(['pause', 'copy', `mark ${now}`, 'release', 'reload']);
  });

  it('cancelar cierra y reanuda el sync, sin tocar nada', async () => {
    const deps = fakeDeps();
    await toggleTraining(deps);

    cancelTraining(deps);

    expect(trainingScreenSignal.value).toBeNull();
    expect(deps.calls).toEqual(['pause', 'resume']);
  });

  it('un segundo pedido con la pantalla abierta no hace nada', async () => {
    const deps = fakeDeps();
    await toggleTraining(deps);

    await toggleTraining(deps);

    expect(deps.calls).toEqual(['pause']);
  });
});

describe('salir del entrenamiento (#177)', () => {
  it('con una venta de práctica en curso igual se puede: muestra lo que se descarta', async () => {
    setTrainingModeForTests({ startedAt: now });
    const deps = fakeDeps({ hasSaleInProgress: () => true });

    await toggleTraining(deps);

    expect(trainingScreenSignal.value).toEqual({
      mode: 'exit',
      phase: 'ready',
      discard: { lines: ['2 ventas'] },
    });
  });

  it('confirmar: borra las claves, deja el aviso, suelta y recarga', async () => {
    setTrainingModeForTests({ startedAt: now });
    const deps = fakeDeps();
    await toggleTraining(deps);

    await confirmTraining(deps);

    expect(deps.calls).toEqual(['pause', 'clear', 'exited', 'release', 'reload']);
  });

  it('"Seguir entrenando" cierra sin tocar nada', async () => {
    setTrainingModeForTests({ startedAt: now });
    const deps = fakeDeps();
    await toggleTraining(deps);

    cancelTraining(deps);

    expect(trainingScreenSignal.value).toBeNull();
    expect(deps.calls).toEqual(['pause', 'resume']);
  });
});
