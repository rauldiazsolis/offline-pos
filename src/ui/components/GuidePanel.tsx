import type { JSX } from 'preact';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { closeGuide, doIt, guidePrimaryAction, nextLesson } from '../keyboard/guide-controller.ts';
import { typedProgress, type GuideSnapshot, type GuideStep } from '../keyboard/guide-model.ts';
import {
  guideLessonsSignal,
  guideRunningSignal,
  guideSignal,
  guideSnapshotSignal,
} from '../state/guide.ts';

/** Lo que va en el campo donde se escribe el texto del paso (la barra o un medio de Cobro). */
function typedFor(step: GuideStep, snapshot: GuideSnapshot): string {
  if (step.target === undefined) {
    return '';
  }
  return step.target.where === 'bar' ? snapshot.buffer : snapshot.checkout[step.target.method];
}

/** El texto a escribir, con lo que ya coincide en verde y el primer carácter distinto en rojo. */
function ExpectedText(props: { text: string; typed: string }) {
  const { matched, wrongAt } = typedProgress(props.text, props.typed);
  const wrong = wrongAt !== null && wrongAt < props.text.length ? 1 : 0;
  return (
    <code class="guide-panel__text" data-guide-text>
      <span class="guide-panel__text-ok">{props.text.slice(0, matched)}</span>
      <span class="guide-panel__text-wrong">{props.text.slice(matched, matched + wrong)}</span>
      {props.text.slice(matched + wrong)}
    </code>
  );
}

/** Un botón del panel: nunca le saca el foco a la pantalla ni entra en el orden de Tab. */
function PanelButton(props: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      class={props.primary === true ? 'btn btn-primary' : 'btn'}
      tabIndex={-1}
      disabled={props.disabled}
      onMouseDown={keepFocusOnMouseDown}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function Panel(props: {
  title: JSX.Element | string;
  say: JSX.Element | string;
  hint?: string | undefined;
  actions: JSX.Element;
}) {
  return (
    <div class="guide-panel" role="region" aria-label="Guía de entrenamiento">
      <div class="guide-panel__body">
        <div class="guide-panel__line guide-panel__title">{props.title}</div>
        <div class="guide-panel__say" aria-live="polite">
          {props.say}
        </div>
        <div class="guide-panel__line guide-panel__hint">{props.hint ?? ''}</div>
      </div>
      <div class="guide-panel__actions">{props.actions}</div>
    </div>
  );
}

const close = <PanelButton label="Cerrar guía" onClick={closeGuide} />;

/**
 * La guía de entrenamiento (#226), debajo de la franja: el paso actual con lo que hay que escribir
 * (marcado en vivo), una pista si algo se fue para otro lado, y "Hacelo (F2)". Los botones no toman
 * el foco: el teclado llega por F2 y por `/GUIA`.
 */
export function GuidePanel() {
  const state = guideSignal.value;
  if (state === null) {
    return null;
  }
  const lessons = guideLessonsSignal.value;
  const lessonLabel = (index: number) => (
    <>
      Guía · Lección {index + 1} de {lessons.length} ·{' '}
      <strong>{lessons[index]?.title ?? ''}</strong>
    </>
  );

  switch (state.phase) {
    case 'unavailable':
      return (
        <Panel
          title="Guía"
          say={state.reason}
          actions={<PanelButton label="Cerrar guía (F2)" primary onClick={closeGuide} />}
        />
      );
    case 'finished':
      return (
        <Panel
          title={<strong>Guía terminada</strong>}
          say="Listo: seguís en el entrenamiento, probá lo que quieras. Para volver a la caja real, /ENTRENAMIENTO."
          actions={
            <PanelButton
              label="Cerrar guía (F2)"
              primary
              onClick={() => void guidePrimaryAction()}
            />
          }
        />
      );
    case 'lesson-done':
      return (
        <Panel
          title={lessonLabel(state.lesson)}
          say={`¡Bien! Terminaste "${lessons[state.lesson]?.title ?? ''}".`}
          actions={
            <>
              <PanelButton label="Siguiente lección (F2)" primary onClick={nextLesson} />
              {close}
            </>
          }
        />
      );
    case 'waiting':
      return (
        <Panel
          title={lessonLabel(state.lesson)}
          say="Volvé a la venta para empezar la lección (Esc)."
          actions={
            <>
              <PanelButton label="Saltar lección" onClick={nextLesson} />
              {close}
            </>
          }
        />
      );
    case 'step': {
      const lesson = lessons[state.lesson];
      const step = lesson?.steps[state.step];
      if (lesson === undefined || step === undefined) {
        return null;
      }
      const snapshot = guideSnapshotSignal.value;
      const say = step.say(snapshot);
      const running = guideRunningSignal.value;
      const mismatch =
        say.text !== undefined &&
        typedProgress(say.text, typedFor(step, snapshot)).wrongAt !== null;
      return (
        <Panel
          title={
            <>
              {lessonLabel(state.lesson)} · paso {state.step + 1} de {lesson.steps.length}
            </>
          }
          say={
            <>
              {say.before}
              {say.text !== undefined && (
                <ExpectedText text={say.text} typed={typedFor(step, snapshot)} />
              )}
              {/* El texto resaltado ya tiene su margen a los costados. */}
              {say.after !== undefined && (say.text !== undefined ? say.after : ` ${say.after}`)}
            </>
          }
          hint={
            running
              ? 'Mirá cómo se hace. Cualquier tecla lo frena.'
              : (step.hint?.(snapshot) ??
                (mismatch ? 'No coincide: borrá hasta lo que está en verde.' : undefined))
          }
          actions={
            <>
              <PanelButton
                label={running ? 'Haciéndolo…' : 'Hacelo (F2)'}
                primary
                disabled={running}
                onClick={() => void doIt()}
              />
              <PanelButton label="Saltar lección" onClick={nextLesson} />
              {close}
            </>
          }
        />
      );
    }
  }
}
