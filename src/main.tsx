import { render } from 'preact';
import './index.css';
import { TAB_LOCK_NAME } from './storage/storage-namespace.ts';
import { consumeTabDisplaced } from './storage/tab-displaced.ts';
import { bootstrap } from './ui/bootstrap.ts';
import { installPosConsole } from './ui/console/pos-console.ts';
import { ErrorBoundary } from './ui/error-boundary.tsx';
import { isBenignResizeObserverLoopError, renderFatalError } from './ui/fatal-error.ts';
import { App } from './ui/app.tsx';
import { SecondaryTabScreen } from './ui/screens/secondary-tab-screen.tsx';
import { startViewportTracking } from './ui/state/viewport.ts';
import { browserTabLeadershipDeps } from './ui/tab-browser.ts';
import { claimTab } from './ui/tab-leadership.ts';

window.addEventListener('error', (event) => {
  // Issue #42: ver el porqué en `isBenignResizeObserverLoopError` —
  // nunca es un error real de la app, así que no llega a `renderFatalError`.
  if (isBenignResizeObserverLoopError(event.message)) {
    return;
  }
  renderFatalError(event.error as unknown);
});
window.addEventListener('unhandledrejection', (event) => {
  renderFatalError(event.reason as unknown);
});
startViewportTracking();

const APP_TITLE = document.title;
const SECONDARY_TITLE = 'POS en otra pestaña';

/** Lo de siempre: la consola `pos.*` antes de `bootstrap()` (sirve aunque el arranque falle) y el render. */
function startApp(container: HTMLElement): void {
  installPosConsole();
  bootstrap()
    .then(() => {
      // "Preparando…" de `index.html` (#128), o la pantalla de la segunda pestaña (#175): se ve
      // mientras `bootstrap` espera (el onboarding de demo puede tardar lo que tarde el backend).
      render(null, container);
      container.replaceChildren();
      render(
        <ErrorBoundary>
          <App />
        </ErrorBoundary>,
        container,
      );
    })
    .catch((error: unknown) => {
      renderFatalError(error);
    });
}

/**
 * Una sola pestaña por almacenamiento (#175): antes de todo, el cerrojo de la pestaña que manda. Sin
 * él no arranca nada (ni identidad, ni onboarding, ni sync): la URL queda intacta y un `?demo=…` o un
 * `#connect=…` se procesa cuando esta pestaña toma el control.
 */
async function start(container: HTMLElement): Promise<void> {
  // Se lee siempre: una marca vieja no tiene que aparecer en un arranque posterior.
  const displaced = consumeTabDisplaced();
  const claim = await claimTab(TAB_LOCK_NAME, browserTabLeadershipDeps());
  if (claim.kind === 'leader') {
    startApp(container);
    return;
  }
  document.title = SECONDARY_TITLE;
  render(
    <SecondaryTabScreen
      displaced={displaced}
      onTakeOver={async () => {
        await claim.takeOver();
        document.title = APP_TITLE;
        startApp(container);
      }}
    />,
    container,
  );
}

const container = document.getElementById('app');
if (!container) {
  renderFatalError(new Error('#app element not found'));
} else {
  start(container).catch((error: unknown) => {
    renderFatalError(error);
  });
}
