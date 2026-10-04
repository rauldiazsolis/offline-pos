import { render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { trainingScreenSignal } from '../state/training.ts';
import { TrainingScreen } from './training-screen.tsx';

afterEach(() => {
  trainingScreenSignal.value = null;
});

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name });
}

describe('pantalla de entrenamiento (#177)', () => {
  it('al entrar explica el modo, avisa lo pendiente y ofrece entrar', () => {
    trainingScreenSignal.value = { mode: 'enter', phase: 'ready', pending: 2 };
    render(<TrainingScreen />);

    expect(screen.getByRole('heading', { name: 'Entrar al entrenamiento' })).not.toBeNull();
    expect(screen.getByText(/Nada se envía al backend/)).not.toBeNull();
    expect(screen.getByText(/Hay 2 operaciones sin enviar/)).not.toBeNull();
    expect(button('Entrar al entrenamiento (Enter)').disabled).toBe(false);
    expect(button('Cancelar (Esc)').disabled).toBe(false);
  });

  it('con una sola operación pendiente, en singular; sin pendientes, no dice nada', () => {
    trainingScreenSignal.value = { mode: 'enter', phase: 'ready', pending: 1 };
    const { unmount } = render(<TrainingScreen />);
    expect(screen.getByText(/Hay 1 operación sin enviar/)).not.toBeNull();
    unmount();

    trainingScreenSignal.value = { mode: 'enter', phase: 'ready', pending: 0 };
    render(<TrainingScreen />);
    expect(screen.queryByText(/sin enviar/)).toBeNull();
  });

  it('mientras prepara, los botones quedan deshabilitados', () => {
    trainingScreenSignal.value = { mode: 'enter', phase: 'starting', pending: 0 };
    render(<TrainingScreen />);

    expect(screen.getByText('Preparando…')).not.toBeNull();
    expect(button('Entrar al entrenamiento (Enter)').disabled).toBe(true);
    expect(button('Cancelar (Esc)').disabled).toBe(true);
  });

  it('al salir lista lo que se descarta y lo que vuelve', () => {
    trainingScreenSignal.value = {
      mode: 'exit',
      phase: 'ready',
      discard: { lines: ['1 venta', 'La venta en curso'] },
    };
    render(<TrainingScreen />);

    expect(screen.getByRole('heading', { name: 'Salir del entrenamiento' })).not.toBeNull();
    expect(screen.getByText('1 venta')).not.toBeNull();
    expect(screen.getByText('La venta en curso')).not.toBeNull();
    expect(screen.getByText(/Vuelven el stock, los saldos y el resumen reales/)).not.toBeNull();
    expect(button('Descartar y salir (Enter)').className).toContain('btn-danger');
    expect(button('Seguir entrenando (Esc)').disabled).toBe(false);
  });
});
