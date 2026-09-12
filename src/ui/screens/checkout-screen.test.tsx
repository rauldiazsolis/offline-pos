import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { CheckoutScreen } from './checkout-screen.tsx';
import { cartSignal } from '../state/cart.ts';
import {
  checkoutBufferSignal,
  checkoutErrorSignal,
  checkoutPaymentsSignal,
} from '../state/checkout.ts';
import { activeScreenSignal } from '../state/screen.ts';

beforeEach(() => {
  cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
  checkoutPaymentsSignal.value = [];
  checkoutBufferSignal.value = '';
  checkoutErrorSignal.value = null;
  activeScreenSignal.value = 'checkout';
});

describe('CheckoutScreen', () => {
  it('muestra el total del carrito', () => {
    render(<CheckoutScreen />);
    expect(screen.getByText('Total')).not.toBeNull();
  });

  it('Escape cancela el cobro y vuelve a la pantalla de venta', () => {
    render(<CheckoutScreen />);
    const input = screen.getByLabelText('Monto a cobrar');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('muestra un error con un monto inválido', () => {
    render(<CheckoutScreen />);
    const input = screen.getByLabelText('Monto a cobrar');

    fireEvent.input(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByRole('alert')).not.toBeNull();
  });
});
