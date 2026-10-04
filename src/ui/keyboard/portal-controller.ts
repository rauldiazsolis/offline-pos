import type { Result } from '../../domain/result.ts';
import { loadSyncConfig, type SyncConfig } from '../../sync/config.ts';
import { isDemoRevokedFailure, markDemoRevoked } from '../../sync/demo-revoked.ts';
import { requestPortalLink, type PortalLink } from '../../sync/portal-link.ts';
import { describeError } from '../errors.ts';
import { commandBarErrorSignal } from '../state/command-bar.ts';

/** Lo que usa `openPortal` de la pestaña que abre: un `Window`, o uno falso en los tests. */
export type PortalTab = {
  closed: boolean;
  close(): void;
  location: { replace(url: string): void };
  document: Document;
  opener: unknown;
};

export type PortalDeps = {
  openTab: () => PortalTab | null;
  request: (config: SyncConfig) => Promise<Result<PortalLink>>;
  loadConfig: () => Result<SyncConfig>;
  now: () => string;
};

const defaultDeps: PortalDeps = {
  // Sin `noopener`: devolvería `null` y no se le podría cargar la URL. El `opener` se corta a mano.
  openTab: () => window.open('', '_blank'),
  request: requestPortalLink,
  loadConfig: loadSyncConfig,
  now: () => new Date().toISOString(),
};

let inFlight = false;

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * El comando y el botón del portal (4.6.0, #179). Abre la pestaña **en el gesto**, antes de
 * cualquier `await` (si no, el bloqueador de pop-ups la frena), pide el link y se la carga; si
 * falla, la cierra y deja el motivo en la barra. Con la terminal en demo, un 401/403 es la demo que
 * terminó: se marca como si la hubiera descubierto un ciclo de sync. Un pedido a la vez: un doble
 * click no abre dos pestañas. La URL nunca se guarda.
 */
export async function openPortal(label: string, deps: PortalDeps = defaultDeps): Promise<void> {
  if (inFlight) {
    return;
  }
  const tab = deps.openTab();
  if (tab === null) {
    // Pedir el link sin dónde abrirlo gastaría uno de un solo uso.
    commandBarErrorSignal.value =
      'El navegador bloqueó la pestaña nueva: permití las ventanas emergentes para este sitio.';
    return;
  }
  tab.opener = null;
  tab.document.title = `Abriendo ${label}…`;
  tab.document.body.textContent = `Abriendo ${label}…`;
  inFlight = true;
  try {
    const config = deps.loadConfig();
    const link = config.ok ? await deps.request(config.value) : config;
    if (link.ok) {
      // Si el operador la cerró mientras tanto, el link se descarta.
      if (!tab.closed) {
        tab.location.replace(link.value.url);
      }
      return;
    }
    tab.close();
    if (isDemoRevokedFailure(link, config)) {
      markDemoRevoked(deps.now());
      commandBarErrorSignal.value = `No se pudo abrir ${label}: la demo terminó.`;
      return;
    }
    commandBarErrorSignal.value = sentence(`No se pudo abrir ${label}: ${describeError(link)}`);
  } finally {
    inFlight = false;
  }
}
