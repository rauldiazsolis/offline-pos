import { requestSkipWaiting, waitForControllerChange } from '../service-worker.ts';
import { appUpdateSignal } from '../state/app-update.ts';
import { commandBarWarningSignal } from '../state/command-bar.ts';
import { saleInProgress } from '../state/sale-in-progress.ts';
import { RELEASE_WAIT_MS } from '../tab-leadership.ts';
import { prepareTabRelease } from '../tab-release.ts';

/** Cuánto se espera a que la versión nueva tome el control antes de darse por vencido. */
export const APPLY_TIMEOUT_MS = 10_000;

export type AppUpdateDeps = {
  hasSaleInProgress: () => boolean;
  prepareRelease: (timeoutMs: number) => Promise<() => void>;
  skipWaiting: () => boolean;
  waitForControllerChange: (timeoutMs: number) => Promise<boolean>;
  reload: () => void;
};

const browserDeps: AppUpdateDeps = {
  hasSaleInProgress: saleInProgress,
  prepareRelease: prepareTabRelease,
  skipWaiting: requestSkipWaiting,
  waitForControllerChange: (timeoutMs) => waitForControllerChange(timeoutMs),
  reload: () => {
    window.location.reload();
  },
};

/**
 * `/ACTUALIZAR` y el botón de la barra de estado (#54): nunca con una venta en curso. Suelta como en
 * el traspaso de pestaña de #175 (termina el sync y las escrituras, con tope), activa la versión en
 * espera y recarga cuando toma el control. Si no lo toma a tiempo, lo deshace y avisa.
 */
export async function applyAppUpdate(deps: AppUpdateDeps = browserDeps): Promise<void> {
  if (appUpdateSignal.value !== 'available') {
    return;
  }
  if (deps.hasSaleInProgress()) {
    commandBarWarningSignal.value = 'Terminá o descartá la venta para actualizar.';
    return;
  }
  appUpdateSignal.value = 'applying';
  const undo = await deps.prepareRelease(RELEASE_WAIT_MS);
  const changed = deps.waitForControllerChange(APPLY_TIMEOUT_MS);
  if (deps.skipWaiting() && (await changed)) {
    deps.reload();
    return;
  }
  undo();
  appUpdateSignal.value = 'available';
  commandBarWarningSignal.value = 'No se pudo actualizar: cerrá y abrí el POS.';
}
