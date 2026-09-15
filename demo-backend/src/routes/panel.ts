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
          'SELECT kind, payload, created_at FROM account_hold_attempts ORDER BY created_at DESC',
        )
        .all() as { kind: string; payload: string; created_at: string }[];
      sendJson(
        res,
        200,
        rows.map((row) => ({
          kind: row.kind,
          payload: JSON.parse(row.payload) as unknown,
          createdAt: row.created_at,
        })),
      );
    },
  },
];
