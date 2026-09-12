import { z } from 'zod';
import { buildCatalogFromFixture, type CatalogEntry } from '../domain/catalog.ts';
import { productSchema } from '../domain/product.ts';
import { err, ok, type Result } from '../domain/result.ts';
import catalogFixture from './fixtures/catalog.json';
import { db } from './db.ts';
import { newId } from './ids.ts';

const fixtureEntrySchema = productSchema
  .omit({ id: true })
  .extend({ initialStock: z.number().int().nonnegative() });
const fixtureSchema = z.array(fixtureEntrySchema);

/**
 * Siembra el catálogo desde el fixture local solo si la tabla `products`
 * está vacía. Único lugar (junto con la transacción de abajo) con try/catch
 * real: envuelve Dexie/JSON, que sí lanzan por naturaleza, en un Result.
 */
export async function seedCatalogIfEmpty(params: {
  now: string;
}): Promise<Result<{ seeded: boolean }>> {
  const count = await db.products.count();
  if (count > 0) {
    return ok({ seeded: false });
  }

  const parsed = fixtureSchema.safeParse(catalogFixture);
  if (!parsed.success) {
    return err('catalog/invalid-fixture', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const entries: CatalogEntry[] = parsed.data.map((entry) => ({ ...entry, id: newId() }));
  const built = buildCatalogFromFixture(entries, { now: params.now });
  if (!built.ok) {
    return built;
  }

  try {
    await db.transaction('rw', db.products, db.stock, async () => {
      await db.products.bulkAdd(built.value.products);
      await db.stock.bulkAdd(built.value.stock);
    });
  } catch (error) {
    return err('catalog/seed-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return ok({ seeded: true });
}
