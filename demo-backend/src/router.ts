import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { isRevokedKey } from './demo-keys.ts';
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

/** El token de `Authorization: Bearer <token>`, o `undefined` si falta o está vacío. */
function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') {
    return undefined;
  }
  const token = /^Bearer (.+)$/.exec(header)?.[1]?.trim();
  return token === undefined || token === '' ? undefined : token;
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
    // Una página pública (el POS publicado) que llama a localhost: Chrome pide permiso de red
    // local, y algunos Chromium todavía mandan este preflight de Private Network Access (#148).
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
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
    if (route.requiresAuth && bearerToken(req) === undefined) {
      sendJson(res, 401, { error: 'Falta el header Authorization: Bearer <token>' });
      return;
    }
    // Una demo revocada (#176): el POS en demo lo toma como "la demo terminó".
    if (route.requiresAuth && isRevokedKey(db, bearerToken(req))) {
      sendJson(res, 401, { error: 'La demo terminó' });
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
