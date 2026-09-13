import type { CustomerRepository } from '../../storage/customer-repository.ts';

/**
 * Mismo rol que `ui/state/catalog.ts` para el catálogo: el repositorio de
 * clientes requiere IO para armarse (leer Dexie, indexar con FlexSearch), así
 * que se arma una vez y se guarda acá — `domain/` nunca importa este módulo.
 */
let repository: CustomerRepository | undefined;

export function setCustomerRepository(repo: CustomerRepository): void {
  repository = repo;
}

export function getCustomerRepository(): CustomerRepository {
  if (repository === undefined) {
    // Invariante de infraestructura: falta llamar a bootstrap() antes de renderizar.
    throw new Error('CustomerRepository no fue inicializado');
  }
  return repository;
}
