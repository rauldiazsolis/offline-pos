import { render } from 'preact';
import './index.css';
import { bootstrap } from './ui/bootstrap.ts';
import { ErrorBoundary } from './ui/error-boundary.tsx';
import { renderFatalError } from './ui/fatal-error.ts';
import { App } from './ui/app.tsx';

window.addEventListener('error', (event) => {
  renderFatalError(event.error as unknown);
});
window.addEventListener('unhandledrejection', (event) => {
  renderFatalError(event.reason as unknown);
});

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
