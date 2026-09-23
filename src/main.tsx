import { render } from 'preact';
import './index.css';
import { bootstrap } from './ui/bootstrap.ts';
import { installPosConsole } from './ui/console/pos-console.ts';
import { ErrorBoundary } from './ui/error-boundary.tsx';
import { isBenignResizeObserverLoopError, renderFatalError } from './ui/fatal-error.ts';
import { App } from './ui/app.tsx';
import { startViewportTracking } from './ui/state/viewport.ts';

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
installPosConsole();

const container = document.getElementById('app');
if (!container) {
  renderFatalError(new Error('#app element not found'));
} else {
  bootstrap()
    .then(() => {
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
