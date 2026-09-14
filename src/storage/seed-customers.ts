import { z } from 'zod';
import { buildCustomer } from '../domain/customer.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { toZodIssues } from '../domain/zod-issues.ts';
import customerFixture from './fixtures/customers.json';
import { db } from './db.ts';
import { newId } from './ids.ts';

const customerFixtureEntrySchema = z.object({
  name: z.string(),
  document: z.string().optional(),
  phone: z.string().optional(),
});
const customerFixtureSchema = z.array(customerFixtureEntrySchema);

/**
 * Siembra clientes de ejemplo (con documento/teléfono) desde el fixture
 * local, solo si la tabla `customers` está vacía — mismo patrón que
 * `seedCatalogIfEmpty`. A diferencia del catálogo, esto **no es
 * obligatorio para poder operar** (son datos de ejemplo, no algo de lo
 * que dependa vender), así que `bootstrap.ts` no aborta si esto falla —
 * solo lo registra.
 *
 * Existe porque hoy no hay ninguna UI para tipear documento/teléfono al
 * crear un cliente desde `@<nombre>` — sin este seed, ningún cliente
 * local tendría esos campos para mostrar.
 */
export async function seedCustomersIfEmpty(params: {
  now: string;
}): Promise<Result<{ seeded: boolean }>> {
  const count = await db.customers.count();
  if (count > 0) {
    return ok({ seeded: false });
  }

  const parsed = customerFixtureSchema.safeParse(customerFixture);
  if (!parsed.success) {
    return err('customer/invalid-fixture', { issues: toZodIssues(parsed.error) });
  }

  const customers = parsed.data.map((entry) =>
    buildCustomer(entry.name, {
      id: newId(),
      now: params.now,
      ...(entry.document !== undefined ? { document: entry.document } : {}),
      ...(entry.phone !== undefined ? { phone: entry.phone } : {}),
    }),
  );

  try {
    await db.customers.bulkAdd(customers);
  } catch (error) {
    return err('customer/seed-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return ok({ seeded: true });
}
