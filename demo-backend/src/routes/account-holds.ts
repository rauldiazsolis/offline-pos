import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { readJsonBody, sendJson } from '../http-helpers.ts';
import { withIdempotency } from '../idempotency.ts';
import type { RouteDef } from '../router.ts';

type CustomerAccountPayload = {
  id: string;
  name: string;
  creditLimit?: number;
  margin?: number;
  balance?: number;
};

type StoredHold = { customer_id: string; amount: number; status: string };

function logAttempt(db: DatabaseSync, kind: 'request' | 'confirm' | 'release', payload: unknown): void {
  const now = new Date().toISOString();
  const id = `${kind}-${now}-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    'INSERT INTO account_hold_attempts (id, kind, payload, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, kind, JSON.stringify(payload), now);
}

function getCustomer(db: DatabaseSync, customerId: string): CustomerAccountPayload | undefined {
  const row = db.prepare('SELECT payload FROM customers WHERE id = ?').get(customerId) as
    | { payload: string }
    | undefined;
  return row === undefined ? undefined : (JSON.parse(row.payload) as CustomerAccountPayload);
}

/** Suma de holds `pending` de otros cobros en curso para ese cliente — evita doble gasto entre dos terminales. */
function pendingHeldFor(db: DatabaseSync, customerId: string): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM account_holds WHERE customer_id = ? AND status = 'pending'",
    )
    .get(customerId) as { total: number };
  return row.total;
}

/**
 * Cuenta corriente (issue #55, sesión de brainstorming 2026-09-16 — hasta acá
 * el minibackend solo logueaba el intento y respondía 501). Sin TTL: un hold
 * `pending` queda así hasta que el POS lo confirma (`/confirm`) o lo libera
 * (`DELETE`) — decisión explícita para el demo, ver panel para liberarlos a
 * mano si queda alguno colgado.
 */
export const accountHoldRoutes: RouteDef[] = [
  {
    method: 'POST',
    pattern: /^\/account-holds$/,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string') {
        sendJson(res, 400, { error: 'Falta el header Idempotency-Key' });
        return;
      }
      const body = (await readJsonBody(req)) as { customerId: string; amount: number };
      logAttempt(ctx.db, 'request', body);

      const result = await withIdempotency(ctx.db, idempotencyKey, () => {
        const customer = getCustomer(ctx.db, body.customerId);
        if (
          customer === undefined ||
          customer.creditLimit === undefined ||
          customer.margin === undefined ||
          customer.balance === undefined
        ) {
          return { status: 200, body: { approved: false, reasonCode: 'no-account' } };
        }

        const pendingHeld = pendingHeldFor(ctx.db, body.customerId);
        const available = customer.creditLimit + customer.margin - customer.balance - pendingHeld;
        if (body.amount > available) {
          return { status: 200, body: { approved: false, reasonCode: 'insufficient-credit' } };
        }

        const holdId = randomUUID();
        ctx.db
          .prepare(
            "INSERT INTO account_holds (id, customer_id, amount, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
          )
          .run(holdId, body.customerId, body.amount, new Date().toISOString());
        return { status: 200, body: { approved: true, holdId } };
      });
      sendJson(res, result.status, result.body);
    },
  },
  {
    method: 'POST',
    pattern: /^\/account-holds\/(?<holdId>[^/]+)\/confirm$/,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string') {
        sendJson(res, 400, { error: 'Falta el header Idempotency-Key' });
        return;
      }
      const holdId = ctx.params.holdId ?? '';
      const body = await readJsonBody(req);
      logAttempt(ctx.db, 'confirm', { ...(body as object), holdId });

      const result = await withIdempotency(ctx.db, idempotencyKey, () => {
        const hold = ctx.db
          .prepare('SELECT customer_id, amount, status FROM account_holds WHERE id = ?')
          .get(holdId) as StoredHold | undefined;
        if (hold === undefined) {
          return { status: 404, body: { error: 'Hold no encontrado' } };
        }
        if (hold.status === 'pending') {
          const customer = getCustomer(ctx.db, hold.customer_id);
          if (customer !== undefined && customer.balance !== undefined) {
            ctx.db
              .prepare('UPDATE customers SET payload = ?, updated_at = ? WHERE id = ?')
              .run(
                JSON.stringify({ ...customer, balance: customer.balance + hold.amount }),
                new Date().toISOString(),
                hold.customer_id,
              );
          }
          ctx.db
            .prepare("UPDATE account_holds SET status = 'confirmed', confirmed_at = ? WHERE id = ?")
            .run(new Date().toISOString(), holdId);
        }
        return { status: 200, body: {} };
      });
      sendJson(res, result.status, result.body);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/account-holds\/(?<holdId>[^/]+)$/,
    requiresAuth: true,
    handler: (_req, res, ctx) => {
      const holdId = ctx.params.holdId ?? '';
      logAttempt(ctx.db, 'release', { holdId });
      ctx.db
        .prepare(
          "UPDATE account_holds SET status = 'released', released_at = ? WHERE id = ? AND status = 'pending'",
        )
        .run(new Date().toISOString(), holdId);
      sendJson(res, 200, {});
    },
  },
];
