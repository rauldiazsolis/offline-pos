import type { TargetedKeyboardEvent } from 'preact';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { cancelDemoConfirm, confirmDemo } from '../keyboard/demo-confirm-controller.ts';
import type { DemoLoss } from '../keyboard/demo-confirm-model.ts';
import { demoConfirmSignal } from '../state/demo-confirm.ts';

function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).host : url;
}

/** Lo que se pierde, en el orden de la spec: lo no enviado (destacado), la venta en curso, el historial y la conexión. */
function LossList(props: { loss: DemoLoss }) {
  const { pending, draft, history, connection } = props.loss;
  return (
    <div
      style={{
        border: '1px solid var(--color-danger)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      <p style={{ margin: 0, fontWeight: 'bold' }}>Se pierde:</p>
      {pending !== undefined && (
        <p style={{ margin: 0, fontWeight: 'bold', color: 'var(--color-danger)' }}>{pending}</p>
      )}
      {draft !== undefined && <p style={{ margin: 0 }}>{draft}</p>}
      {history !== undefined && <p style={{ margin: 0 }}>{history}</p>}
      {connection !== undefined && <p style={{ margin: 0 }}>{connection}</p>}
    </div>
  );
}

/**
 * "Abrir una demo" (#176): un link de demo con algo que perder. Mismo patrón que `/DEMO_RESET`: un
 * solo paso, Enter confirma (la pantalla ya es la confirmación, con lo que se pierde en rojo) y Esc
 * cancela, cada atajo con su botón. Mientras revisa o abre la demo no se puede hacer nada.
 */
export function DemoConfirmScreen() {
  const containerRef = useFocusOnMount<HTMLDivElement>();
  const state = demoConfirmSignal.value;
  if (state === null) {
    return null;
  }
  const busy = state.phase !== 'confirming';

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    // Un botón enfocado con Tab se activa solo con Enter (nativo): no duplicar la acción.
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void confirmDemo();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelDemoConfirm();
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onMouseDown={keepFocusOnMouseDown}
      style={{
        height: 'var(--app-height)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Abrir una demo</h1>
      <p style={{ margin: 0 }}>Se abrió un link de demo de {hostOf(state.entry.backend)}.</p>

      {state.phase === 'checking' ? (
        <p style={{ margin: 0 }}>Revisando los datos de esta terminal…</p>
      ) : (
        <>
          <LossList loss={state.loss} />
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            Se conservan el formato de impresión (/IMPRESORA) y el formato de números.
          </p>
        </>
      )}

      <div style={{ minHeight: 'var(--space-8)' }}>
        {state.phase === 'starting' && <p style={{ margin: 0 }}>Abriendo la demo…</p>}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="button"
          class="btn"
          onClick={() => {
            cancelDemoConfirm();
          }}
          disabled={busy}
        >
          Cancelar (Esc)
        </button>
        <button
          type="button"
          class="btn btn-danger"
          onClick={() => void confirmDemo()}
          disabled={busy}
        >
          Borrar y abrir la demo (Enter)
        </button>
      </div>
    </div>
  );
}
