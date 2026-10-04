import type { Result } from '../../domain/result.ts';
import { loadSyncConfig, type SyncConfig } from '../../sync/config.ts';
import { isDemoRevokedFailure, markDemoRevoked } from '../../sync/demo-revoked.ts';
import { requestPortalLink, type PortalLink } from '../../sync/portal-link.ts';
import { describeError } from '../errors.ts';
import { commandBarErrorSignal, overlayDismissedSignal } from '../state/command-bar.ts';

export type PortalDeps = {
  openTab: (url: string) => void;
  request: (config: SyncConfig) => Promise<Result<PortalLink>>;
  loadConfig: () => Result<SyncConfig>;
  /** Si el gesto del usuario todavía habilita abrir una pestaña (en Chromium, unos 5 s). */
  gestureActive: () => boolean;
  now: () => string;
};

const defaultDeps: PortalDeps = {
  // `noopener`: la página del backend no puede tocar la pestaña del POS.
  openTab: (url) => {
    window.open(url, '_blank', 'noopener');
  },
  request: requestPortalLink,
  loadConfig: loadSyncConfig,
  // Sin `navigator.userActivation` (navegadores viejos) se intenta igual.
  gestureActive: () => !('userActivation' in navigator) || navigator.userActivation.isActive,
  now: () => new Date().toISOString(),
};

let inFlight = false;

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * Un mensaje en el slot de la barra. El click del botón del encabezado cerró el overlay de la barra
 * (#28, como un click afuera): sin reabrirlo, el mensaje quedaba oculto (prueba manual de #179).
 */
function showError(message: string): void {
  commandBarErrorSignal.value = message;
  overlayDismissedSignal.value = false;
}

/**
 * El comando y el botón del portal (4.6.0, #179). Pide el link y recién con él abre la pestaña: un
 * error no abre nada (abrirla en blanco en el gesto y cerrarla al fallar hacía parpadear la
 * pantalla, prueba manual) y va a la barra. El navegador deja abrirla mientras el gesto siga vigente
 * (en Chromium, unos 5 s); si el backend tardó más, no se intenta (el bloqueador la frenaría sin
 * avisar) y se pide probar de nuevo. Con la terminal en demo, un 401/403 es la demo que terminó: se
 * marca como si la hubiera descubierto un ciclo de sync. Un pedido a la vez. La URL nunca se guarda.
 */
export async function openPortal(label: string, deps: PortalDeps = defaultDeps): Promise<void> {
  if (inFlight) {
    return;
  }
  inFlight = true;
  try {
    const config = deps.loadConfig();
    const link = config.ok ? await deps.request(config.value) : config;
    if (link.ok) {
      if (deps.gestureActive()) {
        deps.openTab(link.value.url);
      } else {
        showError(`No se pudo abrir ${label}: el backend tardó en contestar; probá de nuevo.`);
      }
      return;
    }
    if (isDemoRevokedFailure(link, config)) {
      markDemoRevoked(deps.now());
      showError(`No se pudo abrir ${label}: la demo terminó.`);
      return;
    }
    showError(sentence(`No se pudo abrir ${label}: ${describeError(link)}`));
  } finally {
    inFlight = false;
  }
}
