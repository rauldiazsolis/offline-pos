import {
  cancelDemoConfirm,
  confirmDemo,
} from '../../../src/ui/keyboard/demo-confirm-controller.ts';
import { demoConfirmSignal } from '../../../src/ui/state/demo-confirm.ts';

function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).host : url;
}

/**
 * "Abrir una demo" (#176): un link de demo con algo que perder. La lógica es la de escritorio
 * (`demo-confirm-controller.ts`); la vista, un solo paso con lo que se pierde en rojo.
 */
export function DemoConfirmScreen() {
  const state = demoConfirmSignal.value;
  if (state === null) {
    return null;
  }
  const busy = state.phase !== 'confirming';
  return (
    <main class="full" data-testid="demo-confirm-screen">
      <h1>Abrir una demo</h1>
      <p>Se abrió un link de demo de {hostOf(state.entry.backend)}.</p>
      {state.phase === 'checking' ? (
        <p class="note">Revisando los datos de esta terminal…</p>
      ) : (
        <>
          <div class="card" style={{ borderColor: 'var(--danger)', paddingBlock: '10px' }}>
            <p style={{ margin: '0 0 6px', fontWeight: 700 }}>Se pierde:</p>
            {state.loss.pending !== undefined && (
              <p class="neg" style={{ fontWeight: 700 }}>
                {state.loss.pending}
              </p>
            )}
            {state.loss.draft !== undefined && <p>{state.loss.draft}</p>}
            {state.loss.history !== undefined && <p>{state.loss.history}</p>}
            {state.loss.connection !== undefined && <p>{state.loss.connection}</p>}
          </div>
          <p class="note">Se conservan el formato de impresión y el formato de números.</p>
        </>
      )}
      {state.phase === 'starting' && (
        <p class="note" role="status">
          <span class="spinner" /> Abriendo la demo…
        </p>
      )}
      <div class="stack">
        <button
          type="button"
          class="btn btn-danger btn-block"
          disabled={busy}
          onClick={() => void confirmDemo()}
        >
          Borrar y abrir la demo
        </button>
        <button
          type="button"
          class="btn btn-block"
          disabled={busy}
          onClick={() => {
            cancelDemoConfirm();
          }}
        >
          Cancelar
        </button>
      </div>
    </main>
  );
}
