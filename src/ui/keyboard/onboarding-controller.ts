import { buildOnboardingUrl, returnUrlFor } from '../../sync/demo-link.ts';
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
