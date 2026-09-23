import type { Cart } from '../domain/cart.ts';
import { recordSaleInCashSession } from '../domain/cash-session.ts';
import { buildAccountMovementForSale } from '../domain/customer.ts';
import {
  buildOutboxEventForHoldConfirm,
  buildOutboxEventForSale,
  buildOutboxEventForVoid,
  buildOutboxEventsForStockMovements,
} from '../domain/outbox.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { buildStockMovementsForSale, closeSale, voidSale } from '../domain/sale-lifecycle.ts';
import type { Payment, Sale, SaleLine } from '../domain/sale.ts';
import type { StockMovement } from '../domain/stock.ts';
import { currentEventOrigin } from '../sync/terminal-identity.ts';
import { getCurrentOpenCashSession } from './cash-session-repository.ts';
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

/** Escribe los movimientos y actualiza `stock` acorde — se asume ya dentro de una transacción. */
async function applyStockMovements(movements: StockMovement[], now: string): Promise<void> {
  await db.stockMovements.bulkAdd(movements);
  for (const movement of movements) {
    const current = await db.stock.get(movement.productId);
    await db.stock.put({
      productId: movement.productId,
      quantity: (current?.quantity ?? 0) + movement.delta,
      updatedAt: now,
    });
  }
}

/**
 * Escribe el rastro de `AccountMovement` de una venta a cuenta corriente y
 * descuenta el `balance` cacheado — se asume ya dentro de una transacción,
 * mismo criterio que `applyStockMovements` para `stock`.
 *
 * Si no hay `CustomerAccount` cacheada todavía para ese cliente (pudo
 * aprobarse el hold con red sin que este dispositivo haya pulleado nunca su
 * cuenta), no se inventa una fila con `creditLimit`/`margin` en 0 — se deja
 * que el próximo pull traiga los datos reales del backend.
 */
async function applyAccountMovements(sale: Sale, now: string): Promise<void> {
  const accountPayments = sale.payments.filter((payment) => payment.method === 'account');
  if (accountPayments.length === 0) {
    return;
  }
  // closeSale ya garantiza customerId presente si hay algún pago 'account'.
  const customerId = sale.customerId;
  if (customerId === undefined) {
    return;
  }

  for (const payment of accountPayments) {
    const movement = buildAccountMovementForSale({
      id: newId(),
      customerId,
      amount: payment.amount,
      saleId: sale.id,
      ...(payment.reference !== undefined ? { holdId: payment.reference } : {}),
      now,
    });
    await db.accountMovements.add(movement);

    const current = await db.customerAccounts.get(customerId);
    if (current !== undefined) {
      await db.customerAccounts.put({
        ...current,
        balance: current.balance + movement.amount,
        updatedAt: now,
      });
    }
  }
}

/**
 * Cierra una venta y la persiste junto con sus movimientos de stock en una
 * única transacción — RNF-02: la venta se persiste **antes** de considerarse
 * cerrada, así que este `Result` solo resuelve `ok` después de que la
 * escritura a IndexedDB ya haya terminado.
 *
 * `pendingHold` (Fase 3) se pasa cuando algún pago `'account'` viene de un
 * hold aprobado con red — su evento `'account-hold-confirm'` se encola en la
 * MISMA transacción que la venta, así RF-19 (tolerante a que la red se corte
 * justo después de aprobado) queda cubierto por los reintentos del outbox.
 */
export async function closeSaleAndPersist(params: {
  cart: Cart;
  payments: Payment[];
  customerId?: string;
  pendingHold?: { holdId: string };
}): Promise<Result<Sale>> {
  const now = new Date().toISOString();
  const origin = currentEventOrigin();

  // Fase 6: no se puede cerrar una venta sin un turno de caja abierto — el
  // gate real vive acá (`command-bar-controller.ts::triggerCheckout` ya
  // chequea lo mismo antes, para fallar rápido sin llegar a abrir la
  // pantalla de cobro, pero esta es la verificación de fondo).
  const openSession = await getCurrentOpenCashSession();
  if (openSession === undefined) {
    return err('cash-session/none-open', undefined);
  }

  const saleResult = closeSale({
    cart: params.cart,
    payments: params.payments,
    id: newId(),
    createdAt: now,
    ...(params.customerId !== undefined ? { customerId: params.customerId } : {}),
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
  const outboxEvents = [
    buildOutboxEventForSale(sale, { now, origin }),
    ...buildOutboxEventsForStockMovements(movements, { now, origin }),
    ...(params.pendingHold !== undefined
      ? [
          buildOutboxEventForHoldConfirm({
            id: newId(),
            holdId: params.pendingHold.holdId,
            saleId: sale.id,
            now,
            origin,
          }),
        ]
      : []),
  ];

  try {
    await db.transaction(
      'rw',
      [
        db.sales,
        db.stock,
        db.stockMovements,
        db.outbox,
        db.accountMovements,
        db.customerAccounts,
        db.cashSessions,
      ],
      async () => {
        await db.sales.add(sale);
        await applyStockMovements(movements, now);
        await applyAccountMovements(sale, now);
        await db.outbox.bulkAdd(outboxEvents);
        await db.cashSessions.put(recordSaleInCashSession(openSession, sale.id));
      },
    );
  } catch (error) {
    return err('sale/persist-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return ok(sale);
}

/**
 * Anula una venta cerrada y revierte su stock, en una única transacción.
 * `db.sales.put` reemplaza la fila (mismo id) — solo cambian `status`,
 * `voidedAt`/`voidReason`; `lines`/`payments`/`total`/`createdAt` quedan
 * intactos (RNF-07). El rastro auditable nuevo es la fila de
 * `stockMovements` con `reason: 'sale-void'`, nunca una edición de una vieja.
 */
export async function voidSaleAndPersist(
  saleId: string,
  params?: { reason?: string },
): Promise<Result<Sale>> {
  const now = new Date().toISOString();
  const origin = currentEventOrigin();
  const existing = await db.sales.get(saleId);
  if (existing === undefined) {
    return err('sale/not-found', { saleId });
  }

  const voidResult = voidSale(existing, {
    now,
    ...(params?.reason !== undefined ? { reason: params.reason } : {}),
  });
  if (!voidResult.ok) {
    return voidResult;
  }
  const voided = voidResult.value;

  const trackedProductIds = await trackedProductIdsFor(existing.lines);
  const movements = buildStockMovementsForSale(existing, {
    reason: 'sale-void',
    now,
    newMovementId: newId,
    trackedProductIds,
  });
  const outboxEvents = [
    buildOutboxEventForVoid({
      id: newId(),
      saleId: voided.id,
      voidedAt: now,
      ...(voided.voidReason !== undefined ? { voidReason: voided.voidReason } : {}),
      now,
      origin,
    }),
    ...buildOutboxEventsForStockMovements(movements, { now, origin }),
  ];

  try {
    await db.transaction('rw', db.sales, db.stock, db.stockMovements, db.outbox, async () => {
      await db.sales.put(voided);
      await applyStockMovements(movements, now);
      await db.outbox.bulkAdd(outboxEvents);
    });
  } catch (error) {
    return err('sale/persist-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return ok(voided);
}
