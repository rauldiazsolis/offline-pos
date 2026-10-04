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
    trainingScreenSignal.value = {
      mode: 'enter',
      phase: 'ready',
      pending: 'Sin enviar: 1 venta y 1 movimiento más.',
    };
    render(<TrainingScreen />);

    expect(screen.getByRole('heading', { name: 'Entrar al entrenamiento' })).not.toBeNull();
    expect(screen.getByText(/Nada se envía al backend/)).not.toBeNull();
    expect(screen.getByText('Sin enviar: 1 venta y 1 movimiento más.')).not.toBeNull();
    expect(button('Entrar al entrenamiento (Enter)').disabled).toBe(false);
    expect(button('Cancelar (Esc)').disabled).toBe(false);
  });

  it('sin pendientes no dice nada de lo sin enviar', () => {
    trainingScreenSignal.value = { mode: 'enter', phase: 'ready' };
    render(<TrainingScreen />);
    expect(screen.queryByText(/Sin enviar/)).toBeNull();
  });

  it('mientras prepara, los botones quedan deshabilitados', () => {
    trainingScreenSignal.value = { mode: 'enter', phase: 'starting' };
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
