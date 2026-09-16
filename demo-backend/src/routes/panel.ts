import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { sendJson } from '../http-helpers.ts';
import type { RouteDef } from '../router.ts';

const panelHtmlPath = fileURLToPath(new URL('../panel.html', import.meta.url));
const panelHtml = readFileSync(panelHtmlPath, 'utf-8');

function listPayloads(db: DatabaseSync, sql: string): unknown[] {
  const rows = db.prepare(sql).all() as { payload: string }[];
  return rows.map((row) => JSON.parse(row.payload) as unknown);
}

export const panelRoutes: RouteDef[] = [
  {
    method: 'GET',
    pattern: /^\/_demo$/,
    requiresAuth: false,
    handler: (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(panelHtml);
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/sales$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(res, 200, listPayloads(ctx.db, 'SELECT payload FROM sales ORDER BY created_at DESC'));
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/cash-sessions$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(
        res,
        200,
        listPayloads(ctx.db, 'SELECT payload FROM cash_sessions ORDER BY created_at DESC'),
      );
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/customers$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(
        res,
        200,
        listPayloads(
          ctx.db,
          "SELECT payload FROM customers WHERE source = 'pos' ORDER BY updated_at DESC",
        ),
      );
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/account-holds$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      const rows = ctx.db
        .prepare(
          'SELECT id, customer_id, amount, status, created_at FROM account_holds ORDER BY created_at DESC',
        )
        .all() as { id: string; customer_id: string; amount: number; status: string; created_at: string }[];
      sendJson(
        res,
        200,
        rows.map((row) => {
          const customerRow = ctx.db.prepare('SELECT payload FROM customers WHERE id = ?').get(row.customer_id) as
            | { payload: string }
            | undefined;
          const customerName =
            customerRow === undefined
              ? row.customer_id
              : ((JSON.parse(customerRow.payload) as { name?: string }).name ?? row.customer_id);
          return {
            id: row.id,
            customerId: row.customer_id,
            customerName,
            amount: row.amount,
            status: row.status,
            createdAt: row.created_at,
          };
        }),
      );
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/customer-accounts$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      const rows = ctx.db.prepare('SELECT payload FROM customers').all() as { payload: string }[];
      const accounts = rows
        .map(
          (row) =>
            JSON.parse(row.payload) as {
              id: string;
              name: string;
              creditLimit?: number;
              margin?: number;
              balance?: number;
            },
        )
        .filter(
          (customer) =>
            customer.creditLimit !== undefined &&
            customer.margin !== undefined &&
            customer.balance !== undefined,
        )
        .map((customer) => ({
          id: customer.id,
          name: customer.name,
          creditLimit: customer.creditLimit,
          margin: customer.margin,
          balance: customer.balance,
          available: (customer.creditLimit ?? 0) + (customer.margin ?? 0) - (customer.balance ?? 0),
        }));
      sendJson(res, 200, accounts);
    },
  },
  {
    // Libera un hold desde el panel — mismo verbo que el endpoint real del
    // contrato (`DELETE /account-holds/{id}`) para no mezclar semántica,
    // pero bajo `/_demo/api/` y sin auth: es una acción del operador del
    // demo, no del POS, mismo criterio que el resto de `/_demo/api/*`.
    method: 'DELETE',
    pattern: /^\/_demo\/api\/account-holds\/(?<holdId>[^/]+)$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      ctx.db
        .prepare(
          "UPDATE account_holds SET status = 'released', released_at = ? WHERE id = ? AND status = 'pending'",
        )
        .run(new Date().toISOString(), ctx.params.holdId ?? '');
      sendJson(res, 200, {});
    },
  },
];
