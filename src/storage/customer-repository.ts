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
  getCustomer(customerId: string): Customer | undefined;
  /** Async y siempre fresco: el balance cacheado puede cambiar en la sesión (ver sale-repository.ts). */
  getCustomerAccount(customerId: string): Promise<CustomerAccount | undefined>;
};

export async function loadCustomerRepository(): Promise<CustomerRepository> {
  const customers = await db.customers.toArray();
  const search = new FlexSearchCustomerSearch(customers);
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));

  return {
    search: (query, limit) => search.search(query, limit),
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
