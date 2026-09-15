import type { DatabaseSync } from 'node:sqlite';
import { readJsonBody, sendJson } from '../http-helpers.ts';
import { withIdempotency } from '../idempotency.ts';
import type { RouteDef } from '../router.ts';

/**
 * Fábrica de rutas de "evento que siempre se acepta" — `sales`,
 * `stock-movements`, `sales/{id}/void` y `cash-sessions` comparten el mismo
 * comportamiento (deduplicar por Idempotency-Key, guardar, responder 200):
 * este es un POS de mostrador, no e-commerce, así que el minibackend nunca
 * simula rechazo de negocio en el camino de sincronización.
 */
function writeEventRoute(params: {
  method: string;
  pattern: RegExp;
  insert: (db: DatabaseSync, id: string, body: unknown, now: string) => void;
}): RouteDef {
  return {
    method: params.method,
    pattern: params.pattern,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string') {
        sendJson(res, 400, { error: 'Falta el header Idempotency-Key' });
        return;
      }
      const body = await readJsonBody(req);
      const result = await withIdempotency(ctx.db, idempotencyKey, () => {
        params.insert(ctx.db, idempotencyKey, body, new Date().toISOString());
        return { status: 200, body: {} };
      });
      sendJson(res, result.status, result.body);
    },
  };
}

export const eventRoutes: RouteDef[] = [
  writeEventRoute({
    method: 'POST',
    pattern: /^\/sales$/,
    insert: (db, id, body, now) =>
      db
        .prepare('INSERT INTO sales (id, payload, created_at) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(body), now),
  }),
  writeEventRoute({
    method: 'POST',
    pattern: /^\/stock-movements$/,
    insert: (db, id, body, now) =>
      db
        .prepare('INSERT INTO stock_movements (id, payload, created_at) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(body), now),
  }),
  writeEventRoute({
    method: 'POST',
    pattern: /^\/sales\/(?<saleId>[^/]+)\/void$/,
    // `saleId` viaja en la URL, pero `writeEventRoute` no pasa `ctx.params`
    // a `insert` — se toma del body en su lugar (el POS lo manda igual, ver
    // `pushSaleVoid` en connectors/rest-fetch-connector.ts del POS).
    insert: (db, id, body, now) => {
      const saleId = (body as { saleId: string }).saleId;
      db
        .prepare('INSERT INTO sale_voids (id, sale_id, payload, created_at) VALUES (?, ?, ?, ?)')
        .run(id, saleId, JSON.stringify(body), now);
    },
  }),
  writeEventRoute({
    method: 'POST',
    pattern: /^\/cash-sessions$/,
    insert: (db, id, body, now) =>
      db
        .prepare('INSERT INTO cash_sessions (id, payload, created_at) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(body), now),
  }),
];
