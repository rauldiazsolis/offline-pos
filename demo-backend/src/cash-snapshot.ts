import type { DatabaseSync } from 'node:sqlite';
import type { Register } from './device-claim.ts';
import { isRecord, readPayload, readString, type Row } from './rows.ts';

/**
 * La foto de la caja (4.7.0, #230, capacidad `cash-snapshot`), armada desde lo que ya aplicó el
 * push: las ventas, cobranzas y movimientos de caja con el `origin` de la caja (sucursal + punto de
 * venta). Nunca se trunca.
 */

/** La ventana de `recentSales` y `recentCustomerPayments`: la de `/ANULAR`. */
export const RECENT_WINDOW_MS = 24 * 3_600_000;

type DocumentNumber = { date: string; number: number };
type Item = { payload: Record<string, unknown>; createdAtMs: number; createdAt: string };

export type CashSnapshot = {
  generatedAt: string;
  lastTicket?: DocumentNumber;
  lastReceipt?: DocumentNumber;
  recentSales: Record<string, unknown>[];
  recentCustomerPayments: Record<string, unknown>[];
  cashAnchor?: { countedAt: string; amount: number };
  cashMovements: Record<string, unknown>[];
};

/**
 * El instante de creación de un documento: su `createdAt` (el del POS, que es el que define la
 * ventana del contrato) o, si no vino o no se entiende, cuándo lo aplicó el backend.
 */
function toItem(row: Row): Item {
  const payload = readPayload(row);
  const declared = payload.createdAt;
  const declaredMs = typeof declared === 'string' ? Date.parse(declared) : Number.NaN;
  if (typeof declared === 'string' && Number.isFinite(declaredMs)) {
    return { payload, createdAtMs: declaredMs, createdAt: declared };
  }
  const applied = readString(row, 'created_at');
  return { payload, createdAtMs: Date.parse(applied), createdAt: applied };
}

function itemsOf(
  db: DatabaseSync,
  table: 'sales' | 'customer_payments' | 'cash_movements',
  register: Register,
): Item[] {
  return db
    .prepare(`SELECT payload, created_at FROM ${table} WHERE branch = ? AND point_of_sale = ?`)
    .all(register.branch, register.pointOfSale)
    .map(toItem);
}

function documentNumber(value: unknown): DocumentNumber | undefined {
  if (!isRecord(value) || typeof value.date !== 'string' || typeof value.number !== 'number') {
    return undefined;
  }
  return { date: value.date, number: value.number };
}

/** El número más alto por (fecha, número): los contadores son por día. */
function lastNumber(items: Item[], key: 'ticket' | 'receipt'): DocumentNumber | undefined {
  let last: DocumentNumber | undefined;
  for (const item of items) {
    const current = documentNumber(item.payload[key]);
    if (
      current !== undefined &&
      (last === undefined ||
        current.date > last.date ||
        (current.date === last.date && current.number > last.number))
    ) {
      last = current;
    }
  }
  return last;
}

function newestFirst(a: Item, b: Item): number {
  return b.createdAtMs - a.createdAtMs;
}

/** El arqueo de un ajuste `count-adjustment`: lo contado, o `undefined` si no es uno bien formado. */
function countedOf(item: Item): number | undefined {
  const { source, count } = item.payload;
  if (source !== 'count-adjustment' || !isRecord(count) || typeof count.counted !== 'number') {
    return undefined;
  }
  return count.counted;
}

export function buildCashSnapshot(db: DatabaseSync, register: Register, now: Date): CashSnapshot {
  const origin = { branch: register.branch, pointOfSale: register.pointOfSale };
  const withOrigin = (item: Item): Record<string, unknown> => ({ ...item.payload, origin });
  const since = now.getTime() - RECENT_WINDOW_MS;
  const recent = (items: Item[]): Record<string, unknown>[] =>
    items
      .filter((item) => item.createdAtMs >= since)
      .sort(newestFirst)
      .map(withOrigin);

  const sales = itemsOf(db, 'sales', register);
  const payments = itemsOf(db, 'customer_payments', register);
  const movements = itemsOf(db, 'cash_movements', register).sort(
    (a, b) => a.createdAtMs - b.createdAtMs,
  );

  // El ancla: el último ajuste de arqueo que el backend conoce (los arqueos son locales del POS).
  let anchor: { item: Item; counted: number } | undefined;
  for (const item of movements) {
    const counted = countedOf(item);
    if (
      counted !== undefined &&
      (anchor === undefined || item.createdAtMs >= anchor.item.createdAtMs)
    ) {
      anchor = { item, counted };
    }
  }
  const lastTicket = lastNumber(sales, 'ticket');
  const lastReceipt = lastNumber(payments, 'receipt');
  return {
    generatedAt: now.toISOString(),
    ...(lastTicket !== undefined ? { lastTicket } : {}),
    ...(lastReceipt !== undefined ? { lastReceipt } : {}),
    recentSales: recent(sales),
    recentCustomerPayments: recent(payments),
    ...(anchor !== undefined
      ? { cashAnchor: { countedAt: anchor.item.createdAt, amount: anchor.counted } }
      : {}),
    // Desde el ancla, el ajuste incluido; sin ancla, todos (la base es 0, como en el POS).
    cashMovements: movements
      .filter((item) => anchor === undefined || item.createdAtMs >= anchor.item.createdAtMs)
      .map(withOrigin),
  };
}
