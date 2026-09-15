import { sendJson } from '../http-helpers.ts';
import type { RouteDef } from '../router.ts';

type StockRow = { product_id: string; quantity: number; updated_at: string };

export const stockRoutes: RouteDef[] = [
  {
    method: 'GET',
    pattern: /^\/stock$/,
    requiresAuth: true,
    handler: (_req, res, ctx) => {
      const rows = ctx.db.prepare('SELECT * FROM stock').all() as StockRow[];
      const items = rows.map((row) => ({
        productId: row.product_id,
        quantity: row.quantity,
        updatedAt: row.updated_at,
      }));
      sendJson(res, 200, items);
    },
  },
];
