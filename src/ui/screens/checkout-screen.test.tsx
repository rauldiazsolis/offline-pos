import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveSyncConfig } from '../../sync/config.ts';
import { CheckoutScreen } from './checkout-screen.tsx';
import { cartSignal } from '../state/cart.ts';
import { setCatalogRepository } from '../state/catalog.ts';
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

const blockedProduct = {
  id: 'p1',
  sku: 'SKU-1',
  barcodes: [],
  name: 'Coca',
  price: 100,
  taxRate: 0,
  category: 'c',
  tracksStock: false,
};

beforeEach(() => {
  setCatalogRepository({
    search: () => [],
    findByBarcodeOrSku: () => undefined,
    getProduct: () => undefined,
    getStock: () => Promise.resolve(undefined),
  });
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
    attachedCustomerSignal.value = {
      id: 'c1',
      name: 'Juan Pérez',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    render(<CheckoutScreen />);
    expect(screen.getByLabelText('Cuenta corriente')).toHaveProperty('disabled', false);
  });

  it('Escape cancela el cobro y vuelve a la pantalla de venta', () => {
    render(<CheckoutScreen />);
    const input = screen.getByLabelText('Efectivo');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('Enter solo no confirma el cobro (navega al campo siguiente, #99)', () => {
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

describe('CheckoutScreen — precarga, navegación y modo devolución (#99)', () => {
  it('al montar, Efectivo tiene el foco y su texto precargado seleccionado', () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '100' };
    render(<CheckoutScreen />);
    const cash = getInput('Efectivo');

    expect(document.activeElement).toBe(cash);
    expect(cash.selectionStart).toBe(0);
    expect(cash.selectionEnd).toBe(cash.value.length);
  });

  it('Enter y ↓ pasan al campo siguiente, ↑ al anterior', () => {
    render(<CheckoutScreen />);
    const cash = getInput('Efectivo');
    const debit = getInput('Tarjeta de Débito');
    const credit = getInput('Tarjeta de Crédito');

    fireEvent.keyDown(cash, { key: 'Enter' });
    expect(document.activeElement).toBe(debit);
    fireEvent.keyDown(debit, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(credit);
    fireEvent.keyDown(credit, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(debit);
  });

  it('Enter en el último campo habilitado no mueve el foco', () => {
    render(<CheckoutScreen />);
    const qr = getInput('Código QR');
    qr.focus();

    fireEvent.keyDown(qr, { key: 'Enter' });

    expect(document.activeElement).toBe(qr);
  });

  it('con total negativo: título "Devolver", sin tarjeta de vuelto', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', locale: 'es-AR' });
    cartSignal.value = {
      lines: [{ kind: 'freeform', description: 'dev', qty: -1, unitPrice: 500 }],
    };
    render(<CheckoutScreen />);

    expect(screen.getByRole('heading').textContent).toBe('Devolver 500,00');
    expect(screen.queryByText('Vuelto')).toBeNull();
    expect(screen.getByText('Total a devolver')).not.toBeNull();
  });

  it('botones con el atajo en la etiqueta y la acción principal destacada', () => {
    render(<CheckoutScreen />);
    const confirm = screen.getByRole('button', { name: 'Confirmar cobro (Ctrl+Enter)' });

    expect(confirm.className).toContain('btn-primary');
    expect(screen.getByRole('button', { name: 'Cancelar (Esc)' })).not.toBeNull();
  });
});

describe('CheckoutScreen — advertencias (#99)', () => {
  it('muestra el bloque de advertencias y no bloquea nada', () => {
    setCatalogRepository({
      search: () => [],
      findByBarcodeOrSku: () => undefined,
      getProduct: () => ({ ...blockedProduct, blocked: { reason: 'Vencido' } }),
      getStock: () => Promise.resolve(undefined),
    });
    attachedCustomerSignal.value = {
      id: 'c1',
      name: 'Ana',
      createdAt: '2026-01-01T00:00:00.000Z',
      blocked: { reason: 'Deuda' },
    };
    render(<CheckoutScreen />);

    const block = screen.getByRole('status');
    expect(block.textContent).toContain('Advertencias');
    expect(block.textContent).toContain('Coca: bloqueado — Vencido');
    expect(block.textContent).toContain('Cliente bloqueado — Deuda');
  });

  it('sin advertencias no hay bloque', () => {
    render(<CheckoutScreen />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
