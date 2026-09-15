import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { loadDraftCart } from '../storage/draft-cart-repository.ts';
import { startSyncEngine } from '../sync/engine.ts';
import { cartSignal } from './state/cart.ts';
import { setCatalogRepository } from './state/catalog.ts';
import { attachedCustomerSignal } from './state/customer.ts';
import { setCustomerRepository } from './state/customer-repository.ts';
import { startCartPersistence } from './state/persist-cart.ts';

/**
 * Arma los repositorios antes del primer render y arranca el motor de sync.
 * Se llama una sola vez desde `main.tsx`. Ya no siembra catálogo/clientes
 * localmente (Fase 7): esos datos ahora vienen del minibackend de demo (o de
 * cualquier backend real) vía pull — una terminal recién instalada, sin
 * `/CONFIG` configurado todavía, arranca vacía hasta el primer sync. Los
 * fixtures y `seedCatalogIfEmpty`/`seedCustomersIfEmpty`
 * (`storage/seed-catalog.ts`, `storage/seed-customers.ts`) se mantienen — los
 * siguen usando los tests unitarios. Los specs e2e que a propósito prueban el
 * flujo 100% offline sin ningún backend (`e2e/offline-sale.spec.ts`,
 * `e2e/account-sale.spec.ts`, `e2e/void-sale.spec.ts`, y los de
 * `e2e/cart-persistence.spec.ts`/`e2e/cash-session.spec.ts`/
 * `e2e/keyboard-only.spec.ts` que venden algo) no pueden importar esos
 * módulos TS (corren contra el build real en el navegador, no en Node) — en
 * su lugar siembran el mismo fixture directo en IndexedDB vía
 * `e2e/helpers.ts::seedCatalog`.
 */
export async function bootstrap(): Promise<void> {
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
