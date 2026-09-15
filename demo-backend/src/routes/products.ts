import { sendJson } from '../http-helpers.ts';
import type { RouteDef } from '../router.ts';

type ProductRow = { payload: string; updated_at: string };

export const productRoutes: RouteDef[] = [
  {
    method: 'GET',
    pattern: /^\/products$/,
    requiresAuth: true,
    handler: (_req, res, ctx) => {
      const since = ctx.url.searchParams.get('since');
      const rows = (
        since === null
          ? ctx.db.prepare('SELECT payload, updated_at FROM products ORDER BY updated_at ASC').all()
          : ctx.db
              .prepare('SELECT payload, updated_at FROM products WHERE updated_at > ? ORDER BY updated_at ASC')
              .all(since)
      ) as ProductRow[];

      const items = rows.map((row) => JSON.parse(row.payload) as unknown);
      const last = rows.at(-1);
      sendJson(res, 200, last === undefined ? { items } : { items, nextCursor: last.updated_at });
    },
  },
];
