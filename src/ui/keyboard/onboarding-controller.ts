import { loadSyncConfig } from '../../sync/config.ts';
import { buildDemoLink, buildOnboardingUrl, returnUrlFor } from '../../sync/demo-link.ts';
import { issueWipeKey } from '../../sync/wipe-key.ts';
import { demoSessionSignal } from '../state/sync.ts';

/**
 * `/ALTA` y el botón de la barra de estado (#128): emite el `wipe_key` y lleva al alta del backend,
 * que vuelve al POS con `#connect=…`. `return_url` sale de la URL actual: nada fijo en el código.
 * Sin demo no hace nada.
 */
export function startOnboarding(
  navigate: (url: string) => void = (url) => {
    window.location.assign(url);
  },
): void {
  const demo = demoSessionSignal.value;
  if (demo === null) {
    return;
  }
  const wipeKey = issueWipeKey(new Date());
  navigate(buildOnboardingUrl(demo.onboarding.url, returnUrlFor(window.location.href), wipeKey));
}

/**
 * `/DEMO_NUEVA` y el botón de la demo revocada (#176): navega al link de demo armado con lo guardado,
 * así todo sigue por el arranque (directo sin datos del usuario, o la confirmación). El backend es el
 * del link original; una demo anterior a #176 no lo tiene y usa su `baseUrl`. Sin demo no hace nada.
 */
export function startNewDemo(
  navigate: (url: string) => void = (url) => {
    window.location.assign(url);
  },
): void {
  const demo = demoSessionSignal.value;
  if (demo === null) {
    return;
  }
  const config = loadSyncConfig();
  const backend =
    demo.backend ?? (config.ok && config.value.type === 'rest' ? config.value.baseUrl : undefined);
  if (backend === undefined) {
    return;
  }
  navigate(buildDemoLink(window.location.href, backend, demo.template));
}
