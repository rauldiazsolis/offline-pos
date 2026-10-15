import { isTrainingMode } from '../../storage/training-mode.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { toggleGuide } from '../keyboard/guide-controller.ts';
import { toggleTraining } from '../keyboard/training-controller.ts';
import { guideSignal } from '../state/guide.ts';
import { noMovementsSignal } from '../state/operations.ts';

const muted = { margin: 0, color: 'var(--color-text-muted)' };

/** Un llamado con su botón: el botón hace lo mismo que el comando, sin sacarle el foco a la barra. */
function Invitation(props: { title: string; text: string; button: string; onClick: () => void }) {
  return (
    <div
      role="note"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 'var(--space-2)',
        maxWidth: '36em',
        padding: 'var(--space-4)',
        border: '1px solid var(--color-border)',
        borderLeft: '4px solid var(--color-accent)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-selected-bg-subtle)',
      }}
    >
      <p style={{ margin: 0, fontWeight: 'bold', fontSize: 'var(--font-size-lg)' }}>
        {props.title}
      </p>
      <p style={{ margin: 0 }}>{props.text}</p>
      <button
        type="button"
        class="btn btn-primary"
        tabIndex={-1}
        onMouseDown={keepFocusOnMouseDown}
        onClick={props.onClick}
      >
        {props.button}
      </button>
    </div>
  );
}

/**
 * El carrito vacío (#226). Mientras la caja no tenga movimientos, la invitación a practicar con la
 * guía (entra por `/ENTRENAMIENTO`); en entrenamiento sin la guía abierta, cómo abrirla (`/GUIA`).
 * Si no, el aviso de siempre.
 */
export function EmptyCart() {
  if (!isTrainingMode() && noMovementsSignal.value) {
    return (
      <Invitation
        title="¿Es la primera vez que usás el POS?"
        text="Practicá una venta guiada paso a paso: nada llega al backend y al terminar se descarta."
        button="Empezar la guía (/ENTRENAMIENTO)"
        onClick={() => void toggleTraining()}
      />
    );
  }
  if (isTrainingMode() && guideSignal.value === null) {
    return (
      <Invitation
        title="Estás practicando"
        text="Probá lo que quieras: al salir se descarta. La guía paso a paso te muestra qué escribir en cada momento."
        button="Abrir la guía (/GUIA)"
        onClick={() => void toggleGuide()}
      />
    );
  }
  return <p style={muted}>El carrito está vacío.</p>;
}
