import type { TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import {
  advance,
  applyWizard,
  backFromWipeConfirmation,
  confirmWipe,
  fastForward,
  goBack,
  handleWizardEscape,
  jumpToStep,
  moveLocalChoice,
  moveTypeChoice,
  retryProbe,
} from '../keyboard/config-controller.ts';
import {
  isReachable,
  WIZARD_STEPS,
  WIZARD_STEP_TITLES,
  type WizardModel,
  type WizardStepId,
} from '../keyboard/config-wizard-model.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { connectionStateSignal } from '../state/sync.ts';
import {
  configErrorFieldSignal,
  configErrorSignal,
  probeOutcomeSignal,
  wizardAsyncSignal,
  wizardModelSignal,
  wizardStepSignal,
  type WizardAsync,
} from '../state/sync-config.ts';
import { StepContent } from './config-wizard/steps.tsx';
import { stepSummary } from './config-wizard/summary.ts';

const overlayStyle = {
  height: 'var(--app-height)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-4)',
  background: 'var(--color-surface)',
};

// Alto fijo (no el del contenido de cada paso): la columna de pasos y el pie
// quedan siempre en el mismo lugar; solo el contenido del paso scrollea.
const dialogStyle = {
  width: '100%',
  maxWidth: '860px',
  height: 'min(640px, 100%)',
  minHeight: 0,
  background: 'var(--color-bg)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-4)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-3)',
  color: 'var(--color-text)',
  fontFamily: 'var(--font-sans)',
  outline: 'none',
};

function statusMark(status: WizardModel['steps'][number]['status']): string {
  switch (status) {
    case 'complete':
      return '✓';
    case 'error':
      return '!';
    case 'skipped':
      return '—';
    case 'pending':
      return '';
  }
}

/** Columna izquierda: todos los pasos con su estado y lo cargado — nada queda oculto. */
function StepList({ model, current }: { model: WizardModel; current: WizardStepId }) {
  return (
    <nav aria-label="Pasos" style={{ overflowY: 'auto', minHeight: 0 }}>
      <ol
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
        }}
      >
        {model.steps.map((step) => {
          const isCurrent = step.id === current;
          const reachable = isReachable(model, step.id);
          const summary = stepSummary(step.id, model);
          const mark = statusMark(step.status);
          return (
            <li key={step.id}>
              <button
                type="button"
                class="wizard-step-button"
                aria-label={`Paso ${String(step.number)}: ${WIZARD_STEP_TITLES[step.id]}`}
                aria-current={isCurrent ? 'step' : undefined}
                disabled={!reachable && !isCurrent}
                onClick={() => {
                  jumpToStep(step.id);
                }}
                style={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: '1.75em 1fr auto',
                  columnGap: 'var(--space-2)',
                  alignItems: 'baseline',
                  textAlign: 'left',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  borderLeft: `3px solid ${isCurrent ? 'var(--color-accent)' : 'transparent'}`,
                  background: isCurrent ? 'var(--color-surface)' : 'transparent',
                  color:
                    step.status === 'skipped' || (!reachable && !isCurrent)
                      ? 'var(--color-text-muted)'
                      : 'var(--color-text)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--font-size-base)',
                  cursor: reachable ? 'pointer' : 'default',
                }}
              >
                <span style={{ fontWeight: 'bold' }}>{String(step.number)}.</span>
                <span style={{ fontWeight: isCurrent ? 'bold' : 'normal' }}>
                  {WIZARD_STEP_TITLES[step.id]}
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    color:
                      step.status === 'error'
                        ? 'var(--color-danger)'
                        : step.status === 'skipped'
                          ? 'var(--color-text-muted)'
                          : 'var(--color-success)',
                    fontWeight: 'bold',
                  }}
                >
                  {mark}
                </span>
                {/* Siempre presente y de alto fijo (dos renglones): completar un paso no
                    agranda su ítem ni corre la lista. El texto completo, en el title. */}
                <span class="wizard-step-summary" title={summary === '' ? undefined : summary}>
                  {summary}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function footerHint(async: WizardAsync, required: boolean): string {
  switch (async) {
    case 'probing':
      return 'Esc cancela la prueba.';
    case 'confirming-wipe':
      return 'Enter borra y cambia · Esc vuelve a las opciones.';
    case 'flushing':
    case 'applying':
      return '';
    case 'idle':
      return (
        'Enter siguiente · Alt+1…6 ir a un paso · Alt+← atrás · Ctrl+Enter avanzar hasta donde falte' +
        (required ? '' : ' · Esc cancelar')
      );
  }
}

function Footer(props: {
  step: WizardStepId;
  async: WizardAsync;
  required: boolean;
  model: WizardModel;
}) {
  const { step, async, required, model } = props;
  const busy = async === 'flushing' || async === 'applying';
  const outcome = probeOutcomeSignal.value;
  const probeFailed =
    step === 'probe' &&
    async === 'idle' &&
    outcome !== null &&
    outcome.key === model.connectionKey &&
    outcome.status !== 'ok';

  let buttons;
  if (async === 'confirming-wipe') {
    buttons = (
      <>
        <button type="button" onClick={backFromWipeConfirmation} class="btn">
          Volver (Esc)
        </button>
        <button type="button" class="btn btn-danger" onClick={() => void confirmWipe()}>
          Borrar y cambiar (Enter)
        </button>
      </>
    );
  } else if (async === 'probing') {
    buttons = (
      <button type="button" onClick={handleWizardEscape} class="btn">
        Cancelar prueba (Esc)
      </button>
    );
  } else if (probeFailed) {
    buttons = (
      <>
        <button
          type="button"
          onClick={() => {
            jumpToStep('connector');
          }}
          class="btn"
        >
          Corregir datos (Alt+3)
        </button>
        <button type="button" class="btn btn-primary" onClick={retryProbe}>
          Reintentar (Enter)
        </button>
      </>
    );
  } else {
    buttons = (
      <>
        {!required && (
          <button type="button" onClick={handleWizardEscape} disabled={busy} class="btn">
            Cancelar (Esc)
          </button>
        )}
        <button
          type="button"
          onClick={goBack}
          disabled={busy || step === WIZARD_STEPS[0]}
          class="btn"
        >
          Atrás (Alt+←)
        </button>
        {step === 'review' ? (
          <button
            type="button"
            onClick={() => void applyWizard()}
            disabled={busy}
            class="btn btn-primary"
          >
            Aplicar (Enter)
          </button>
        ) : (
          <button type="button" class="btn btn-primary" onClick={advance} disabled={busy}>
            Siguiente (Enter)
          </button>
        )}
      </>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 'var(--space-3)',
        borderTop: '1px solid var(--color-border)',
        paddingTop: 'var(--space-3)',
      }}
    >
      <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
        {footerHint(async, required)}
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>{buttons}</div>
    </div>
  );
}

/**
 * `/CONFIG` como wizard de instalación (Etapa 2 de #94, #97): columna de pasos
 * a la izquierda (resumen visible de todo lo cargado, click o Alt+N para
 * volver), el paso actual a la derecha, pie con atajos y botones. Las reglas
 * viven en `config-wizard-model.ts`; la orquestación en `config-controller.ts`.
 * Reemplaza para esta pantalla el criterio de #49 ("no un wizard secuencial
 * que oculta lo ya cargado"): lo cargado nunca se oculta, queda en la columna.
 * Teclado y mouse equivalentes (`keepFocusOnMouseDown`): cada botón llama a la
 * misma función que su atajo. Con la conexión todavía no activa es el **modo
 * requerido**: no hay "Cancelar" ni salida.
 */
export function ConfigScreen() {
  const dialogRef = useRef<HTMLDivElement>(null);
  const step = wizardStepSignal.value;
  const async = wizardAsyncSignal.value;
  const model = wizardModelSignal.value;
  const required = connectionStateSignal.value !== 'active';
  const errorField = configErrorFieldSignal.value;
  const error = configErrorSignal.value;

  // Foco al cambiar de paso o de estado: el primer control del paso, o el
  // diálogo si no tiene (así Enter/Esc siguen llegando). `useLayoutEffect`,
  // nunca `autoFocus` (ver `ui/hooks/`).
  useLayoutEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>('[data-step-autofocus]');
    (first ?? dialogRef.current)?.focus();
  }, [step, async]);

  // Un error apunta a un campo concreto: enfocarlo y seleccionarlo permite
  // retipear de una. Declarado después del efecto de paso: si cambian juntos, gana este.
  useLayoutEffect(() => {
    if (errorField === null || error === null) {
      return;
    }
    const input = dialogRef.current?.querySelector<HTMLInputElement>(
      `[data-config-field="${errorField}"]`,
    );
    input?.focus();
    input?.select();
  }, [errorField, error]);

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleWizardEscape();
      return;
    }
    if (event.altKey && /^[1-6]$/.test(event.key)) {
      event.preventDefault();
      const target = WIZARD_STEPS[Number(event.key) - 1];
      if (target !== undefined) {
        jumpToStep(target);
      }
      return;
    }
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      goBack();
      return;
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && async === 'idle') {
      if (step === 'type') {
        event.preventDefault();
        moveTypeChoice(event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (step === 'local-data') {
        event.preventDefault();
        moveLocalChoice();
        return;
      }
    }
    if (event.key === 'Enter' && event.ctrlKey) {
      // Ctrl+Enter avanza desde cualquier lado, también con el foco en un botón.
      event.preventDefault();
      fastForward();
      return;
    }
    if (event.key === 'Enter') {
      // Un botón enfocado se activa solo con Enter (nativo): no duplicar. La
      // excepción son las opciones de "Datos locales": ahí Enter confirma la
      // opción enfocada y avanza, igual que con el foco en el diálogo.
      if (
        event.target instanceof HTMLButtonElement &&
        !event.target.hasAttribute('data-enter-advances')
      ) {
        return;
      }
      event.preventDefault();
      advance();
    }
  };

  return (
    <div style={overlayStyle} onMouseDown={keepFocusOnMouseDown}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Configurar conexión"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={dialogStyle}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Configurar conexión</h1>
          {required && (
            <p style={{ margin: 'var(--space-1) 0 0', color: 'var(--color-text-muted)' }}>
              Configurá y probá la conexión para empezar.
            </p>
          )}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '240px 1fr',
            gap: 'var(--space-4)',
            minHeight: 0,
            flex: 1,
          }}
        >
          <StepList model={model} current={step} />
          <section
            aria-label={WIZARD_STEP_TITLES[step]}
            style={{
              overflowY: 'auto',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              // Margen para el anillo de foco: un contenedor con scroll recorta lo
              // que se dibuja por fuera de sus hijos (el anillo de un campo al borde).
              padding: 'var(--space-1) var(--space-2) var(--space-1) var(--space-1)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>
              {WIZARD_STEP_TITLES[step]}
            </h2>
            <StepContent step={step} model={model} />
          </section>
        </div>
        <Footer step={step} async={async} required={required} model={model} />
      </div>
    </div>
  );
}
