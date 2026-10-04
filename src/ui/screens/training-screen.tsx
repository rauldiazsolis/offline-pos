import type { TargetedKeyboardEvent } from 'preact';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { cancelTraining, confirmTraining } from '../keyboard/training-controller.ts';
import type { TrainingDiscard } from '../keyboard/training-model.ts';
import { trainingScreenSignal } from '../state/training.ts';

const paragraph = { margin: 0 };

function pendingText(pending: number): string {
  const what = pending === 1 ? '1 operación' : `${String(pending)} operaciones`;
  return `Hay ${what} sin enviar: se intenta mandarlas ahora; si no se puede, salen al terminar el entrenamiento.`;
}

/** Lo que se descarta al salir, en rojo como en "Abrir una demo". */
function DiscardList(props: { discard: TrainingDiscard }) {
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
      <p style={{ ...paragraph, fontWeight: 'bold' }}>Se descarta:</p>
      {props.discard.lines.map((line) => (
        <p key={line} style={paragraph}>
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * Entrar o salir del entrenamiento (#177). Mismo patrón que "Abrir una demo": un solo paso, Enter
 * confirma y Esc cancela, cada atajo con su botón. Mientras prepara o sale no se puede hacer nada.
 */
export function TrainingScreen() {
  const containerRef = useFocusOnMount<HTMLDivElement>();
  const state = trainingScreenSignal.value;
  if (state === null) {
    return null;
  }
  const busy = state.phase !== 'ready';
  const entering = state.mode === 'enter';

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    // Un botón enfocado con Tab se activa solo con Enter (nativo): no duplicar la acción.
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void confirmTraining();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelTraining();
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
      {state.mode === 'enter' ? (
        <>
          <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Entrar al entrenamiento</h1>
          <p style={paragraph}>
            Vas a practicar con el catálogo, el stock y los clientes reales: podés vender, cobrar y
            usar la caja.
          </p>
          <p style={{ ...paragraph, fontWeight: 'bold' }}>
            Nada se envía al backend. Al salir se borra todo lo que hiciste.
          </p>
          {state.phase === 'checking' ? (
            <p style={paragraph}>Revisando los datos de esta terminal…</p>
          ) : (
            state.pending > 0 && <p style={paragraph}>{pendingText(state.pending)}</p>
          )}
        </>
      ) : (
        <>
          <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Salir del entrenamiento</h1>
          <DiscardList discard={state.discard} />
          <p style={{ ...paragraph, color: 'var(--color-text-muted)' }}>
            Vuelven el stock, los saldos y el resumen reales; lo pendiente real sigue guardado.
          </p>
        </>
      )}

      <div style={{ minHeight: 'var(--space-8)' }}>
        {state.phase === 'starting' && <p style={paragraph}>Preparando…</p>}
        {state.phase === 'leaving' && <p style={paragraph}>Saliendo…</p>}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="button"
          class="btn"
          onClick={() => {
            cancelTraining();
          }}
          disabled={busy}
        >
          {entering ? 'Cancelar (Esc)' : 'Seguir entrenando (Esc)'}
        </button>
        <button
          type="button"
          class={entering ? 'btn btn-primary' : 'btn btn-danger'}
          onClick={() => void confirmTraining()}
          disabled={busy}
        >
          {entering ? 'Entrar al entrenamiento (Enter)' : 'Descartar y salir (Enter)'}
        </button>
      </div>
    </div>
  );
}
