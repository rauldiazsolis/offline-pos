import { advance, handleWizardEscape } from '../keyboard/config-controller.ts';

/** Stub temporal mientras se rehace `/CONFIG` como wizard (la Tarea 8 del plan lo reemplaza). */
export function ConfigScreen() {
  return (
    <div
      role="dialog"
      aria-label="Configurar conexión"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') handleWizardEscape();
        if (event.key === 'Enter') advance();
      }}
    >
      <h1>Configurar conexión</h1>
    </div>
  );
}
