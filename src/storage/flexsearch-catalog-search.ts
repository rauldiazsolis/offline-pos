import { Index } from 'flexsearch';
import type { CatalogSearch, CatalogSearchResult } from '../domain/catalog-search.ts';
import type { Product } from '../domain/product.ts';

/**
 * Implementación default del puerto `CatalogSearch` — búsqueda difusa por
 * nombre **y por SKU** (regla 6 de la barra de comandos; código de barras es
 * match exacto y se resuelve aparte, ver `catalog-repository.ts`). Se indexa
 * una sola vez al construirse: el catálogo es estático en Fase 1, reindexar
 * en vivo queda para cuando el pull de Fase 2 lo justifique.
 *
 * El SKU se suma al texto indexado (issue #11): un SKU alfanumérico como
 * "ALM-001" nunca llega a `findByBarcodeOrSku` (esa regla solo dispara con
 * buffers 100% numéricos, ver `parse-command-bar.ts`) — sin esto, quedaba
 * completamente sin forma de buscarlo.
 *
 * FlexSearch no expone un score de relevancia real en su API de `Index` —
 * el orden de los resultados ya viene rankeado, así que `score` se deriva
 * de la posición (1 el mejor match, decreciente) para que el puerto tenga
 * un número usable sin acoplarse a los detalles internos de la librería.
 */
export class FlexSearchCatalogSearch implements CatalogSearch {
  readonly #index = new Index({ tokenize: 'forward' });
  readonly #productsById = new Map<string, Product>();

  constructor(products: Product[]) {
    for (const product of products) {
      this.#index.add(product.id, `${product.name} ${product.sku}`);
      this.#productsById.set(product.id, product);
    }
  }

  search(query: string, limit = 10): CatalogSearchResult[] {
    const ids = this.#index.search(query, { limit });
    const results: CatalogSearchResult[] = [];

    ids.forEach((id, rank) => {
      const product = this.#productsById.get(String(id));
      if (product !== undefined) {
        results.push({ product, score: 1 / (rank + 1) });
      }
    });

    return results;
  }
}
