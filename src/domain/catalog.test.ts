import { describe, expect, it } from 'vitest';
import { buildCatalogFromFixture, type CatalogEntry } from './catalog.ts';

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'p1',
    sku: 'SKU-1',
    barcodes: ['111'],
    name: 'Producto 1',
    price: 100,
    taxRate: 0.21,
    category: 'general',
    tracksStock: true,
    initialStock: 10,
    ...overrides,
  };
}

describe('buildCatalogFromFixture', () => {
  it('arma products y stock a partir de las entradas', () => {
    const result = buildCatalogFromFixture([makeEntry()], { now: '2026-01-01T00:00:00.000Z' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.products).toEqual([
        {
          id: 'p1',
          sku: 'SKU-1',
          barcodes: ['111'],
          name: 'Producto 1',
          price: 100,
          taxRate: 0.21,
          category: 'general',
          tracksStock: true,
        },
      ]);
      expect(result.value.stock).toEqual([
        { productId: 'p1', quantity: 10, updatedAt: '2026-01-01T00:00:00.000Z' },
      ]);
    }
  });

  it('rechaza sku duplicado', () => {
    const result = buildCatalogFromFixture(
      [makeEntry(), makeEntry({ id: 'p2', barcodes: ['222'] })],
      { now: '2026-01-01T00:00:00.000Z' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('catalog/duplicate-sku');
    }
  });

  it('rechaza código de barras duplicado entre productos distintos', () => {
    const result = buildCatalogFromFixture([makeEntry(), makeEntry({ id: 'p2', sku: 'SKU-2' })], {
      now: '2026-01-01T00:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('catalog/duplicate-barcode');
    }
  });
});
