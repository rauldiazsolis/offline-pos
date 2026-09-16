import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { CheckoutScreen } from './checkout-screen.tsx';
import { cartSignal } from '../state/cart.ts';
import { checkoutBuffersSignal, checkoutErrorSignal } from '../state/checkout.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { activeScreenSignal } from '../state/screen.ts';

function emptyBuffers() {
  return { cash: '', debit: '', credit: '', transfer: '', qr: '', account: '' };
}

beforeEach(() => {
  cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
  checkoutBuffersSignal.value = emptyBuffers();
  checkoutErrorSignal.value = null;
  attachedCustomerSignal.value = undefined;
  activeScreenSignal.value = 'checkout';
});

describe('CheckoutScreen', () => {
  it('muestra el total del carrito', () => {
    render(<CheckoutScreen />);
    expect(screen.getByText('Total a pagar')).not.toBeNull();
  });

  it('muestra un campo por cada medio de pago', () => {
    render(<CheckoutScreen />);
    expect(screen.getByLabelText('Efectivo')).not.toBeNull();
    expect(screen.getByLabelText('Tarjeta de Débito')).not.toBeNull();
    expect(screen.getByLabelText('Tarjeta de Crédito')).not.toBeNull();
    expect(screen.getByLabelText('Transferencia')).not.toBeNull();
    expect(screen.getByLabelText('Código QR')).not.toBeNull();
    expect(screen.getByLabelText('Cuenta corriente')).not.toBeNull();
  });

  it('el campo Cuenta corriente está deshabilitado sin cliente adjunto', () => {
    render(<CheckoutScreen />);
    expect(screen.getByLabelText('Cuenta corriente')).toHaveProperty('disabled', true);
  });

  it('el campo Cuenta corriente se habilita con un cliente adjunto', () => {
    attachedCustomerSignal.value = { id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' };
    render(<CheckoutScreen />);
    expect(screen.getByLabelText('Cuenta corriente')).toHaveProperty('disabled', false);
  });

  it('Escape cancela el cobro y vuelve a la pantalla de venta', () => {
    render(<CheckoutScreen />);
    const input = screen.getByLabelText('Efectivo');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('Enter solo no confirma el cobro', () => {
    render(<CheckoutScreen />);
    const input = screen.getByLabelText('Efectivo');

    fireEvent.input(input, { target: { value: '100' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(activeScreenSignal.value).toBe('checkout');
  });

  it('Ctrl+Enter con un monto inválido muestra un error', () => {
    render(<CheckoutScreen />);
    const input = screen.getByLabelText('Efectivo');

    fireEvent.input(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });

    expect(screen.getByRole('alert')).not.toBeNull();
  });
});
