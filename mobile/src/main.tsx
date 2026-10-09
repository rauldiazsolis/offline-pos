import { render } from 'preact';
import './styles.css';
import { TAB_LOCK_NAME } from '../../src/storage/storage-namespace.ts';
import { consumeTabDisplaced } from '../../src/storage/tab-displaced.ts';
import { bootstrap } from '../../src/ui/bootstrap.ts';
import { installPosConsole } from '../../src/ui/console/pos-console.ts';
import { isBenignResizeObserverLoopError, renderFatalError } from '../../src/ui/fatal-error.ts';
import { browserTabLeadershipDeps } from '../../src/ui/tab-browser.ts';
import { startServiceWorker } from '../../src/ui/service-worker.ts';
import { claimTab } from '../../src/ui/tab-leadership.ts';
import { startTerminalTitle } from '../../src/ui/terminal-context.ts';
import { App } from './app.tsx';
import { ErrorBoundary } from './components/error-boundary.tsx';
import { SecondaryTabScreen } from './screens/secondary-tab-screen.tsx';

window.addEventListener('error', (event) => {
  if (isBenignResizeObserverLoopError(event.message)) {
    return;
  }
  renderFatalError(event.error as unknown);
});
window.addEventListener('unhandledrejection', (event) => {
  renderFatalError(event.reason as unknown);
});

const APP_TITLE = document.title;
const SECONDARY_TITLE = 'POS en otra pestaña';

/**
 * El mismo arranque que el POS de escritorio (`src/main.tsx`): la consola `pos.*`, `bootstrap()`
 * (identidad, repositorios, venta en curso, onboarding de demo y sync), el service worker y el
 * render. Lo único propio es la vista.
 */
function startApp(container: HTMLElement): void {
  installPosConsole();
  // #54: abre sin red y recibe las versiones nuevas. Solo la pestaña que manda.
  void startServiceWorker();
  bootstrap()
    .then(() => {
      render(null, container);
      container.replaceChildren();
      startTerminalTitle(APP_TITLE);
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

/** Una sola pestaña por almacenamiento (#175), como el POS de escritorio. */
async function start(container: HTMLElement): Promise<void> {
  const displaced = consumeTabDisplaced();
  const claim = await claimTab(TAB_LOCK_NAME, browserTabLeadershipDeps());
  if (claim.kind === 'leader') {
    startApp(container);
    return;
  }
  document.title = SECONDARY_TITLE;
  container.replaceChildren();
  render(
    <SecondaryTabScreen
      displaced={displaced}
      onTakeOver={async () => {
        await claim.takeOver();
        document.title = APP_TITLE;
        render(null, container);
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
