import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '../../domain/result.ts';
import type { SyncConfig } from '../../sync/config.ts';
import type { PortalLink } from '../../sync/portal-link.ts';
import { commandBarErrorSignal, overlayDismissedSignal } from '../state/command-bar.ts';
import { demoRevokedSignal } from '../state/sync.ts';
import { openPortal, type PortalDeps } from './portal-controller.ts';

const restConfig: SyncConfig = { type: 'rest', baseUrl: 'https://b.x', apiKey: 'k' };
const link: Result<PortalLink> = ok({ url: 'https://b.x/p/abc' });

function deps(over: Partial<PortalDeps> = {}): PortalDeps {
  return {
    openTab: vi.fn(),
    request: () => Promise.resolve(link),
    loadConfig: () => ok(restConfig),
    gestureActive: () => true,
    now: () => '2026-10-04T12:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  commandBarErrorSignal.value = null;
  overlayDismissedSignal.value = false;
  demoRevokedSignal.value = null;
});

describe('openPortal (#179)', () => {
  it('pide el link y recién entonces abre la pestaña con la URL', async () => {
    const openTab = vi.fn();

    await openPortal('Panel', deps({ openTab }));

    expect(openTab).toHaveBeenCalledWith('https://b.x/p/abc');
    expect(commandBarErrorSignal.value).toBeNull();
  });

  it('un fallo no abre ninguna pestaña y deja el motivo en la barra', async () => {
    const openTab = vi.fn();

    await openPortal(
      'Panel',
      deps({
        openTab,
        request: () => Promise.resolve(err('sync/backend-maintenance', { message: 'Migrando' })),
      }),
    );

    expect(openTab).not.toHaveBeenCalled();
    expect(commandBarErrorSignal.value).toBe(
      'No se pudo abrir Panel: El backend está en mantenimiento: Migrando.',
    );
  });

  it('el mensaje se ve aunque el click del botón haya cerrado el overlay de la barra', async () => {
    overlayDismissedSignal.value = true;

    await openPortal(
      'Panel',
      deps({ request: () => Promise.resolve(err('sync/request-failed', { message: 'x' })) }),
    );

    expect(overlayDismissedSignal.value).toBe(false);
  });

  it('un 401 fuera de demo es un error más, sin marcar nada', async () => {
    await openPortal(
      'Panel',
      deps({
        request: () =>
          Promise.resolve(err('sync/request-failed', { status: 401, message: 'Unauthorized' })),
      }),
    );

    expect(demoRevokedSignal.value).toBeNull();
    expect(commandBarErrorSignal.value).toBe(
      'No se pudo abrir Panel: El servidor rechazó las credenciales (401).',
    );
  });

  it('un 401 en demo marca la demo revocada y dice que terminó', async () => {
    const demoConfig: SyncConfig = {
      ...restConfig,
      demo: {
        template: 'kiosco',
        onboarding: { url: 'https://b.x/alta', label: 'Alta' },
        startedAt: '2026-10-04T10:00:00.000Z',
      },
    };

    await openPortal(
      'Panel',
      deps({
        loadConfig: () => ok(demoConfig),
        request: () =>
          Promise.resolve(err('sync/request-failed', { status: 401, message: 'Unauthorized' })),
      }),
    );

    expect(demoRevokedSignal.value).toBe('2026-10-04T12:00:00.000Z');
    expect(commandBarErrorSignal.value).toBe('No se pudo abrir Panel: la demo terminó.');
  });

  it('si el gesto ya venció cuando llega el link, no abre nada y pide probar de nuevo', async () => {
    const openTab = vi.fn();

    await openPortal('Panel', deps({ openTab, gestureActive: () => false }));

    expect(openTab).not.toHaveBeenCalled();
    expect(commandBarErrorSignal.value).toBe(
      'No se pudo abrir Panel: el backend tardó en contestar; probá de nuevo.',
    );
  });

  it('un segundo uso con un pedido en curso no pide otro link', async () => {
    const request = vi.fn(() => Promise.resolve(link));

    const first = openPortal('Panel', deps({ request }));
    await openPortal('Panel', deps({ request }));
    await first;

    expect(request).toHaveBeenCalledTimes(1);
    // Terminado el primero, se puede volver a usar.
    await openPortal('Panel', deps({ request }));
    expect(request).toHaveBeenCalledTimes(2);
  });
});
