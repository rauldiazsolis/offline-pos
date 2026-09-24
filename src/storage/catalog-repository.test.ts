import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db.ts';
import { loadCatalogRepository } from './catalog-repository.ts';

beforeEach(async () => {
  await db.open();
  await db.products.add({
    id: 'p1',
    sku: 'SKU-1',
    barcodes: ['111'],
    name: 'Arroz 1kg',
    price: 100,
    taxRate: 0.21,
    category: 'almacen',
    tracksStock: true,
  });
  await db.stock.add({ productId: 'p1', quantity: 10, updatedAt: '2026-01-01T00:00:00.000Z' });
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('loadCatalogRepository', () => {
  it('busca por nombre', async () => {
    const repo = await loadCatalogRepository();
    expect(repo.search('arroz')).toHaveLength(1);
  });

  it('encuentra un producto por código de barras', async () => {
    const repo = await loadCatalogRepository();
    expect(repo.findByBarcodeOrSku('111')?.id).toBe('p1');
  });

  it('encuentra un producto por sku si no matchea ningún barcode', async () => {
    const repo = await loadCatalogRepository();
    expect(repo.findByBarcodeOrSku('SKU-1')?.id).toBe('p1');
  });

  it('devuelve el stock de un producto', async () => {
    const repo = await loadCatalogRepository();
    const stock = await repo.getStock('p1');
    expect(stock?.quantity).toBe(10);
  });

  it('encuentra un producto por id', async () => {
    const repo = await loadCatalogRepository();
    expect(repo.getProduct('p1')?.name).toBe('Arroz 1kg');
  });
});

describe('searchByCode (#99)', () => {
  beforeEach(async () => {
    await db.products.bulkAdd([
      {
        id: 'p2',
        sku: '4455',
        barcodes: ['7791234000011'],
        name: 'Fideos',
        price: 1,
        taxRate: 0,
        category: 'c',
        tracksStock: false,
      },
      {
        id: 'p3',
        sku: 'X-3',
        barcodes: ['7790000004455'],
        name: 'Aceite',
        price: 1,
        taxRate: 0,
        category: 'c',
        tracksStock: false,
      },
    ]);
  });

  it('exactos primero, después por el comienzo, después por el final; nunca por nombre', async () => {
    const repo = await loadCatalogRepository();

    expect(repo.searchByCode('4455').map((r) => r.product.id)).toEqual(['p2', 'p3']);
    expect(repo.searchByCode('7791').map((r) => r.product.id)).toEqual(['p2']);
    expect(repo.searchByCode('0011').map((r) => r.product.id)).toEqual(['p2']);
    expect(repo.searchByCode('Fide')).toEqual([]);
  });
});
