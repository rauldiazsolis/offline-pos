import type { CustomerSearchResult } from '../domain/customer-search.ts';
import type { Customer, CustomerAccount } from '../domain/customer.ts';
import { buildCustomer } from '../domain/customer.ts';
import { buildOutboxEventForCustomer, buildOutboxEventForHoldRelease } from '../domain/outbox.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { db } from './db.ts';
import { FlexSearchCustomerSearch } from './flexsearch-customer-search.ts';
import { newId } from './ids.ts';

/**
 * Repositorio de clientes para la capa de UI — mismo rol que
 * `CatalogRepository`. A diferencia del catálogo, se reconstruye no solo
 * tras un pull sino también cada vez que se crea un cliente local (la lista
 * cambia en caliente durante la sesión, no solo por sync).
 */
export type CustomerRepository = {
  search(query: string, limit?: number): CustomerSearchResult[];
  /**
   * Sin necesidad de tipear nada — para que `@` muestre algo apenas se
   * abre, en vez de esperar una query (issue #21). El nombre quedó de
   * cuando ordenaba por fecha de alta; desde el Ciclo 8 el orden es
   * alfabético (más fácil de ubicar un nombre conocido a ojo), la lista
   * sigue siendo "sin query" — eso no cambió.
   */
  listRecent(limit?: number): CustomerSearchResult[];
  getCustomer(customerId: string): Customer | undefined;
  /** Async y siempre fresco: el balance cacheado puede cambiar en la sesión (ver sale-repository.ts). */
  getCustomerAccount(customerId: string): Promise<CustomerAccount | undefined>;
};

export async function loadCustomerRepository(): Promise<CustomerRepository> {
  const customers = await db.customers.toArray();
  const search = new FlexSearchCustomerSearch(customers);
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  // Ciclo 8, punto 1: alfabético, no por fecha de alta — más fácil de
  // ubicar un nombre conocido a ojo en una lista larga de "recientes". Solo
  // acá: `search()` con texto (@algo) sigue ordenado por relevancia del
  // fuzzy match (FlexSearchCustomerSearch) — forzar alfabético ahí
  // empeoraría la búsqueda, decisión explícita del usuario.
  const alphabetical = [...customers].sort((a, b) => a.name.localeCompare(b.name));

  return {
    search: (query, limit) => search.search(query, limit),
    listRecent: (limit = 10) =>
      alphabetical.slice(0, limit).map((customer) => ({ customer, score: 1 })),
    getCustomer: (customerId) => customersById.get(customerId),
    getCustomerAccount: (customerId) => db.customerAccounts.get(customerId),
  };
}

/**
 * Alta de cliente desde `@<nombre>` (RF-16) sin match existente. Persiste el
 * `Customer` y encola su evento de outbox `'customer'` en la misma
 * transacción — mismo criterio que `sale-repository.ts`. El caller es
 * responsable de reconstruir el `CustomerRepository` (`setCustomerRepository`)
 * después de un alta exitosa, igual que tras un pull.
 */
export async function createCustomerLocally(name: string): Promise<Result<Customer>> {
  const now = new Date().toISOString();
  const customer = buildCustomer(name, { id: newId(), now });
  const outboxEvent = buildOutboxEventForCustomer(customer, { now });

  try {
    await db.transaction('rw', db.customers, db.outbox, async () => {
      await db.customers.add(customer);
      await db.outbox.add(outboxEvent);
    });
  } catch (error) {
    return err('customer/persist-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return ok(customer);
}

/**
 * Libera (best-effort) un hold aprobado que no se terminó usando — se
 * canceló el cobro después de que el backend ya lo había aprobado. No toca
 * ninguna venta; solo encola el evento, que el motor de sync reintenta como
 * cualquier otro.
 */
export async function releaseAccountHold(params: { holdId: string }): Promise<Result<void>> {
  const now = new Date().toISOString();
  const event = buildOutboxEventForHoldRelease({ id: newId(), holdId: params.holdId, now });

  try {
    await db.outbox.add(event);
  } catch (error) {
    return err('customer/persist-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return ok(undefined);
}
