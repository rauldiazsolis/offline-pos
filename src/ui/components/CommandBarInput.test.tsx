import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogSearchResult } from '../../domain/catalog-search.ts';
import type { CustomerSearchResult } from '../../domain/customer-search.ts';
import { db } from '../../storage/db.ts';
import { CommandBarInput } from './CommandBarInput.tsx';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import {
  commandBarBufferSignal,
  commandBarErrorSignal,
  customerSelectionIndexSignal,
  searchSelectionIndexSignal,
} from '../state/command-bar.ts';
import { setCatalogRepository } from '../state/catalog.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { attachedCustomerSignal } from '../state/customer.ts';

const arrozResult: CatalogSearchResult = {
  product: {
    id: 'p1',
    sku: 'SKU-1',
    barcodes: ['111'],
    name: 'Arroz 1kg',
    price: 100,
    taxRate: 0.21,
    category: 'almacen',
    tracksStock: true,
  },
  score: 1,
};

const anaResult: CustomerSearchResult = {
  customer: { id: 'c1', name: 'Ana García', createdAt: '2026-01-01T00:00:00.000Z' },
  score: 1,
};

beforeEach(async () => {
  await db.open();
  commandBarBufferSignal.value = '';
  commandBarErrorSignal.value = null;
  searchSelectionIndexSignal.value = null;
  customerSelectionIndexSignal.value = null;
  cartSelectionIndexSignal.value = null;
  cartSignal.value = { lines: [] };
  attachedCustomerSignal.value = undefined;
  setCatalogRepository({
    search: (query) => (query.toLowerCase().includes('arroz') ? [arrozResult] : []),
    findByBarcodeOrSku: () => undefined,
    getProduct: () => undefined,
    getStock: () => Promise.resolve({ productId: 'p1', quantity: 10, updatedAt: '' }),
  });
  setCustomerRepository({
    search: (query) => (query.toLowerCase().includes('ana') ? [anaResult] : []),
    getCustomer: () => undefined,
    getCustomerAccount: () => Promise.resolve(undefined),
  });
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('CommandBarInput', () => {
  it('un código de barras en progreso no dispara ningún resultado de búsqueda', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '7798787667' } });

    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('un texto no numérico muestra los resultados de búsqueda en vivo', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: 'arroz' } });

    expect(screen.getByText('Arroz 1kg')).not.toBeNull();
  });

  it('agrega el producto al confirmar una búsqueda con Enter', async () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: 'arroz' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(cartSignal.value.lines).toHaveLength(1);
    });
  });

  it('muestra un error cuando el parseo falla', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '$100' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByRole('alert')).not.toBeNull();
  });

  it('el error se limpia al editar el input', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '$100' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).not.toBeNull();

    fireEvent.input(input, { target: { value: '$1000' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"@" con match muestra resultados de cliente en vivo', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@ana' } });

    expect(screen.getByText('Ana García')).not.toBeNull();
  });

  it('"@" con match adjunta el cliente existente al confirmar con Enter', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@ana' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(attachedCustomerSignal.value?.id).toBe('c1');
  });

  it('"@" sin match ofrece crear un cliente nuevo, y Enter lo crea y adjunta', async () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@Nuevo Cliente' } });
    expect(screen.getByText('+ Crear cliente "Nuevo Cliente"', { exact: false })).not.toBeNull();

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(attachedCustomerSignal.value?.name).toBe('Nuevo Cliente');
    });
  });

  it('"@" vacío + Enter desadjunta el cliente actual', () => {
    attachedCustomerSignal.value = { id: 'c1', name: 'Ana García', createdAt: '' };
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '@' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(attachedCustomerSignal.value).toBeUndefined();
  });

  it('recupera el foco al remontarse (volver de un popup con Esc)', () => {
    // Regresión del bug reportado: la barra de comandos usaba `autoFocus`
    // nativo en vez del mismo patrón imperativo que el resto de las
    // pantallas — al desmontarse y volver a montarse (exactamente lo que
    // pasa al volver de /COBRAR, /ANULAR, /CONFIG o el comprobante con Esc),
    // el foco no se recuperaba de forma confiable.
    const first = render(<CommandBarInput />);
    first.unmount();

    render(<CommandBarInput />);

    expect(document.activeElement).toBe(screen.getByLabelText('Barra de comandos'));
  });

  it('con solo "/" muestra la lista completa de comandos disponibles', () => {
    render(<CommandBarInput />);
    const input = screen.getByLabelText('Barra de comandos');

    fireEvent.input(input, { target: { value: '/' } });

    expect(screen.getByText('/COBRAR', { exact: false })).not.toBeNull();
    expect(screen.getByText('/ANULAR', { exact: false })).not.toBeNull();
  });
});
