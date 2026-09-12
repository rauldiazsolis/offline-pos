import type { CatalogRepository } from '../../storage/catalog-repository.ts';

/**
 * El repositorio de catálogo se arma una sola vez en el bootstrap (requiere
 * IO: leer Dexie e indexar con FlexSearch) y se guarda acá para que el resto
 * de `ui/` lo consuma sin prop-drilling. `domain/` nunca importa este módulo.
 */
let repository: CatalogRepository | undefined;

export function setCatalogRepository(repo: CatalogRepository): void {
  repository = repo;
}

export function getCatalogRepository(): CatalogRepository {
  if (repository === undefined) {
    // Invariante de infraestructura: falta llamar a bootstrap() antes de renderizar.
    throw new Error('CatalogRepository no fue inicializado');
  }
  return repository;
}
