import { isLegacyOutboxType, markSynced, type OutboxEvent } from '../domain/outbox.ts';
import { db } from './db.ts';

/**
 * Lo que hay en la base local de esta terminal — lo que se perdería al cambiar
 * de conexión (Etapa 2b, #76). `pendingOutbox`/`pendingSales` son eventos que
 * todavía no llegaron al backend actual.
 */
export type LocalDataSummary = {
  products: number;
  customers: number;
  sales: number;
  cashSessions: number;
  pendingOutbox: number;
  pendingSales: number;
  draftCartLines: number;
};

/**
 * "Datos del usuario": lo que se generó en esta terminal y no se puede
 * reconstruir con un pull. Un catálogo o clientes solos se reemplazan sin
 * preguntar; esto sí exige confirmación antes de borrarse.
 */
export function hasUserData(summary: LocalDataSummary): boolean {
  return (
    summary.sales > 0 ||
    summary.cashSessions > 0 ||
    summary.pendingOutbox > 0 ||
    summary.draftCartLines > 0
  );
}

export async function countLocalCatalog(): Promise<{ products: number; customers: number }> {
  const [products, customers] = await Promise.all([db.products.count(), db.customers.count()]);
  return { products, customers };
}

export async function summarizeLocalData(): Promise<LocalDataSummary> {
  const [catalog, sales, cashSessions, pending, draft] = await Promise.all([
    countLocalCatalog(),
    db.sales.count(),
    db.cashSessions.count(),
    db.outbox.where('status').equals('pending').toArray(),
    db.draftCart.get('current'),
  ]);
  return {
    ...catalog,
    sales,
    cashSessions,
    pendingOutbox: pending.length,
    pendingSales: pending.filter((event) => event.type === 'sale').length,
    draftCartLines: draft?.cart.lines.length ?? 0,
  };
}

/**
 * Eventos del outbox que todavía no viajaron, en orden FIFO — el mismo orden
 * en que se arma un lote. Un evento de un tipo que el contrato ya no tiene
 * (`cash-session`, v3) se marca como enviado acá y nunca viaja.
 */
export async function listPendingOutbox(): Promise<OutboxEvent[]> {
  const pending = await db.outbox.where('status').equals('pending').sortBy('createdAt');
  const legacy = pending.filter((event) => isLegacyOutboxType(event.type));
  if (legacy.length > 0) {
    await db.outbox.bulkPut(legacy.map(markSynced));
  }
  return pending.filter((event) => !isLegacyOutboxType(event.type));
}

/**
 * Limpia **todas** las tablas — `db.tables`, no una lista escrita a mano, así
 * una tabla futura queda incluida sin acordarse. Tiene que correr dentro de
 * `db.transaction('rw', db.tables, …)`; lo usan `demoReset` y
 * `sync/apply-connection.ts`.
 */
export async function clearAllTables(): Promise<void> {
  await Promise.all(db.tables.map((table) => table.clear()));
}
