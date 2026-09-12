import { render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { CartView } from './CartView.tsx';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import { setCatalogRepository } from '../state/catalog.ts';

beforeEach(() => {
  cartSignal.value = { lines: [] };
  cartSelectionIndexSignal.value = null;
  setCatalogRepository({
    search: () => [],
    findByBarcodeOrSku: () => undefined,
    getProduct: (id) =>
      id === 'p1'
        ? {
            id: 'p1',
            sku: 'SKU-1',
            barcodes: [],
            name: 'Arroz 1kg',
            price: 100,
            taxRate: 0.21,
            category: 'almacen',
            tracksStock: true,
          }
        : undefined,
    getStock: () => Promise.resolve(undefined),
  });
});

describe('CartView', () => {
  it('muestra "carrito vacío" cuando no hay líneas', () => {
    render(<CartView />);
    expect(screen.getByText('El carrito está vacío.')).not.toBeNull();
  });

  it('resuelve el nombre del producto para una línea de tipo product', () => {
    cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] };
    render(<CartView />);
    expect(screen.getByText(/Arroz 1kg/)).not.toBeNull();
  });

  it('muestra la descripción para una línea libre', () => {
    cartSignal.value = {
      lines: [{ kind: 'freeform', description: 'Envío', qty: 1, unitPrice: 500 }],
    };
    render(<CartView />);
    expect(screen.getByText(/Envío/)).not.toBeNull();
  });

  it('muestra el total del carrito', () => {
    cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] };
    render(<CartView />);
    expect(screen.getByText('Total')).not.toBeNull();
  });
});
