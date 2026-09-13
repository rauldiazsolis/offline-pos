import type { Customer } from './customer.ts';

export type CustomerSearchResult = { customer: Customer; score: number };

/**
 * Puerto de búsqueda difusa de clientes por nombre — mismo patrón que
 * `CatalogSearch` (ver "Patrones establecidos" en CLAUDE.md): el dominio
 * define la interfaz, la implementación concreta (FlexSearch, reusada) vive
 * en `storage/`.
 */
export interface CustomerSearch {
  search(query: string, limit?: number): CustomerSearchResult[];
}
