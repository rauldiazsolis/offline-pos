import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '../../domain/result.ts';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import type { SyncConfig } from '../../sync/config.ts';
import { commandBarNoticeSignal, commandBarWarningSignal } from '../state/command-bar.ts';
import { demoConfirmSignal } from '../state/demo-confirm.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { connectionStateSignal, syncPausedSignal } from '../state/sync.ts';
import { configNoticeSignal } from '../state/sync-config.ts';
import {
  cancelDemoConfirm,
  confirmDemo,
  openDemoConfirm,
  type DemoConfirmDeps,
} from './demo-confirm-controller.ts';

const SUMMARY: LocalDataSummary = {
  products: 0,
  customers: 0,
  sales: 1,
  cashMovements: 0,
  cashCounts: 0,
  customerPayments: 0,
  pendingOutbox: 2,
  pendingSales: 1,
  draftCartLines: 0,
};
const REAL_CONFIG: SyncConfig = { type: 'rest', baseUrl: 'https://erp.x', apiKey: 'k' };
const REAL: Result<SyncConfig> = ok(REAL_CONFIG);
const ENTRY = { backend: 'https://b.x' };

function makeDeps() {
  return {
    loadConfig: vi.fn<DemoConfirmDeps['loadConfig']>(() => REAL),
    isOnline: vi.fn<DemoConfirmDeps['isOnline']>(() => true),
    flush: vi.fn<DemoConfirmDeps['flush']>(() => Promise.resolve()),
    summarize: vi.fn<DemoConfirmDeps['summarize']>(() => Promise.resolve(SUMMARY)),
    startDemo: vi.fn<DemoConfirmDeps['startDemo']>(() =>
      Promise.resolve({ kind: 'applied' as const }),
    ),
    afterApplied: vi.fn<DemoConfirmDeps['afterApplied']>(() => Promise.resolve()),
    resumeSync: vi.fn<DemoConfirmDeps['resumeSync']>(),
  };
}

let deps: ReturnType<typeof makeDeps>;

beforeEach(() => {
  deps = makeDeps();
  demoConfirmSignal.value = null;
  syncPausedSignal.value = false;
  connectionStateSignal.value = 'active';
  activeScreenSignal.value = 'sale';
  commandBarNoticeSignal.value = null;
  commandBarWarningSignal.value = null;
  configNoticeSignal.value = null;
});

describe('openDemoConfirm (#176)', () => {
  it('pausa el sync, manda lo pendiente a la conexión actual y muestra lo que se pierde', async () => {
    const opening = openDemoConfirm(ENTRY, deps);
    expect(syncPausedSignal.value).toBe(true);
    expect(demoConfirmSignal.value?.phase).toBe('checking');
    await opening;
    expect(deps.flush).toHaveBeenCalledWith(REAL_CONFIG);
    expect(demoConfirmSignal.value).toMatchObject({ phase: 'confirming', entry: ENTRY });
  });

  it('sin red o sin config legible no intenta el envío', async () => {
    deps.isOnline.mockReturnValue(false);
    await openDemoConfirm(ENTRY, deps);
    deps.isOnline.mockReturnValue(true);
    deps.loadConfig.mockReturnValue(err('sync/config-missing', undefined));
    await openDemoConfirm(ENTRY, deps);
    expect(deps.flush).not.toHaveBeenCalled();
  });
});

describe('cancelDemoConfirm (#176)', () => {
  it('con la terminal activa: cierra, reanuda el sync y vuelve a la venta, sin pedir la demo', async () => {
    await openDemoConfirm(ENTRY, deps);
    cancelDemoConfirm(deps);
    expect(demoConfirmSignal.value).toBeNull();
    expect(deps.resumeSync).toHaveBeenCalled();
    expect(activeScreenSignal.value).toBe('sale');
    expect(deps.startDemo).not.toHaveBeenCalled();
  });

  it('sin conexión activa: cierra y deja el wizard requerido con el sync pausado', async () => {
    connectionStateSignal.value = 'unconfigured';
    await openDemoConfirm(ENTRY, deps);
    cancelDemoConfirm(deps);
    expect(demoConfirmSignal.value).toBeNull();
    expect(deps.resumeSync).not.toHaveBeenCalled();
    expect(syncPausedSignal.value).toBe(true);
  });

  it('mientras revisa no hace nada', () => {
    void openDemoConfirm(ENTRY, deps);
    cancelDemoConfirm(deps);
    expect(demoConfirmSignal.value?.phase).toBe('checking');
  });
});

describe('confirmDemo (#176)', () => {
  it('aplica la demo, limpia la sesión, reanuda y avisa la plantilla', async () => {
    deps.startDemo.mockResolvedValue({
      kind: 'applied',
      notice: 'La plantilla x no existe; se usó kiosco.',
    });
    await openDemoConfirm(ENTRY, deps);
    await confirmDemo(deps);
    expect(deps.startDemo).toHaveBeenCalledWith(ENTRY, REAL);
    expect(deps.afterApplied).toHaveBeenCalled();
    expect(deps.resumeSync).toHaveBeenCalled();
    expect(demoConfirmSignal.value).toBeNull();
    expect(activeScreenSignal.value).toBe('sale');
    expect(commandBarNoticeSignal.value).toBe('La plantilla x no existe; se usó kiosco.');
  });

  it('mientras abre la demo, un segundo Enter no la pide de nuevo', async () => {
    await openDemoConfirm(ENTRY, deps);
    const first = confirmDemo(deps);
    expect(demoConfirmSignal.value?.phase).toBe('starting');
    await confirmDemo(deps);
    await first;
    expect(deps.startDemo).toHaveBeenCalledTimes(1);
  });

  it('si la demo falla con la terminal activa: nada borrado, vuelve a la venta con el aviso', async () => {
    deps.startDemo.mockResolvedValue({ kind: 'failed', notice: 'No se pudo iniciar la demo: x.' });
    await openDemoConfirm(ENTRY, deps);
    await confirmDemo(deps);
    expect(deps.afterApplied).not.toHaveBeenCalled();
    expect(commandBarWarningSignal.value).toBe('No se pudo iniciar la demo: x.');
    expect(deps.resumeSync).toHaveBeenCalled();
    expect(demoConfirmSignal.value).toBeNull();
  });

  it('si la demo falla sin conexión activa: el aviso va al wizard', async () => {
    connectionStateSignal.value = 'unconfigured';
    deps.startDemo.mockResolvedValue({ kind: 'failed', notice: 'No se pudo iniciar la demo: x.' });
    await openDemoConfirm(ENTRY, deps);
    await confirmDemo(deps);
    expect(configNoticeSignal.value).toBe('No se pudo iniciar la demo: x.');
    expect(deps.resumeSync).not.toHaveBeenCalled();
  });
});
