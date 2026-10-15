import { render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { GuideLesson } from '../keyboard/guide-model.ts';
import { commandBarBufferSignal } from '../state/command-bar.ts';
import { guideLessonsSignal, guideRunningSignal, guideSignal } from '../state/guide.ts';
import { GuidePanel } from './GuidePanel.tsx';

const lesson: GuideLesson = {
  title: 'Tu primera venta',
  steps: [
    {
      say: () => ({ before: 'Escribí', text: 'arroz', after: 'y apretá Enter.' }),
      target: { where: 'bar' },
      done: () => false,
      hint: (s) => (s.buffer === 'arx' ? 'Lo que escribiste no coincide.' : undefined),
      demo: () => [],
    },
  ],
};

afterEach(() => {
  guideSignal.value = null;
  guideLessonsSignal.value = [];
  guideRunningSignal.value = false;
  commandBarBufferSignal.value = '';
});

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name });
}

describe('panel de la guía (#226)', () => {
  it('muestra el paso, marca lo que coincide y lo distinto, y da la pista', () => {
    guideLessonsSignal.value = [lesson, lesson];
    guideSignal.value = { phase: 'step', lesson: 0, step: 0, salesAtStart: 0 };
    commandBarBufferSignal.value = 'arx';
    const { container } = render(<GuidePanel />);

    expect(container.textContent).toContain('Lección 1 de 2');
    expect(container.textContent).toContain('paso 1 de 1');
    expect(container.querySelector('.guide-panel__text-ok')?.textContent).toBe('ar');
    expect(container.querySelector('.guide-panel__text-wrong')?.textContent).toBe('r');
    expect(screen.getByText('Lo que escribiste no coincide.')).not.toBeNull();
    expect(button('Hacelo (F2)').tabIndex).toBe(-1);
    expect(button('Saltar lección')).not.toBeNull();
    expect(button('Cerrar guía')).not.toBeNull();
  });

  it('sin pista propia, si lo escrito no coincide lo dice', () => {
    guideLessonsSignal.value = [lesson];
    guideSignal.value = { phase: 'step', lesson: 0, step: 0, salesAtStart: 0 };
    commandBarBufferSignal.value = 'az';
    render(<GuidePanel />);

    expect(screen.getByText('No coincide: borrá hasta lo que está en verde.')).not.toBeNull();
  });

  it('mientras "Hacelo" corre, avisa que cualquier tecla lo frena', () => {
    guideLessonsSignal.value = [lesson];
    guideSignal.value = { phase: 'step', lesson: 0, step: 0, salesAtStart: 0 };
    guideRunningSignal.value = true;
    render(<GuidePanel />);

    expect(button('Haciéndolo…').disabled).toBe(true);
    expect(screen.getByText('Mirá cómo se hace. Cualquier tecla lo frena.')).not.toBeNull();
  });

  it('entre lecciones ofrece la siguiente; al final, que sigue en entrenamiento', () => {
    guideLessonsSignal.value = [lesson, lesson];
    guideSignal.value = { phase: 'lesson-done', lesson: 0 };
    const { unmount } = render(<GuidePanel />);
    expect(screen.getByText('¡Bien! Terminaste "Tu primera venta".')).not.toBeNull();
    expect(button('Siguiente lección (F2)')).not.toBeNull();
    unmount();

    guideSignal.value = { phase: 'finished' };
    render(<GuidePanel />);
    expect(screen.getByText(/seguís en el entrenamiento/)).not.toBeNull();
    expect(button('Cerrar guía (F2)')).not.toBeNull();
  });
});
