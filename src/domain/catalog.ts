import type { Product } from './product.ts';
import { err, ok, type Result } from './result.ts';
import type { StockItem } from './stock.ts';

/** Entrada de catálogo ya validada (Zod, en el borde) más su stock inicial. */
export type CatalogEntry = Product & { initialStock: number };

/**
 * Arma la lista de productos y stock inicial a partir de entradas ya
 * validadas, chequeando las invariantes que el catálogo necesita: sku único
 * y código de barras único (tanto dentro de un mismo producto como entre
 * productos distintos).
 */
export function buildCatalogFromFixture(
  entries: CatalogEntry[],
  params: { now: string },
): Result<{ products: Product[]; stock: StockItem[] }> {
  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();

  for (const entry of entries) {
    if (seenSkus.has(entry.sku)) {
      return err('catalog/duplicate-sku', { sku: entry.sku });
    }
    seenSkus.add(entry.sku);

    for (const barcode of entry.barcodes) {
      if (seenBarcodes.has(barcode)) {
        return err('catalog/duplicate-barcode', { barcode });
      }
      seenBarcodes.add(barcode);
    }
  }

  const products: Product[] = entries.map((entry): Product => ({
    id: entry.id,
    sku: entry.sku,
    barcodes: entry.barcodes,
    name: entry.name,
    price: entry.price,
    taxRate: entry.taxRate,
    category: entry.category,
    tracksStock: entry.tracksStock,
  }));
  const stock: StockItem[] = entries.map((entry) => ({
    productId: entry.id,
    quantity: entry.initialStock,
    updatedAt: params.now,
  }));

  return ok({ products, stock });
}
