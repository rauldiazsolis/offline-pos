import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { sendJson } from './http-helpers.ts';

export type RouteContext = {
  db: DatabaseSync;
  params: Record<string, string>;
  url: URL;
};

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
) => Promise<void> | void;

export type RouteDef = {
  method: string;
  pattern: RegExp;
  requiresAuth: boolean;
  handler: RouteHandler;
};

/**
 * Tabla de rutas, poblada por cada módulo de `routes/` vía `registerRoutes`
 * — no hay librería de router, son 10 recursos fijos, alcanza con un array
 * recorrido en orden. Vive a nivel de módulo (no en `createApp`) porque cada
 * módulo de rutas se importa una sola vez y se registra al cargar `server.ts`.
 */
const routes: RouteDef[] = [];

export function registerRoutes(defs: RouteDef[]): void {
  routes.push(...defs);
}

function hasValidBearerToken(req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  if (typeof header !== 'string') {
    return false;
  }
  const match = /^Bearer (.+)$/.exec(header);
  return match !== null && (match[1] as string).trim() !== '';
}

export async function handleRequest(
  db: DatabaseSync,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';

  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }
    const match = route.pattern.exec(url.pathname);
    if (match === null) {
      continue;
    }
    if (route.requiresAuth && !hasValidBearerToken(req)) {
      sendJson(res, 401, { error: 'Falta el header Authorization: Bearer <token>' });
      return;
    }
    await route.handler(req, res, { db, params: { ...(match.groups as Record<string, string>) }, url });
    return;
  }

  sendJson(res, 404, { error: `No existe ${method} ${url.pathname}` });
}
