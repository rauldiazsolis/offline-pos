import { Index } from 'flexsearch';
import { conceptKey, type CashConcept } from '../domain/concept-ranking.ts';
import type { ConceptSearch } from '../domain/concept-search.ts';

/** Implementación de `ConceptSearch` sobre FlexSearch, reusada (sin dependencia nueva). */
export class FlexSearchConceptSearch implements ConceptSearch {
  readonly #index = new Index({ tokenize: 'forward' });

  constructor(concepts: readonly CashConcept[]) {
    for (const concept of concepts) {
      this.#index.add(conceptKey(concept.concept), concept.concept);
    }
  }

  search(query: string): string[] {
    return this.#index.search(query).map(String);
  }
}
