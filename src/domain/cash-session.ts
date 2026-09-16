import { err, ok, type Result } from './result.ts';
import type { Payment, Sale } from './sale.ts';

/**
 * Turno de caja (Fase 6). Igual que una `Sale` nunca se persiste con
 * `status: 'open'` (nace ya cerrada, Fase 1), un turno **abierto** no se
 * sincroniza — solo se encola en el outbox al cerrarse, con el registro
 * completo (ver `buildOutboxEventForCashSession` en `domain/outbox.ts`).
 * Mientras está abierto vive solo en la tabla local `cashSessions`
 * (`storage/cash-session-repository.ts`), mismo espíritu que `draftCart`:
 * sobrevive a un refresh/crash de esta terminal, no viaja a ningún lado
 * todavía.
 *
 * `sales[]` se llena incrementalmente (`recordSaleInCashSession`, llamado
 * desde `storage/sale-repository.ts::closeSaleAndPersist`) y nunca se le
 * saca un id (RNF-07): una venta anulada sigue apareciendo como rastro de
 * que pasó por este turno, pero `calculateCashSessionSummary` la excluye de
 * los totales. Shape idéntico al schema `CashSession` ya documentado en
 * `docs/connector-api.openapi.yaml` desde que se armó el contrato completo.
 */
export type CashSession = {
  id: string; // ULID
  openedAt: string; // ISO 8601
  closedAt?: string;
  openingAmount: number;
  closingAmount?: number;
  sales: string[]; // IDs de Sale incluidas en el turno
};

/**
 * Resumen de un turno — reportes básicos (Fase 6). `totalsByMethod` desglosa
 * el total por cada medio de pago; `expectedCash`/`countedCash`/`difference`
 * son el arqueo, que se hace **solo con efectivo** (decisión del usuario:
 * tarjeta/cuenta corriente no tienen equivalente físico para "contar").
 */
export type CashSessionSummary = {
  salesCount: number;
  totalsByMethod: Record<Payment['method'], number>;
  expectedCash: number;
  countedCash?: number;
  difference?: number;
};

function validateAmount(amount: number): Result<void> {
  if (amount < 0) {
    return err('cash-session/invalid-amount', { amount });
  }
  return ok(undefined);
}

/** Abre un turno nuevo — `openingAmount` es el efectivo con el que arranca el cajón. */
export function openCashSession(params: {
  id: string;
  openingAmount: number;
  now: string;
}): Result<CashSession> {
  const validation = validateAmount(params.openingAmount);
  if (!validation.ok) {
    return validation;
  }
  return ok({
    id: params.id,
    openedAt: params.now,
    openingAmount: params.openingAmount,
    sales: [],
  });
}

/**
 * Cierra un turno ya abierto — `closingAmount` es el efectivo contado a
 * mano. No calcula el arqueo (eso es `calculateCashSessionSummary`, que
 * necesita las `Sale[]` reales): esta función solo hace la transición de
 * ciclo de vida, como `closeSale`/`voidSale` en `sale-lifecycle.ts`.
 */
export function closeCashSession(
  session: CashSession,
  params: { closingAmount: number; now: string },
): Result<CashSession> {
  if (session.closedAt !== undefined) {
    return err('cash-session/already-closed', undefined);
  }
  const validation = validateAmount(params.closingAmount);
  if (!validation.ok) {
    return validation;
  }
  return ok({ ...session, closedAt: params.now, closingAmount: params.closingAmount });
}

/** Agrega el id de una venta recién cerrada al turno abierto (ver comentario del tipo). */
export function recordSaleInCashSession(session: CashSession, saleId: string): CashSession {
  return { ...session, sales: [...session.sales, saleId] };
}

/**
 * Pura: recibe las `Sale[]` ya resueltas por el caller (`storage/`, que las
 * busca por los ids de `session.sales`) — `domain/` no toca Dexie. Filtra
 * por `status === 'closed'`: una venta anulada dentro del turno queda como
 * rastro en `sales[]` pero no cuenta para ningún total (ver comentario del
 * tipo `CashSession`).
 */
export function calculateCashSessionSummary(
  session: CashSession,
  sales: Sale[],
): CashSessionSummary {
  const closedSales = sales.filter((sale) => sale.status === 'closed');
  const totalsByMethod: Record<Payment['method'], number> = {
    cash: 0,
    debit: 0,
    credit: 0,
    transfer: 0,
    qr: 0,
    account: 0,
  };
  for (const sale of closedSales) {
    for (const payment of sale.payments) {
      totalsByMethod[payment.method] += payment.amount;
    }
  }
  const expectedCash = session.openingAmount + totalsByMethod.cash;
  const base: CashSessionSummary = { salesCount: closedSales.length, totalsByMethod, expectedCash };
  return session.closingAmount !== undefined
    ? { ...base, countedCash: session.closingAmount, difference: session.closingAmount - expectedCash }
    : base;
}
