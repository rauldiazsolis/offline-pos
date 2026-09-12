import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogSearchResult } from '../../domain/catalog-search.ts';
import { CommandBarInput } from './CommandBarInput.tsx';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import {
  commandBarBufferSignal,
  commandBarErrorSignal,
  searchSelectionIndexSignal,
} from '../state/command-bar.ts';
import { setCatalogRepository } from '../state/catalog.ts';

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

beforeEach(() => {
  commandBarBufferSignal.value = '';
  commandBarErrorSignal.value = null;
  searchSelectionIndexSignal.value = null;
  cartSelectionIndexSignal.value = null;
  cartSignal.value = { lines: [] };
  setCatalogRepository({
    search: (query) => (query.toLowerCase().includes('arroz') ? [arrozResult] : []),
    findByBarcodeOrSku: () => Promise.resolve(undefined),
    getProduct: () => Promise.resolve(undefined),
    getStock: () => Promise.resolve({ productId: 'p1', quantity: 10, updatedAt: '' }),
  });
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
});
