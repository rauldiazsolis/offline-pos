import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../storage/db.ts';
import { cartSignal } from '../state/cart.ts';
import { setCatalogRepository } from '../state/catalog.ts';
import { commandBarBufferSignal, overlayDismissedSignal } from '../state/command-bar.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { SaleScreen } from './sale-screen.tsx';

beforeEach(async () => {
  await db.open();
  commandBarBufferSignal.value = '';
  overlayDismissedSignal.value = false;
  cartSignal.value = { lines: [] };
  attachedCustomerSignal.value = undefined;
  setCatalogRepository({
    search: () => [],
    findByBarcodeOrSku: () => undefined,
    getProduct: () => undefined,
    getStock: () => Promise.resolve(undefined),
  });
  setCustomerRepository({
    search: () => [],
    listRecent: () => [],
    getCustomer: () => undefined,
    getCustomerAccount: () => Promise.resolve(undefined),
  });
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('SaleScreen — mouse (Etapa 2 de #94)', () => {
  it('click fuera del overlay lo cierra sin tocar el buffer', () => {
    render(<SaleScreen />);
    fireEvent.input(screen.getByLabelText('Barra de comandos'), { target: { value: '/' } });
    expect(screen.queryByText('/CAJA')).not.toBeNull();

    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    screen.getByText('Consumidor Final').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(overlayDismissedSignal.value).toBe(true);
    expect(commandBarBufferSignal.value).toBe('/');
  });

  it('el botón del medio no cierra el overlay ni se cancela (autoscroll)', () => {
    render(<SaleScreen />);
    fireEvent.input(screen.getByLabelText('Barra de comandos'), { target: { value: '/' } });

    const event = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true });
    screen.getByText('Consumidor Final').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(overlayDismissedSignal.value).toBe(false);
  });

  it('click dentro del overlay no lo cierra', () => {
    render(<SaleScreen />);
    fireEvent.input(screen.getByLabelText('Barra de comandos'), { target: { value: '/' } });

    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    screen.getByText('/CAJA').dispatchEvent(event);

    expect(overlayDismissedSignal.value).toBe(false);
  });
});
