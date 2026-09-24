import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmDemoReset, exitDemoResetScreen } from '../keyboard/demo-reset-controller.ts';
import { demoResetErrorSignal, demoResetInProgressSignal } from '../state/demo-reset.ts';
import { DemoResetScreen } from './demo-reset-screen.tsx';

vi.mock('../keyboard/demo-reset-controller.ts', () => ({
  confirmDemoReset: vi.fn(() => Promise.resolve()),
  exitDemoResetScreen: vi.fn(),
}));

beforeEach(() => {
  demoResetErrorSignal.value = null;
  demoResetInProgressSignal.value = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DemoResetScreen — teclado + mouse (Etapa 2 de #94)', () => {
  it('botones de confirmar y cancelar', () => {
    render(<DemoResetScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar demo (Enter)' }));
    expect(confirmDemoReset).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar (Esc)' }));
    expect(exitDemoResetScreen).toHaveBeenCalled();
  });

  it('mientras reinicia, los botones quedan deshabilitados', () => {
    demoResetInProgressSignal.value = true;
    render(<DemoResetScreen />);
    expect(
      screen.getByRole('button', { name: 'Reiniciar demo (Enter)' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('un mousedown sobre el título no le saca el foco a la pantalla', () => {
    render(<DemoResetScreen />);
    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    screen.getByText('Reiniciar demo').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
