import type { Result } from '../../domain/result.ts';
import { summarizeLocalData, type LocalDataSummary } from '../../storage/local-data.ts';
import { flushPendingBeforeWipe } from '../../sync/apply-connection.ts';
import { loadSyncConfig, type SyncConfig } from '../../sync/config.ts';
import type { DemoEntry } from '../../sync/demo-link.ts';
import { runPushThenPull } from '../../sync/engine.ts';
import { startDemo, type DemoStartOutcome } from '../onboarding.ts';
import { resetSessionAfterWipe } from '../session-reset.ts';
import { commandBarNoticeSignal, commandBarWarningSignal } from '../state/command-bar.ts';
import { demoConfirmSignal } from '../state/demo-confirm.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { connectionStateSignal, setSyncPaused } from '../state/sync.ts';
import { configNoticeSignal } from '../state/sync-config.ts';
import { describeDemoLoss } from './demo-confirm-model.ts';

/**
 * "Abrir una demo" (#176): un link de demo con algo que perder. Primero se confirma y recién después
 * se pide la demo (cancelar nunca crea una caja de demo en el backend). Mientras está abierta, el sync
 * queda pausado como con `/CONFIG`.
 */
export type DemoConfirmDeps = {
  loadConfig: () => Result<SyncConfig>;
  isOnline: () => boolean;
  flush: (config: SyncConfig) => Promise<void>;
  summarize: () => Promise<LocalDataSummary>;
  startDemo: (entry: DemoEntry, config: Result<SyncConfig>) => Promise<DemoStartOutcome>;
  afterApplied: () => Promise<void>;
  resumeSync: () => void;
};

const defaultDeps: DemoConfirmDeps = {
  loadConfig: loadSyncConfig,
  isOnline: () => navigator.onLine,
  flush: (config) => flushPendingBeforeWipe(config),
  summarize: summarizeLocalData,
  startDemo: (entry, config) => startDemo(entry, config),
  afterApplied: resetSessionAfterWipe,
  resumeSync: () => {
    setSyncPaused(false);
    void runPushThenPull();
  },
};

/** Lo llama `bootstrap` con un `confirm`. Pausa el sync antes del primer `await`. */
export async function openDemoConfirm(
  entry: DemoEntry,
  deps: DemoConfirmDeps = defaultDeps,
): Promise<void> {
  setSyncPaused(true);
  demoConfirmSignal.value = { phase: 'checking', entry };
  // Como "Borrar" en el wizard: un último envío a la conexión actual, así "sin enviar" es real.
  const config = deps.loadConfig();
  if (config.ok && deps.isOnline()) {
    await deps.flush(config.value);
  }
  const loss = describeDemoLoss(await deps.summarize(), config);
  demoConfirmSignal.value = { phase: 'confirming', entry, loss };
}

/**
 * Cierra la pantalla y vuelve a donde estaba: la venta (y reanuda el sync), o el wizard requerido,
 * que sigue con el sync pausado. Devuelve si volvió a la venta.
 */
function leave(deps: DemoConfirmDeps): boolean {
  demoConfirmSignal.value = null;
  if (connectionStateSignal.value !== 'active') {
    return false;
  }
  activeScreenSignal.value = 'sale';
  deps.resumeSync();
  return true;
}

/** Esc o "Cancelar": no toca nada (la URL ya se limpió al arrancar). */
export function cancelDemoConfirm(deps: DemoConfirmDeps = defaultDeps): void {
  if (demoConfirmSignal.value?.phase !== 'confirming') {
    return;
  }
  leave(deps);
}

/** Enter o "Borrar y abrir la demo". Si la demo falla no se borró nada: vuelve con el motivo. */
export async function confirmDemo(deps: DemoConfirmDeps = defaultDeps): Promise<void> {
  const current = demoConfirmSignal.value;
  if (current?.phase !== 'confirming') {
    return;
  }
  demoConfirmSignal.value = { ...current, phase: 'starting' };
  const outcome = await deps.startDemo(current.entry, deps.loadConfig());
  if (outcome.kind === 'applied') {
    await deps.afterApplied();
    leave(deps);
    if (outcome.notice !== undefined) {
      commandBarNoticeSignal.value = outcome.notice;
    }
    return;
  }
  if (leave(deps)) {
    commandBarWarningSignal.value = outcome.notice;
  } else {
    configNoticeSignal.value = outcome.notice;
  }
}
