import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '../../domain/result.ts';
import type { SyncConfig } from '../../sync/config.ts';
import type { PortalLink } from '../../sync/portal-link.ts';
import { commandBarErrorSignal } from '../state/command-bar.ts';
import { demoRevokedSignal } from '../state/sync.ts';
import { openPortal, type PortalDeps, type PortalTab } from './portal-controller.ts';

// Los espías van aparte de los métodos: `expect(tab.closeSpy)` es un método suelto para el lint.
type FakeTab = PortalTab & {
  replace: ReturnType<typeof vi.fn>;
  closeSpy: ReturnType<typeof vi.fn>;
};

function fakeTab(): FakeTab {
  const replace = vi.fn();
  const closeSpy = vi.fn(() => {
    tab.closed = true;
  });
  const tab: FakeTab = {
    closed: false,
    close: closeSpy,
    location: { replace },
    document: document.implementation.createHTMLDocument(''),
    opener: {},
    replace,
    closeSpy,
  };
  return tab;
}

const restConfig: SyncConfig = { type: 'rest', baseUrl: 'https://b.x', apiKey: 'k' };
const link: Result<PortalLink> = ok({ url: 'https://b.x/p/abc' });

function deps(over: Partial<PortalDeps> = {}): PortalDeps {
  return {
    openTab: () => fakeTab(),
    request: () => Promise.resolve(link),
    loadConfig: () => ok(restConfig),
    now: () => '2026-10-04T12:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  commandBarErrorSignal.value = null;
  demoRevokedSignal.value = null;
});

describe('openPortal (#179)', () => {
  it('abre la pestaña en el gesto, la deja "Abriendo…" y le carga la URL', async () => {
    const tab = fakeTab();

    const done = openPortal('Panel', deps({ openTab: () => tab }));

    // Sincrónico, antes de cualquier await: sigue dentro del gesto del usuario.
    expect(tab.opener).toBeNull();
    expect(tab.document.title).toBe('Abriendo Panel…');
    expect(tab.document.body.textContent).toBe('Abriendo Panel…');
    await done;
    expect(tab.replace).toHaveBeenCalledWith('https://b.x/p/abc');
    expect(tab.closeSpy).not.toHaveBeenCalled();
    expect(commandBarErrorSignal.value).toBeNull();
  });

  it('un fallo cierra la pestaña y deja el motivo en la barra', async () => {
    const tab = fakeTab();

    await openPortal(
      'Panel',
      deps({
        openTab: () => tab,
        request: () => Promise.resolve(err('sync/backend-maintenance', { message: 'Migrando' })),
      }),
    );

    expect(tab.closeSpy).toHaveBeenCalled();
    expect(tab.replace).not.toHaveBeenCalled();
    expect(commandBarErrorSignal.value).toBe(
      'No se pudo abrir Panel: El backend está en mantenimiento: Migrando.',
    );
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

  it('con el bloqueador no pide el link', async () => {
    const request = vi.fn(() => Promise.resolve(link));

    await openPortal('Panel', deps({ openTab: () => null, request }));

    expect(request).not.toHaveBeenCalled();
    expect(commandBarErrorSignal.value).toBe(
      'El navegador bloqueó la pestaña nueva: permití las ventanas emergentes para este sitio.',
    );
  });

  it('un segundo uso con un pedido en curso no abre otra pestaña', async () => {
    const openTab = vi.fn(() => fakeTab());

    const first = openPortal('Panel', deps({ openTab }));
    await openPortal('Panel', deps({ openTab }));
    await first;

    expect(openTab).toHaveBeenCalledTimes(1);
    // Terminado el primero, se puede volver a usar.
    await openPortal('Panel', deps({ openTab }));
    expect(openTab).toHaveBeenCalledTimes(2);
  });

  it('si el operador cerró la pestaña antes de la respuesta, descarta el link', async () => {
    const tab = fakeTab();

    await openPortal(
      'Panel',
      deps({
        openTab: () => tab,
        request: () => {
          tab.closed = true; // la cierra mientras se pide el link
          return Promise.resolve(link);
        },
      }),
    );

    expect(tab.replace).not.toHaveBeenCalled();
    expect(commandBarErrorSignal.value).toBeNull();
  });
});
