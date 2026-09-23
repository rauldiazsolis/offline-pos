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

function logAttempt(db: DatabaseSync, payload: unknown): void {
  const now = new Date().toISOString();
  const id = `request-${now}-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    'INSERT INTO account_hold_attempts (id, kind, payload, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, 'request', JSON.stringify(payload), now);
}

function getCustomer(db: DatabaseSync, customerId: string): CustomerAccountPayload | undefined {
  const row = db.prepare('SELECT payload FROM customers WHERE id = ?').get(customerId) as
    { payload: string } | undefined;
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
 * Cuenta corriente (issue #55): la reserva síncrona sigue siendo la única
 * operación del contrato con respuesta inmediata (§5, #87) — su confirmación
 * y liberación pasaron a viajar dentro del lote de `/sync/push`
 * (`routes/sync.ts::applyBatchEvent`, ver CLAUDE.md "Connector API").
 * Sin TTL: un hold `pending` queda así hasta que el POS lo confirma o lo
 * libera (vía el lote) — decisión explícita para el demo, ver panel para
 * liberarlos a mano si queda alguno colgado.
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
      logAttempt(ctx.db, body);

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
];
