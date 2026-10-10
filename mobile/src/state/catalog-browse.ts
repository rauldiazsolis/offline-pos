import { signal } from '@preact/signals';
import type { Product } from '../../../src/domain/product.ts';
import { db } from '../../../src/storage/db.ts';
import {
  lastPullApplicationSignal,
  lastSyncedAtSignal,
  localCatalogCountsSignal,
} from '../../../src/ui/state/sync.ts';

/**
 * El catálogo para la grilla, por categoría (el repositorio de escritorio solo busca). Se vuelve a
 * leer de Dexie después de cada pull y al aplicar una conexión.
 */
export const productsSignal = signal<readonly Product[]>([]);

/** Ids de los productos más vendidos de los últimos días (lo que queda en la terminal). */
export const topSellersSignal = signal<readonly string[]>([]);

const TOP_SELLERS = 12;

export async function refreshCatalogBrowse(): Promise<void> {
  const products = await db.products.toArray();
  products.sort((a, b) => a.name.localeCompare(b.name));
  productsSignal.value = products;

  const counts = new Map<string, number>();
  for (const sale of await db.sales.toArray()) {
    if (sale.voidsSaleId !== undefined) continue;
    for (const line of sale.lines) {
      if (line.kind === 'product' && line.qty > 0) {
        counts.set(line.productId, (counts.get(line.productId) ?? 0) + 1);
      }
    }
  }
  const known = new Set(products.map((product) => product.id));
  topSellersSignal.value = [...counts.entries()]
    .filter(([id]) => known.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SELLERS)
    .map(([id]) => id);
}

/** Categorías en orden alfabético, sin vacías. */
export function categoriesOf(products: readonly Product[]): string[] {
  return [...new Set(products.map((product) => product.category.trim()))]
    .filter((category) => category !== '')
    .sort((a, b) => a.localeCompare(b));
}

/** Recarga la grilla cuando un pull o una conexión nueva cambian el catálogo. */
export function startCatalogBrowse(): () => void {
  const refresh = (): void => {
    void refreshCatalogBrowse();
  };
  // Cambian después de cada pull aplicado y al aplicar una conexión.
  const stops = [
    lastPullApplicationSignal.subscribe(refresh),
    lastSyncedAtSignal.subscribe(refresh),
    localCatalogCountsSignal.subscribe(refresh),
  ];
  return () => {
    stops.forEach((stop) => {
      stop();
    });
  };
}
