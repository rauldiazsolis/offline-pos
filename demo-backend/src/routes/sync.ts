import type { DatabaseSync } from 'node:sqlite';
import { readJsonBody, sendJson } from '../http-helpers.ts';
import { withIdempotency } from '../idempotency.ts';
import type { RouteDef } from '../router.ts';

type OutboxBatchItem =
  | { type: 'sale'; id: string; sale: unknown }
  | { type: 'stock-movement'; id: string; movement: unknown }
  | { type: 'sale-void'; id: string; saleId: string; voidedAt: string; voidReason?: string }
  | { type: 'customer'; id: string; customer: { id: string } & Record<string, unknown> }
  | { type: 'account-hold-confirm'; id: string; holdId: string; saleId: string }
  | { type: 'account-hold-release'; id: string; holdId: string }
  | { type: 'cash-session'; id: string; session: unknown };

type CustomerAccountPayload = {
  id: string;
  name: string;
  creditLimit?: number;
  margin?: number;
  balance?: number;
};

function getCustomerPayload(
  db: DatabaseSync,
  customerId: string,
): CustomerAccountPayload | undefined {
  const row = db.prepare('SELECT payload FROM customers WHERE id = ?').get(customerId) as
    { payload: string } | undefined;
  return row === undefined ? undefined : (JSON.parse(row.payload) as CustomerAccountPayload);
}

/**
 * Aplica un evento del lote de push (#87) — el backend nunca rechaza por
 * contenido, así que esto nunca devuelve un error de negocio, solo escribe.
 * Upsert por id en cada tabla: con idempotencia ahora por LOTE en vez de por
 * evento, un mismo evento en dos lotes distintos pisa en vez de chocar (el
 * backend "se arregla como puede", ver spec).
 */
function applyBatchEvent(db: DatabaseSync, event: OutboxBatchItem, now: string): void {
  switch (event.type) {
    case 'sale':
      db.prepare(
        'INSERT INTO sales (id, payload, created_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
      ).run(event.id, JSON.stringify(event.sale), now);
      return;
    case 'stock-movement':
      db.prepare(
        'INSERT INTO stock_movements (id, payload, created_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
      ).run(event.id, JSON.stringify(event.movement), now);
      return;
    case 'sale-void':
      db.prepare(
        'INSERT INTO sale_voids (id, sale_id, payload, created_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
      ).run(event.id, event.saleId, JSON.stringify(event), now);
      return;
    case 'customer':
      db.prepare(
        'INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
      ).run(event.customer.id, JSON.stringify(event.customer), 'pos', now);
      return;
    case 'account-hold-confirm': {
      const hold = db
        .prepare('SELECT customer_id, amount, status FROM account_holds WHERE id = ?')
        .get(event.holdId) as { customer_id: string; amount: number; status: string } | undefined;
      if (hold !== undefined && hold.status === 'pending') {
        const customer = getCustomerPayload(db, hold.customer_id);
        if (customer !== undefined && customer.balance !== undefined) {
          db.prepare('UPDATE customers SET payload = ?, updated_at = ? WHERE id = ?').run(
            JSON.stringify({ ...customer, balance: customer.balance + hold.amount }),
            now,
            hold.customer_id,
          );
        }
        db.prepare(
          "UPDATE account_holds SET status = 'confirmed', confirmed_at = ? WHERE id = ?",
        ).run(now, event.holdId);
      }
      return;
    }
    case 'account-hold-release':
      db.prepare(
        "UPDATE account_holds SET status = 'released', released_at = ? WHERE id = ? AND status = 'pending'",
      ).run(now, event.holdId);
      return;
    case 'cash-session':
      db.prepare(
        'INSERT INTO cash_sessions (id, payload, created_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
      ).run(event.id, JSON.stringify(event.session), now);
      return;
    default: {
      const exhaustiveCheck: never = event;
      throw new Error(`Tipo de evento de outbox desconocido: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

type ResourceRow = { payload: string; updated_at: string };

function pullResource(
  db: DatabaseSync,
  table: 'products' | 'customers',
  since: string | undefined,
): { items: unknown[]; nextCursor?: string } {
  const rows = (
    since === undefined
      ? db.prepare(`SELECT payload, updated_at FROM ${table} ORDER BY updated_at ASC`).all()
      : db
          .prepare(
            `SELECT payload, updated_at FROM ${table} WHERE updated_at > ? ORDER BY updated_at ASC`,
          )
          .all(since)
  ) as ResourceRow[];
  const last = rows.at(-1);
  return {
    items: rows.map((row) => JSON.parse(row.payload) as unknown),
    ...(last !== undefined ? { nextCursor: last.updated_at } : {}),
  };
}

export const syncRoutes: RouteDef[] = [
  {
    method: 'POST',
    pattern: /^\/sync\/push$/,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string') {
        sendJson(res, 400, { error: 'Falta el header Idempotency-Key' });
        return;
      }
      const body = (await readJsonBody(req)) as { events: OutboxBatchItem[] };
      const result = await withIdempotency(ctx.db, idempotencyKey, () => {
        const now = new Date().toISOString();
        for (const event of body.events) {
          applyBatchEvent(ctx.db, event, now);
        }
        // Este backend de demo resuelve cada lote al toque — un backend real puede dejarlo
        // `pending` acá y actualizarlo más tarde de forma asíncrona (ver spec, #87).
        ctx.db
          .prepare(
            'INSERT INTO push_lots (id, status, issues, created_at) VALUES (?, ?, ?, ?) ' +
              'ON CONFLICT(id) DO NOTHING',
          )
          .run(idempotencyKey, 'ok', null, now);
        return { status: 200, body: {} };
      });
      sendJson(res, result.status, result.body);
    },
  },
  {
    method: 'POST',
    pattern: /^\/sync\/pull$/,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const body = (await readJsonBody(req)) as {
        cursors: { products?: string; customers?: string };
        pendingLotIds: string[];
      };

      const products = pullResource(ctx.db, 'products', body.cursors.products);
      const customers = pullResource(ctx.db, 'customers', body.cursors.customers);
      const stockRows = ctx.db.prepare('SELECT * FROM stock').all() as {
        product_id: string;
        quantity: number;
        updated_at: string;
      }[];

      const lots: Record<string, { status: string; issues?: string[] }> = {};
      for (const lotId of body.pendingLotIds) {
        const row = ctx.db
          .prepare('SELECT status, issues FROM push_lots WHERE id = ?')
          .get(lotId) as { status: string; issues: string | null } | undefined;
        if (row !== undefined) {
          lots[lotId] =
            row.issues !== null
              ? { status: row.status, issues: JSON.parse(row.issues) as string[] }
              : { status: row.status };
        }
      }

      sendJson(res, 200, {
        products,
        customers,
        stock: stockRows.map((row) => ({
          productId: row.product_id,
          quantity: row.quantity,
          updatedAt: row.updated_at,
        })),
        lots,
      });
    },
  },
];
