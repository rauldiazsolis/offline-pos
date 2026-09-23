import type { TargetedKeyboardEvent } from 'preact';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { confirmDemoReset, exitDemoResetScreen } from '../keyboard/demo-reset-controller.ts';
import { demoResetErrorSignal, demoResetInProgressSignal } from '../state/demo-reset.ts';

const buttonStyle = {
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 'var(--radius-md)',
  whiteSpace: 'nowrap' as const,
  cursor: 'pointer',
};

/**
 * `/DEMO_RESET` (Ciclo 8, retoma el issue #36): pantalla de confirmación
 * dedicada, mismo patrón que `/ANULAR` — a diferencia de esa, es un solo
 * paso: no hay nada que elegir (o se reinicia todo, o no se hace nada), así
 * que no hace falta la lista previa. Teclado + mouse (Etapa 2 de #94): cada
 * atajo tiene su botón.
 */
export function DemoResetScreen() {
  const containerRef = useFocusOnMount<HTMLDivElement>();
  const inProgress = demoResetInProgressSignal.value;

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    // Un botón enfocado con Tab se activa solo con Enter (nativo): no duplicar
    // la acción con el atajo del contenedor.
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!demoResetInProgressSignal.value) {
        void confirmDemoReset();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      exitDemoResetScreen();
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
      <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Reiniciar demo</h1>

      <div
        style={{
          border: '1px solid var(--color-danger)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3)',
        }}
      >
        <p style={{ margin: '0 0 var(--space-2)' }}>
          Esto borra catálogo, stock, clientes, ventas, turnos de caja y el outbox pendiente de esta
          terminal, y vuelve a sembrar el catálogo y los clientes de ejemplo. La conexión
          configurada en /CONFIG no se toca.
        </p>
        <p style={{ margin: 0, fontWeight: 'bold', color: 'var(--color-danger)' }}>
          {demoResetInProgressSignal.value
            ? 'Reiniciando…'
            : '¿Reiniciar la demo? Enter confirma, Esc cancela.'}
        </p>
      </div>

      <div style={{ minHeight: 'var(--space-8)' }}>
        {demoResetErrorSignal.value !== null && (
          <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
            {demoResetErrorSignal.value}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="button"
          onClick={exitDemoResetScreen}
          disabled={inProgress}
          style={buttonStyle}
        >
          Cancelar (Esc)
        </button>
        <button
          type="button"
          onClick={() => void confirmDemoReset()}
          disabled={inProgress}
          style={buttonStyle}
        >
          Reiniciar demo (Enter)
        </button>
      </div>
    </div>
  );
}
