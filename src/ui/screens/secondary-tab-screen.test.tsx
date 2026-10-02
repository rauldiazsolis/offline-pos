import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { SecondaryTabScreen } from './secondary-tab-screen.tsx';

const BUTTON = 'Usar esta pestaña (Enter)';

describe('SecondaryTabScreen (#175)', () => {
  it('avisa que el POS está en otra pestaña, con el botón enfocado', () => {
    render(<SecondaryTabScreen displaced={false} onTakeOver={() => Promise.resolve()} />);
    expect(
      screen.getByRole('heading', { name: 'El POS está abierto en otra pestaña' }),
    ).not.toBeNull();
    expect(
      screen.getByText(
        'Este navegador ya lo está usando en otra pestaña o ventana. Volvé a esa, o usalo acá: la otra se recarga y queda sin usar.',
      ),
    ).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: BUTTON }));
    expect(screen.queryByText('Se empezó a usar el POS en otra pestaña.')).toBeNull();
  });

  it('si la desplazaron, lo dice', () => {
    render(<SecondaryTabScreen displaced onTakeOver={() => Promise.resolve()} />);
    expect(screen.getByText('Se empezó a usar el POS en otra pestaña.')).not.toBeNull();
  });

  it('el botón pide el traspaso una sola vez y muestra que está tomando el control', () => {
    const onTakeOver = vi.fn(() => new Promise<void>(() => undefined));
    render(<SecondaryTabScreen displaced={false} onTakeOver={onTakeOver} />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    const taking = screen.getByRole('button', { name: 'Tomando el control…' });
    expect(taking.hasAttribute('disabled')).toBe(true);
    fireEvent.click(taking);
    expect(onTakeOver).toHaveBeenCalledTimes(1);
  });

  it('un mousedown sobre el texto no le saca el foco al botón', () => {
    render(<SecondaryTabScreen displaced={false} onTakeOver={() => Promise.resolve()} />);
    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    screen.getByRole('heading').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
