import { render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { setTrainingModeForTests } from '../../storage/training-mode.ts';
import { guideSignal } from '../state/guide.ts';
import { hadLocalMovementsSignal, noteOperation, resetOperations } from '../state/operations.ts';
import { EmptyCart } from './EmptyCart.tsx';

afterEach(() => {
  setTrainingModeForTests(null);
  guideSignal.value = null;
  resetOperations();
  hadLocalMovementsSignal.value = null;
});

describe('carrito vacío (#226)', () => {
  it('con la caja sin movimientos invita a la guía, con un botón que entra al entrenamiento', () => {
    hadLocalMovementsSignal.value = false;
    render(<EmptyCart />);

    expect(screen.getByText('¿Es la primera vez que usás el POS?')).not.toBeNull();
    const button = screen.getByRole('button', { name: 'Empezar la guía (/ENTRENAMIENTO)' });
    expect(button.tabIndex).toBe(-1);
  });

  it('la invitación se va con la primera operación', () => {
    hadLocalMovementsSignal.value = false;
    noteOperation('cash');
    render(<EmptyCart />);

    expect(screen.queryByText('¿Es la primera vez que usás el POS?')).toBeNull();
    expect(screen.getByText('El carrito está vacío.')).not.toBeNull();
  });

  it('con movimientos de antes, o sin contar todavía, el aviso de siempre', () => {
    render(<EmptyCart />);
    expect(screen.getByText('El carrito está vacío.')).not.toBeNull();
  });

  it('en entrenamiento sin la guía abierta, cómo abrirla', () => {
    setTrainingModeForTests({ startedAt: '2026-10-15T12:00:00.000Z' });
    hadLocalMovementsSignal.value = false;
    render(<EmptyCart />);

    expect(screen.queryByText('¿Es la primera vez que usás el POS?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir la guía (/GUIA)' })).not.toBeNull();
  });

  it('con la guía abierta, el aviso de siempre', () => {
    setTrainingModeForTests({ startedAt: '2026-10-15T12:00:00.000Z' });
    guideSignal.value = { phase: 'finished' };
    render(<EmptyCart />);
    expect(screen.getByText('El carrito está vacío.')).not.toBeNull();
  });
});
