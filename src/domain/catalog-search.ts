import type { Product } from './product.ts';

export type CatalogSearchResult = { product: Product; score: number };

/**
 * Puerto de búsqueda difusa sobre el catálogo. El dominio define la
 * interfaz que necesita — no importa ninguna librería de búsqueda; la
 * implementación concreta (FlexSearch por ahora, ver storage/) vive en
 * `storage/` y puede reemplazarse sin tocar nada que dependa de este tipo.
 */
export interface CatalogSearch {
  search(query: string, limit?: number): CatalogSearchResult[];
}
