import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogSearchResult } from '../../domain/catalog-search.ts';
import { commandBarBufferSignal, parsedSignal, searchResultsSignal } from './command-bar.ts';
import { setCatalogRepository } from './catalog.ts';
import { cartSignal } from './cart.ts';

const fakeResult: CatalogSearchResult = {
  product: {
    id: 'p1',
    sku: 'SKU-1',
    barcodes: [],
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
  cartSignal.value = { lines: [] };
  setCatalogRepository({
    search: (query) => (query === 'arroz' ? [fakeResult] : []),
    findByBarcodeOrSku: () => undefined,
    getProduct: () => undefined,
    getStock: () => Promise.resolve(undefined),
  });
});

describe('parsedSignal', () => {
  it('se recalcula al cambiar el buffer', () => {
    commandBarBufferSignal.value = '/cobrar';
    expect(parsedSignal.value).toEqual({ kind: 'command', name: 'COBRAR', args: [] });

    commandBarBufferSignal.value = 'arroz';
    expect(parsedSignal.value).toEqual({ kind: 'search', query: 'arroz', qty: 1 });
  });
});

describe('searchResultsSignal', () => {
  it('consulta el repositorio de catálogo cuando el buffer resuelve a búsqueda', () => {
    commandBarBufferSignal.value = 'arroz';
    expect(searchResultsSignal.value).toEqual([{ kind: 'product', result: fakeResult }]);
  });

  it('devuelve vacío cuando el buffer no resuelve a búsqueda', () => {
    commandBarBufferSignal.value = '/cobrar';
    expect(searchResultsSignal.value).toEqual([]);
  });

  it('incluye líneas libres del carrito que matchean, antes que el catálogo', () => {
    cartSignal.value = {
      lines: [{ kind: 'freeform', description: 'Envío a domicilio', qty: 2, unitPrice: 500 }],
    };
    commandBarBufferSignal.value = 'domicilio';
    expect(searchResultsSignal.value).toEqual([
      { kind: 'freeform-line', description: 'Envío a domicilio', unitPrice: 500, qtyInCart: 2 },
    ]);
  });

  it('mezcla líneas libres del carrito y productos del catálogo, líneas del carrito primero', () => {
    cartSignal.value = {
      lines: [{ kind: 'freeform', description: 'arroz de regalo', qty: 1, unitPrice: 10 }],
    };
    commandBarBufferSignal.value = 'arroz';
    expect(searchResultsSignal.value).toEqual([
      { kind: 'freeform-line', description: 'arroz de regalo', unitPrice: 10, qtyInCart: 1 },
      { kind: 'product', result: fakeResult },
    ]);
  });

  it('el match de línea libre no distingue mayúsculas/minúsculas', () => {
    cartSignal.value = {
      lines: [{ kind: 'freeform', description: 'ENVÍO', qty: 1, unitPrice: 100 }],
    };
    commandBarBufferSignal.value = 'envío';
    expect(searchResultsSignal.value).toEqual([
      { kind: 'freeform-line', description: 'ENVÍO', unitPrice: 100, qtyInCart: 1 },
    ]);
  });
});
