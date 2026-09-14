import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { loadDraftCart } from '../storage/draft-cart-repository.ts';
import { seedCatalogIfEmpty } from '../storage/seed-catalog.ts';
import { startSyncEngine } from '../sync/engine.ts';
import { cartSignal } from './state/cart.ts';
import { setCatalogRepository } from './state/catalog.ts';
import { attachedCustomerSignal } from './state/customer.ts';
import { setCustomerRepository } from './state/customer-repository.ts';
import { startCartPersistence } from './state/persist-cart.ts';

/**
 * Siembra el catálogo si hace falta y arma el repositorio antes del primer
 * render. Se llama una sola vez desde `main.tsx`.
 */
export async function bootstrap(): Promise<void> {
  const seedResult = await seedCatalogIfEmpty({ now: new Date().toISOString() });
  if (!seedResult.ok) {
    // El fixture local roto (o un fallo de Dexie al sembrar) es un bug real
    // en Fase 1, no un caso de negocio que el cajero pueda resolver — se
    // deja explotar hasta el manejador global (ver CLAUDE.md).
    throw new Error(`No se pudo sembrar el catálogo (${seedResult.error})`);
  }

  const catalogRepository = await loadCatalogRepository();
  setCatalogRepository(catalogRepository);

  setCustomerRepository(await loadCustomerRepository());

  // Restaurar antes de empezar a persistir (issue #17): así el primer
  // disparo del effect no reescribe innecesariamente el mismo valor que se
  // acaba de leer.
  const draft = await loadDraftCart();
  if (draft !== undefined) {
    cartSignal.value = draft.cart;
    if (draft.customer !== undefined) {
      attachedCustomerSignal.value = draft.customer;
    }
  }
  startCartPersistence();

  startSyncEngine();
}
