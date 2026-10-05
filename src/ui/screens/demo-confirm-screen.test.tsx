import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelDemoConfirm, confirmDemo } from '../keyboard/demo-confirm-controller.ts';
import type { DemoLoss } from '../keyboard/demo-confirm-model.ts';
import { demoConfirmSignal } from '../state/demo-confirm.ts';
import { DemoConfirmScreen } from './demo-confirm-screen.tsx';

vi.mock('../keyboard/demo-confirm-controller.ts', () => ({
  confirmDemo: vi.fn(() => Promise.resolve()),
  cancelDemoConfirm: vi.fn(),
}));

const ENTRY = { backend: 'https://b.x/connector' };
const LOSS: DemoLoss = {
  pending: 'Sin enviar a erp.x: 1 venta. Se pierden para siempre.',
  draft: 'La venta en curso (2 líneas).',
  history: 'El historial de esta terminal (1 venta): se borra de esta terminal.',
  connection: 'Conexión a erp.x. Se reemplaza por la de la demo.',
};

beforeEach(() => {
  demoConfirmSignal.value = { phase: 'confirming', entry: ENTRY, loss: LOSS };
});

afterEach(() => {
  demoConfirmSignal.value = null;
  vi.clearAllMocks();
});

function container(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'Abrir una demo' });
  const root = heading.parentElement;
  if (root === null) throw new Error('sin contenedor');
  return root;
}

describe('DemoConfirmScreen (#176)', () => {
  it('muestra de dónde es el link, lo que se pierde y lo que se conserva', () => {
    render(<DemoConfirmScreen />);
    expect(screen.getByText('Se abrió un link de demo de b.x.')).not.toBeNull();
    for (const text of Object.values(LOSS)) {
      expect(screen.getByText(text)).not.toBeNull();
    }
    expect(
      screen.getByText(
        'Se conservan el formato de impresión (/IMPRESORA) y el formato de números.',
      ),
    ).not.toBeNull();
  });

  it('botones de cancelar y confirmar', () => {
    render(<DemoConfirmScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Borrar y abrir la demo (Enter)' }));
    expect(confirmDemo).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar (Esc)' }));
    expect(cancelDemoConfirm).toHaveBeenCalled();
  });

  it('Enter confirma y Esc cancela; Enter sobre un botón enfocado no repite el atajo', () => {
    render(<DemoConfirmScreen />);
    fireEvent.keyDown(container(), { key: 'Enter' });
    expect(confirmDemo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(container(), { key: 'Escape' });
    expect(cancelDemoConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancelar (Esc)' }), { key: 'Enter' });
    expect(confirmDemo).toHaveBeenCalledTimes(1);
  });

  it('mientras revisa: lo dice y los botones están deshabilitados', () => {
    demoConfirmSignal.value = { phase: 'checking', entry: ENTRY };
    render(<DemoConfirmScreen />);
    expect(screen.getByText('Revisando los datos de esta terminal…')).not.toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Borrar y abrir la demo (Enter)' })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancelar (Esc)' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('mientras abre la demo: lo dice', () => {
    demoConfirmSignal.value = { phase: 'starting', entry: ENTRY, loss: LOSS };
    render(<DemoConfirmScreen />);
    expect(screen.getByText('Abriendo la demo…')).not.toBeNull();
  });

  it('un mousedown sobre el título no le saca el foco a la pantalla', () => {
    render(<DemoConfirmScreen />);
    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    screen.getByRole('heading', { name: 'Abrir una demo' }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
