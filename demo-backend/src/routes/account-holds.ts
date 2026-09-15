import type { DatabaseSync } from 'node:sqlite';
import { readJsonBody, sendJson } from '../http-helpers.ts';
import type { RouteDef } from '../router.ts';

const NOT_IMPLEMENTED_BODY = {
  error: 'Cuenta corriente todavía no está implementada en el minibackend de demo.',
};

function logAttempt(db: DatabaseSync, kind: 'request' | 'confirm' | 'release', payload: unknown): void {
  const now = new Date().toISOString();
  const id = `${kind}-${now}-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    'INSERT INTO account_hold_attempts (id, kind, payload, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, kind, JSON.stringify(payload), now);
}

export const accountHoldRoutes: RouteDef[] = [
  {
    method: 'POST',
    pattern: /^\/account-holds$/,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const body = await readJsonBody(req);
      logAttempt(ctx.db, 'request', body);
      sendJson(res, 501, NOT_IMPLEMENTED_BODY);
    },
  },
  {
    method: 'POST',
    pattern: /^\/account-holds\/(?<holdId>[^/]+)\/confirm$/,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const body = await readJsonBody(req);
      logAttempt(ctx.db, 'confirm', { ...(body as object), holdId: ctx.params.holdId });
      sendJson(res, 501, NOT_IMPLEMENTED_BODY);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/account-holds\/(?<holdId>[^/]+)$/,
    requiresAuth: true,
    handler: (_req, res, ctx) => {
      logAttempt(ctx.db, 'release', { holdId: ctx.params.holdId });
      sendJson(res, 501, NOT_IMPLEMENTED_BODY);
    },
  },
];
