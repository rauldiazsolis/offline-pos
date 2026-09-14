import { describe, expect, it } from 'vitest';
import type { Product } from '../domain/product.ts';
import { FlexSearchCatalogSearch } from './flexsearch-catalog-search.ts';

function makeProduct(overrides: Partial<Product>): Product {
  return {
    id: 'p1',
    sku: 'SKU-1',
    barcodes: [],
    name: 'Producto',
    price: 100,
    taxRate: 0.21,
    category: 'general',
    tracksStock: true,
    ...overrides,
  };
}

describe('FlexSearchCatalogSearch', () => {
  const products = [
    makeProduct({ id: 'p1', name: 'Arroz 1kg' }),
    makeProduct({ id: 'p2', name: 'Fideos 500g' }),
    makeProduct({ id: 'p3', name: 'Arroz integral 1kg' }),
  ];
  const search = new FlexSearchCatalogSearch(products);

  it('encuentra productos por coincidencia parcial del nombre', () => {
    const results = search.search('arroz');

    expect(results.map((r) => r.product.id).sort()).toEqual(['p1', 'p3']);
  });

  it('devuelve resultados ordenados con score decreciente', () => {
    const results = search.search('arroz');

    for (let i = 1; i < results.length; i++) {
      expect(results[i]?.score).toBeLessThanOrEqual(results[i - 1]?.score ?? Infinity);
    }
  });

  it('devuelve vacío si no hay coincidencias', () => {
    expect(search.search('inexistente')).toEqual([]);
  });

  it('respeta el límite de resultados', () => {
    expect(search.search('a', 1)).toHaveLength(1);
  });

  it('encuentra productos por SKU alfanumérico (issue #11)', () => {
    const withSkus = [
      makeProduct({ id: 'p1', name: 'Arroz 1kg', sku: 'ALM-001' }),
      makeProduct({ id: 'p2', name: 'Fideos 500g', sku: 'ALM-002' }),
    ];
    const searchWithSkus = new FlexSearchCatalogSearch(withSkus);

    const results = searchWithSkus.search('ALM-001');

    expect(results.map((r) => r.product.id)).toEqual(['p1']);
  });
});
