import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { seedCatalogIfEmpty } from '../storage/seed-catalog.ts';
import { startSyncEngine } from '../sync/engine.ts';
import { setCatalogRepository } from './state/catalog.ts';
import { setCustomerRepository } from './state/customer-repository.ts';

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

  startSyncEngine();
}
