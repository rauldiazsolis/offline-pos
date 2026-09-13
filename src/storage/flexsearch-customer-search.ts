import { Index } from 'flexsearch';
import type { Customer } from '../domain/customer.ts';
import type { CustomerSearch, CustomerSearchResult } from '../domain/customer-search.ts';

/**
 * Implementación default del puerto `CustomerSearch` — mismo criterio que
 * `FlexSearchCatalogSearch` (reusa la misma librería ya presente en el
 * proyecto, sin sumar una dependencia nueva). A diferencia del catálogo, el
 * índice se reconstruye cada vez que se crea un cliente local o llega un
 * pull nuevo (ver `storage/customer-repository.ts`) — la lista de clientes
 * cambia con más frecuencia que el catálogo de productos.
 */
export class FlexSearchCustomerSearch implements CustomerSearch {
  readonly #index = new Index({ tokenize: 'forward' });
  readonly #customersById = new Map<string, Customer>();

  constructor(customers: Customer[]) {
    for (const customer of customers) {
      this.#index.add(customer.id, customer.name);
      this.#customersById.set(customer.id, customer);
    }
  }

  search(query: string, limit = 10): CustomerSearchResult[] {
    const ids = this.#index.search(query, { limit });
    const results: CustomerSearchResult[] = [];

    ids.forEach((id, rank) => {
      const customer = this.#customersById.get(String(id));
      if (customer !== undefined) {
        results.push({ customer, score: 1 / (rank + 1) });
      }
    });

    return results;
  }
}
