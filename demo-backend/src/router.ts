import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { sendJson } from './http-helpers.ts';
import { backendContractVersion, contractMajor } from './settings.ts';

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
  /**
   * Valida `X-POS-Contract-Version` (4.0.0, #99): con otro major responde
   * `409 incompatible-contract` sin procesar nada ni dar ack. Sin el header
   * (un POS anterior a 4.0.0) se procesa.
   */
  checksContract?: boolean;
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
 * `connectors/rest/rest-fetch-connector.ts::buildHeaders`), y
 * `X-POS-Contract-Version` porque el POS la manda en todo request (4.0.0).
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, Idempotency-Key, X-POS-Contract-Version',
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
    if (route.checksContract === true) {
      const declared = req.headers['x-pos-contract-version'];
      const backendVersion = backendContractVersion(db);
      if (
        typeof declared === 'string' &&
        contractMajor(declared) !== contractMajor(backendVersion)
      ) {
        sendJson(res, 409, { code: 'incompatible-contract', contractVersion: backendVersion });
        return;
      }
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
