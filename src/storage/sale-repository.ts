import type { Cart } from '../domain/cart.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { buildStockMovementsForSale, closeSale } from '../domain/sale-lifecycle.ts';
import type { Payment, Sale, SaleLine } from '../domain/sale.ts';
import { db } from './db.ts';
import { newId } from './ids.ts';

function isProductLine(line: SaleLine): line is Extract<SaleLine, { kind: 'product' }> {
  return line.kind === 'product';
}

async function trackedProductIdsFor(lines: SaleLine[]): Promise<Set<string>> {
  const productIds = [...new Set(lines.filter(isProductLine).map((line) => line.productId))];
  const products = await db.products.bulkGet(productIds);
  return new Set(
    products.filter((product) => product?.tracksStock).map((product) => product?.id ?? ''),
  );
}

/**
 * Cierra una venta y la persiste junto con sus movimientos de stock en una
 * única transacción — RNF-02: la venta se persiste **antes** de considerarse
 * cerrada, así que este `Result` solo resuelve `ok` después de que la
 * escritura a IndexedDB ya haya terminado.
 */
export async function closeSaleAndPersist(params: {
  cart: Cart;
  payments: Payment[];
}): Promise<Result<Sale>> {
  const now = new Date().toISOString();
  const saleResult = closeSale({
    cart: params.cart,
    payments: params.payments,
    id: newId(),
    createdAt: now,
  });
  if (!saleResult.ok) {
    return saleResult;
  }
  const sale = saleResult.value;

  const trackedProductIds = await trackedProductIdsFor(sale.lines);
  const movements = buildStockMovementsForSale(sale, {
    reason: 'sale',
    now,
    newMovementId: newId,
    trackedProductIds,
  });

  try {
    await db.transaction('rw', db.sales, db.stock, db.stockMovements, async () => {
      await db.sales.add(sale);
      await db.stockMovements.bulkAdd(movements);
      for (const movement of movements) {
        const current = await db.stock.get(movement.productId);
        await db.stock.put({
          productId: movement.productId,
          quantity: (current?.quantity ?? 0) + movement.delta,
          updatedAt: now,
        });
      }
    });
  } catch (error) {
    return err('sale/persist-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return ok(sale);
}
