import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commandBarWarningSignal } from '../state/command-bar.ts';
import { appUpdateSignal } from '../state/app-update.ts';
import { applyAppUpdate, APPLY_TIMEOUT_MS, type AppUpdateDeps } from './app-update-controller.ts';

function deps(overrides: Partial<AppUpdateDeps> = {}): AppUpdateDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    hasSaleInProgress: () => false,
    prepareRelease: vi.fn(() => {
      calls.push('release');
      return Promise.resolve(() => calls.push('undo'));
    }),
    skipWaiting: vi.fn(() => {
      calls.push('skip');
      return true;
    }),
    waitForControllerChange: vi.fn(() => {
      calls.push('wait');
      return Promise.resolve(true);
    }),
    reload: vi.fn(() => calls.push('reload')),
    ...overrides,
  };
}

beforeEach(() => {
  appUpdateSignal.value = 'available';
  commandBarWarningSignal.value = null;
});

describe('/ACTUALIZAR (#54)', () => {
  it('con una venta en curso no actualiza y lo dice', async () => {
    const d = deps({ hasSaleInProgress: () => true });
    await applyAppUpdate(d);
    expect(commandBarWarningSignal.value).toBe('Terminá o descartá la venta para actualizar.');
    expect(d.calls).toEqual([]);
    expect(appUpdateSignal.value).toBe('available');
  });

  it('suelta sin cortar a medias, activa la versión nueva y recarga', async () => {
    const d = deps();
    await applyAppUpdate(d);
    expect(d.calls).toEqual(['release', 'wait', 'skip', 'reload']);
    expect(d.waitForControllerChange).toHaveBeenCalledWith(APPLY_TIMEOUT_MS);
    expect(appUpdateSignal.value).toBe('applying');
  });

  it('si la versión nueva no se activa, avisa, reanuda el sync y vuelve a estar disponible', async () => {
    const d = deps({ waitForControllerChange: vi.fn(() => Promise.resolve(false)) });
    await applyAppUpdate(d);
    expect(d.calls).toEqual(['release', 'skip', 'undo']);
    expect(commandBarWarningSignal.value).toBe('No se pudo actualizar: cerrá y abrí el POS.');
    expect(appUpdateSignal.value).toBe('available');
  });

  it('sin versión disponible no hace nada', async () => {
    appUpdateSignal.value = 'none';
    const d = deps();
    await applyAppUpdate(d);
    expect(d.calls).toEqual([]);
  });
});
