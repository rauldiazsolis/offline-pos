import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { toggleTraining } from '../keyboard/training-controller.ts';

/**
 * Franja del modo entrenamiento (#177): arriba de todas las pantallas, inconfundible (rayas ámbar y
 * negro, distinta del chrome y de las advertencias). El botón hace lo mismo que `/ENTRENAMIENTO`, sin
 * entrar en el orden de Tab ni sacarle el foco a la pantalla.
 */
export function TrainingBanner() {
  return (
    <div class="training-banner" role="status">
      <span class="training-banner__text">
        MODO ENTRENAMIENTO · nada se envía al backend · todo se borra al salir
      </span>
      <button
        type="button"
        class="btn training-banner__button"
        tabIndex={-1}
        onMouseDown={keepFocusOnMouseDown}
        onClick={() => void toggleTraining()}
      >
        Salir del entrenamiento (/ENTRENAMIENTO)
      </button>
    </div>
  );
}
