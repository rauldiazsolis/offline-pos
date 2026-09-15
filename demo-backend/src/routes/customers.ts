import { readJsonBody, sendJson } from '../http-helpers.ts';
import { withIdempotency } from '../idempotency.ts';
import type { RouteDef } from '../router.ts';

type CustomerRow = { payload: string; updated_at: string };

export const customerRoutes: RouteDef[] = [
  {
    method: 'GET',
    pattern: /^\/customers$/,
    requiresAuth: true,
    handler: (_req, res, ctx) => {
      const since = ctx.url.searchParams.get('since');
      const rows = (
        since === null
          ? ctx.db
              .prepare('SELECT payload, updated_at FROM customers ORDER BY updated_at ASC')
              .all()
          : ctx.db
              .prepare(
                'SELECT payload, updated_at FROM customers WHERE updated_at > ? ORDER BY updated_at ASC',
              )
              .all(since)
      ) as CustomerRow[];

      const items = rows.map((row) => JSON.parse(row.payload) as unknown);
      const last = rows.at(-1);
      sendJson(res, 200, last === undefined ? { items } : { items, nextCursor: last.updated_at });
    },
  },
  {
    method: 'POST',
    pattern: /^\/customers$/,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string') {
        sendJson(res, 400, { error: 'Falta el header Idempotency-Key' });
        return;
      }
      const body = (await readJsonBody(req)) as { id: string };
      const result = await withIdempotency(ctx.db, idempotencyKey, () => {
        const now = new Date().toISOString();
        ctx.db
          .prepare(
            'INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?) ' +
              "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, source = 'pos', updated_at = excluded.updated_at",
          )
          .run(body.id, JSON.stringify(body), 'pos', now);
        return { status: 200, body: {} };
      });
      sendJson(res, result.status, result.body);
    },
  },
];
