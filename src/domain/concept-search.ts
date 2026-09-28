/**
 * Puerto de búsqueda difusa de conceptos de caja — mismo patrón que `CustomerSearch` (la
 * implementación con FlexSearch vive en `storage/`). Devuelve `conceptKey`s; el orden final lo pone
 * `concept-ranking.ts`, no la relevancia de la búsqueda.
 */
export interface ConceptSearch {
  search(query: string): string[];
}
