import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogSearchResult } from '../../domain/catalog-search.ts';
import { commandBarBufferSignal, parsedSignal, searchResultsSignal } from './command-bar.ts';
import { setCatalogRepository } from './catalog.ts';

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
    expect(searchResultsSignal.value).toEqual([fakeResult]);
  });

  it('devuelve vacío cuando el buffer no resuelve a búsqueda', () => {
    commandBarBufferSignal.value = '/cobrar';
    expect(searchResultsSignal.value).toEqual([]);
  });
});
