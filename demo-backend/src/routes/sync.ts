import type { DatabaseSync } from 'node:sqlite';
import { readJsonBody, sendJson } from '../http-helpers.ts';
import { withIdempotency } from '../idempotency.ts';
import {
  finishLot,
  isDelayEnabled,
  lotStatusFor,
  receiveLot,
  type BatchEvent,
  type LotIssue,
} from '../lots.ts';
import type { RouteDef } from '../router.ts';

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
    checksContract: true,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string') {
        sendJson(res, 400, { error: 'Falta el header Idempotency-Key' });
        return;
      }
      const body = (await readJsonBody(req)) as { deviceId?: string; events: BatchEvent[] };
      const result = await withIdempotency(ctx.db, idempotencyKey, () => {
        const now = new Date().toISOString();
        // `deviceId` es obligatorio en v3 pero tolerado ausente hasta la Etapa 2 de #94 (#97).
        receiveLot(
          ctx.db,
          { id: idempotencyKey, deviceId: body.deviceId ?? '', events: body.events },
          now,
        );
        // Sin demora (default) se procesa al toque, como antes de v3. Con demora, el lote queda
        // `queued` hasta que el operador lo avance desde el panel (/_demo).
        if (!isDelayEnabled(ctx.db)) {
          finishLot(ctx.db, idempotencyKey, now);
        }
        return { status: 200, body: {} };
      });
      sendJson(res, result.status, result.body);
    },
  },
  {
    method: 'POST',
    pattern: /^\/sync\/pull$/,
    checksContract: true,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const body = (await readJsonBody(req)) as {
        deviceId?: string;
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

      // Un lote que no conocemos se omite: el POS lo trata como `processing`. SQLite es síncrono
      // dentro de este handler, así que la foto y los estados son del mismo instante.
      const lots: Record<string, { status: string; issues?: LotIssue[] }> = {};
      for (const lotId of body.pendingLotIds) {
        const status = lotStatusFor(ctx.db, lotId);
        if (status !== undefined) {
          lots[lotId] = status;
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
