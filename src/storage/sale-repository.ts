import type { Cart } from '../domain/cart.ts';
import { recordSaleInCashSession, type CashSession } from '../domain/cash-session.ts';
import { buildAccountMovementForSale } from '../domain/customer.ts';
import {
  buildOutboxEventForHoldConfirm,
  buildOutboxEventForSale,
  buildOutboxEventsForStockMovements,
} from '../domain/outbox.ts';
import type { EventOrigin } from '../domain/event-origin.ts';
import { err, ok, type Result } from '../domain/result.ts';
import {
  buildStockMovementsForSale,
  buildVoidSale,
  closeSale,
  isVoided,
  VOID_WINDOW_MS,
} from '../domain/sale-lifecycle.ts';
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
 * Persiste una venta ya armada (un cierre o el ticket de una anulación, #99)
 * con todo lo que la acompaña, en una sola transacción: la venta, sus
 * movimientos de stock y de cuenta, sus eventos del outbox y, si hay un turno
 * abierto, su registro en él.
 */
async function persistSaleDocument(
  sale: Sale,
  params: {
    reason: StockMovement['reason'];
    now: string;
    origin: EventOrigin;
    openSession: CashSession | undefined;
    pendingHold?: { holdId: string };
  },
): Promise<Result<void>> {
  const { now, origin, openSession } = params;
  const trackedProductIds = await trackedProductIdsFor(sale.lines);
  const movements = buildStockMovementsForSale(sale, {
    reason: params.reason,
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
        if (openSession !== undefined) {
          await db.cashSessions.put(recordSaleInCashSession(openSession, sale.id));
        }
      },
    );
  } catch (error) {
    return err('sale/persist-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return ok(undefined);
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

  const persisted = await persistSaleDocument(sale, {
    reason: 'sale',
    now,
    origin,
    openSession,
    ...(params.pendingHold !== undefined ? { pendingHold: params.pendingHold } : {}),
  });
  if (!persisted.ok) {
    return persisted;
  }
  return ok(sale);
}

/**
 * Anula una venta con un ticket propio (RF-06, #99): una venta nueva con las
 * líneas y los pagos invertidos (`buildVoidSale`), que se persiste igual que
 * un cierre — en una transacción, con sus movimientos de stock (`reason:
 * 'sale-void'`, reponen), sus movimientos de cuenta (acredita lo que se cargó
 * a cuenta corriente) y su evento `sale` en el outbox. El original no se toca
 * (RNF-07). Devuelve el ticket de anulación.
 *
 * Anular no exige un turno de caja abierto; si hay uno, la anulación queda
 * registrada en él (hasta la Etapa 5, #100), así el arqueo de `/CAJA`
 * descuenta el efectivo devuelto.
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
  const isAlreadyVoided = (await db.sales.where('voidsSaleId').equals(saleId).count()) > 0;

  const voidResult = buildVoidSale(existing, {
    id: newId(),
    now,
    isAlreadyVoided,
    ...(params?.reason !== undefined ? { reason: params.reason } : {}),
  });
  if (!voidResult.ok) {
    return voidResult;
  }
  const voidTicket = voidResult.value;

  const openSession = await getCurrentOpenCashSession();
  const persisted = await persistSaleDocument(voidTicket, {
    reason: 'sale-void',
    now,
    origin,
    openSession,
  });
  if (!persisted.ok) {
    return persisted;
  }
  return ok(voidTicket);
}

/** Una fila de `/ANULAR` (#99): anulable, original ya anulada, o el ticket de una anulación. */
export type VoidCandidate = {
  sale: Sale;
  state: 'voidable' | 'voided' | 'void-ticket';
  /** Solo en `void-ticket`: la venta que anula (si todavía está en la base). */
  original?: Sale;
};

/** Tope de `/ANULAR` (#99): los últimos 20 tickets de la ventana de 24 h. */
export const VOID_CANDIDATES_LIMIT = 20;

/** Ids de las ventas de `saleIds` que tienen un ticket que las anula. */
export async function loadVoidedSaleIds(saleIds: readonly string[]): Promise<Set<string>> {
  if (saleIds.length === 0) {
    return new Set();
  }
  const voids = await db.sales
    .where('voidsSaleId')
    .anyOf([...saleIds])
    .toArray();
  return new Set(
    voids.flatMap((sale) => (sale.voidsSaleId !== undefined ? [sale.voidsSaleId] : [])),
  );
}

/** Las ventas que anulan los tickets de anulación de `sales`, por id. */
export async function loadVoidOriginals(sales: readonly Sale[]): Promise<Map<string, Sale>> {
  const ids = [
    ...new Set(sales.flatMap((sale) => (sale.voidsSaleId !== undefined ? [sale.voidsSaleId] : []))),
  ];
  const originals = await db.sales.bulkGet(ids);
  return new Map(
    originals.flatMap((sale) => (sale !== undefined ? [[sale.id, sale] as const] : [])),
  );
}

/**
 * Lo que muestra `/ANULAR` (#99): los últimos 20 tickets de las últimas 24 h,
 * anulaciones incluidas, más nuevo primero.
 */
export async function listVoidCandidates(now: string): Promise<VoidCandidate[]> {
  const since = new Date(Date.parse(now) - VOID_WINDOW_MS).toISOString();
  const recent = await db.sales.where('createdAt').above(since).reverse().sortBy('createdAt');
  const sales = recent.slice(0, VOID_CANDIDATES_LIMIT);
  const voidedIds = await loadVoidedSaleIds(sales.map((sale) => sale.id));
  const originals = await loadVoidOriginals(sales);
  return sales.map((sale): VoidCandidate => {
    if (sale.voidsSaleId !== undefined) {
      const original = originals.get(sale.voidsSaleId);
      return { sale, state: 'void-ticket', ...(original !== undefined ? { original } : {}) };
    }
    return { sale, state: isVoided(sale, voidedIds) ? 'voided' : 'voidable' };
  });
}
