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
  return match !== null && match[1]?.trim() !== '';
}

/**
 * El POS y el minibackend corren en orígenes distintos siempre (Vite dev
 * server/preview en 5173/4173, este servidor en 4000) — sin CORS, el
 * `fetch()` del navegador nunca llega (bloqueado client-side, ni siquiera
 * pega el request real para los métodos/headers que disparan preflight).
 * Un demo público sin cookies/credenciales no necesita restringir el
 * origen — `*` alcanza. `Idempotency-Key` se suma a los headers permitidos
 * porque todo `POST` de eventos de negocio lo manda (ver
 * `connectors/rest/rest-fetch-connector.ts::buildHeaders`).
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
};

export async function handleRequest(
  db: DatabaseSync,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(name, value);
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';

  // El preflight del navegador no tiene body ni le importa ninguna ruta en
  // particular — solo pregunta si el request real va a estar permitido.
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

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
    try {
      await route.handler(req, res, { db, params: { ...(match.groups ?? {}) }, url });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  sendJson(res, 404, { error: `No existe ${method} ${url.pathname}` });
}
