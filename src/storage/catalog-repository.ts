import type { CatalogSearchResult } from '../domain/catalog-search.ts';
import type { Product } from '../domain/product.ts';
import type { StockItem } from '../domain/stock.ts';
import { db } from './db.ts';
import { FlexSearchCatalogSearch } from './flexsearch-catalog-search.ts';

/**
 * Repositorio de catálogo para la capa de UI: búsqueda difusa por nombre,
 * lookup exacto por código de barras/SKU/id, y consulta de stock. Se arma
 * una sola vez en el bootstrap de la app a partir del catálogo ya sembrado
 * en Dexie.
 *
 * El catálogo es estático en Fase 1 (sin altas/bajas en caliente) y ya está
 * todo en memoria para el índice de búsqueda — así que products/barcodes/sku
 * se resuelven sync desde ahí, sin volver a golpear Dexie. Solo `getStock`
 * sigue siendo async: es lo único que puede cambiar durante la sesión (una
 * venta/anulación lo actualiza), así que se lee siempre fresco.
 */
export type CatalogRepository = {
  search(query: string, limit?: number): CatalogSearchResult[];
  findByBarcodeOrSku(code: string): Product | undefined;
  /**
   * Productos cuyo SKU o algún código de barras empieza **o termina** con
   * `fragment` (prueba manual de la Etapa 4, #99): la barra lista coincidencias
   * de código desde 4 dígitos. Exactos primero, después por el comienzo,
   * después por el final (lo que suele tipear un cajero cuando el lector no
   * lee). Nunca busca por nombre.
   */
  searchByCode(fragment: string, limit?: number): CatalogSearchResult[];
  /** Lookup por id — para resolver el producto de una línea de carrito/venta ya armada. */
  getProduct(productId: string): Product | undefined;
  getStock(productId: string): Promise<StockItem | undefined>;
};

export async function loadCatalogRepository(): Promise<CatalogRepository> {
  const products = await db.products.toArray();
  const search = new FlexSearchCatalogSearch(products);

  const productsById = new Map(products.map((product) => [product.id, product]));
  const productsByBarcode = new Map<string, Product>();
  const productsBySku = new Map<string, Product>();
  for (const product of products) {
    productsBySku.set(product.sku, product);
    for (const barcode of product.barcodes) {
      productsByBarcode.set(barcode, product);
    }
  }

  return {
    search: (query, limit) => search.search(query, limit),
    findByBarcodeOrSku: (code) => productsByBarcode.get(code) ?? productsBySku.get(code),
    searchByCode: (fragment, limit = 20) => {
      const rank = (product: Product): number => {
        const codes = [product.sku, ...product.barcodes];
        if (codes.includes(fragment)) return 0;
        if (codes.some((code) => code.startsWith(fragment))) return 1;
        if (codes.some((code) => code.endsWith(fragment))) return 2;
        return -1;
      };
      return products
        .map((product) => ({ product, rank: rank(product) }))
        .filter((entry) => entry.rank !== -1)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, limit)
        .map((entry) => ({ product: entry.product, score: 1 }));
    },
    getProduct: (productId) => productsById.get(productId),
    getStock: (productId) => db.stock.get(productId),
  };
}
