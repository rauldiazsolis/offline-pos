import { availableCommands } from '../../../src/ui/keyboard/commands.ts';
import {
  submitCommandBar,
  updateCommandBarBuffer,
} from '../../../src/ui/keyboard/command-bar-controller.ts';
import {
  commandResultsSignal,
  commandSelectionIndexSignal,
} from '../../../src/ui/state/command-bar.ts';
import { moreOpenSignal } from '../state/nav.ts';

/** Lo que ya tiene su lugar en el mobile: las pestañas y el botón Cobrar. */
const SHOWN_ELSEWHERE = new Set(['COBRAR', 'CAJA', 'RESUMEN']);

/** Cómo se llama cada comando en el menú; el resto, con su nombre de escritorio. */
const TITLES: Record<string, string> = {
  ANULAR: 'Anular una venta o cobranza',
  DESCARTAR: 'Descartar la venta en curso',
  CONFIG: 'Conexión y terminal',
  IMPRESORA: 'Impresora',
  SINCRONIZAR: 'Sincronizar ahora',
  DIAGNOSTICO: 'Diagnóstico',
  ENTRENAMIENTO: 'Modo entrenamiento',
  ACTUALIZAR: 'Actualizar el POS',
  ALTA: 'Crear mi comercio',
  DEMO_NUEVA: 'Empezar una demo nueva',
  DEMO_RESET: 'Reiniciar la demo',
};

/**
 * Corre un comando por el mismo despachador que la barra de escritorio (`/NOMBRE` + Enter), así
 * cada comando, los del conector y el del portal del backend incluidos, hace lo mismo acá.
 */
function runCommand(name: string): void {
  moreOpenSignal.value = false;
  updateCommandBarBuffer(`/${name}`);
  const index = commandResultsSignal.value.findIndex((command) => command.name === name);
  commandSelectionIndexSignal.value = index === -1 ? null : index;
  submitCommandBar();
}

/** "Más": el resto de los comandos del POS, con su motivo cuando no están disponibles. */
export function MoreScreen() {
  const commands = availableCommands().filter((command) => !SHOWN_ELSEWHERE.has(command.name));
  return (
    <div class="page">
      <h2>Más</h2>
      <div class="card list">
        {commands.map((command) => {
          const availability = command.availability?.() ?? { enabled: true };
          return (
            <button
              key={command.name}
              type="button"
              class="item"
              disabled={!availability.enabled}
              data-command={command.name}
              onClick={() => {
                runCommand(command.name);
              }}
            >
              <span class="main">
                <div class="title">{TITLES[command.name] ?? command.description}</div>
                <div class="sub">
                  {availability.enabled
                    ? command.description
                    : `No disponible: ${availability.reason}`}
                </div>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
