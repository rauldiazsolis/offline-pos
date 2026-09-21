import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveSyncConfig } from '../../sync/config.ts';
import { CheckoutScreen } from './checkout-screen.tsx';
import { cartSignal } from '../state/cart.ts';
import { checkoutBuffersSignal, checkoutErrorSignal } from '../state/checkout.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { activeScreenSignal } from '../state/screen.ts';

function emptyBuffers() {
  return { cash: '', debit: '', credit: '', transfer: '', qr: '', account: '' };
}

function getInput(label: string): HTMLInputElement {
  // tsc -b exige este cast (getByLabelText devuelve HTMLElement); el
  // type-checker de eslint, sobre el mismo código, lo marca como
  // innecesario — desacuerdo real entre las dos herramientas, no algo que
  // se resuelva reescribiendo la expresión.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return screen.getByLabelText(label) as HTMLInputElement;
}

beforeEach(() => {
  cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
  checkoutBuffersSignal.value = emptyBuffers();
  checkoutErrorSignal.value = null;
  attachedCustomerSignal.value = undefined;
  activeScreenSignal.value = 'checkout';
});

afterEach(() => {
  localStorage.clear();
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

  it('un error selecciona el campo donde estaba el foco, no siempre Efectivo', () => {
    render(<CheckoutScreen />);
    const debitInput = screen.getByLabelText('Tarjeta de Débito');
    debitInput.focus();

    fireEvent.input(debitInput, { target: { value: '300' } });
    fireEvent.keyDown(debitInput, { key: 'Enter', ctrlKey: true });

    expect(screen.getByRole('alert')).not.toBeNull();
    expect(document.activeElement).toBe(debitInput);
  });

  it('el placeholder no sugiere que se pueda tipear un signo de moneda', () => {
    render(<CheckoutScreen />);
    expect(screen.getByLabelText('Efectivo').getAttribute('placeholder')).toBe('0,00');
  });

  it('un campo con texto que no parsea como monto se resalta, sin bloquear el tipeo', () => {
    render(<CheckoutScreen />);
    const input = screen.getByLabelText('Código QR');

    fireEvent.input(input, { target: { value: 'cualquier cosa' } });

    expect(input.style.borderColor).toBe('var(--color-danger)');
  });

  it('con locale es-AR, la tecla "." se reinterpreta como coma decimal', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', locale: 'es-AR' });
    render(<CheckoutScreen />);
    const input = getInput('Efectivo');

    fireEvent.input(input, { target: { value: '1' } });
    fireEvent.keyDown(input, { key: '.' });

    expect(input.value).toBe('1,');
  });

  it('con locale en-US, la tecla "," se reinterpreta como punto decimal', () => {
    render(<CheckoutScreen />);
    const input = getInput('Efectivo');

    fireEvent.input(input, { target: { value: '1' } });
    fireEvent.keyDown(input, { key: ',' });

    expect(input.value).toBe('1.');
  });

  it('no permite un segundo separador decimal', () => {
    render(<CheckoutScreen />);
    const input = getInput('Efectivo');

    fireEvent.input(input, { target: { value: '1.5' } });
    fireEvent.keyDown(input, { key: '.' });

    expect(input.value).toBe('1.5');
  });
});
