import type { CatalogSearchResult } from '../domain/catalog-search.ts';
import type { Product } from '../domain/product.ts';
import type { StockItem } from '../domain/stock.ts';
import { db } from './db.ts';
import { FlexSearchCatalogSearch } from './flexsearch-catalog-search.ts';

/**
 * Repositorio de catálogo para la capa de UI: búsqueda difusa por nombre,
 * lookup exacto por código de barras/SKU, y consulta de stock. Se arma una
 * sola vez en el bootstrap de la app (ver `ui/bootstrap.ts`) a partir del
 * catálogo ya sembrado en Dexie.
 */
export type CatalogRepository = {
  search(query: string, limit?: number): CatalogSearchResult[];
  findByBarcodeOrSku(code: string): Promise<Product | undefined>;
  getStock(productId: string): Promise<StockItem | undefined>;
};

export async function loadCatalogRepository(): Promise<CatalogRepository> {
  const products = await db.products.toArray();
  const search = new FlexSearchCatalogSearch(products);

  return {
    search: (query, limit) => search.search(query, limit),
    findByBarcodeOrSku: async (code) => {
      const byBarcode = await db.products.where('barcodes').equals(code).first();
      if (byBarcode !== undefined) {
        return byBarcode;
      }
      return db.products.where('sku').equals(code).first();
    },
    getStock: (productId) => db.stock.get(productId),
  };
}
