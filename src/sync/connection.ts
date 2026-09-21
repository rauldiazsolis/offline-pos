import type { Product } from '../domain/product.ts';
import { err, ok, type Result } from '../domain/result.ts';
import type { StockItem } from '../domain/stock.ts';
import { hasUserData, type LocalDataSummary } from '../storage/local-data.ts';
import type { SyncConfig } from './config.ts';
import type { Connector, ConnectorCustomer } from './connector.ts';
import { createConnector } from './connector-registry.ts';

/** Lo que trae una prueba de conexión: todo en memoria, nada tocó IndexedDB todavía. */
export type ProbeSnapshot = {
  products: Product[];
  stock: StockItem[];
  customers: ConnectorCustomer[];
  cursors: { products?: string; customers?: string };
};

export const PROBE_TIMEOUT_MS = 20_000;

/**
 * Carrera contra un tiempo máximo, sin cambiar el puerto `Connector`: si
 * vence, devuelve `sync/timeout` y el trabajo en vuelo se ignora (no se
 * cancela el `fetch`, solo se descarta su resultado). Un backend colgado no
 * puede dejar "Probando conexión…" para siempre.
 */
export function withTimeout<T>(promise: Promise<Result<T>>, ms: number): Promise<Result<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(err('sync/timeout', { seconds: Math.max(1, Math.round(ms / 1000)) }));
    }, ms);
    void promise.then((result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

async function pullEverything(connector: Connector): Promise<Result<ProbeSnapshot>> {
  const products = await connector.pullProducts({});
  if (!products.ok) {
    return products;
  }
  const stock = await connector.pullStock();
  if (!stock.ok) {
    return stock;
  }
  const customers = await connector.pullCustomers({});
  if (!customers.ok) {
    return customers;
  }
  return ok({
    products: products.value.items,
    stock: stock.value,
    customers: customers.value.items,
    cursors: {
      ...(products.value.nextCursor !== undefined ? { products: products.value.nextCursor } : {}),
      ...(customers.value.nextCursor !== undefined
        ? { customers: customers.value.nextCursor }
        : {}),
    },
  });
}

/**
 * Prueba una conexión candidata (Etapa 2b, #76): el pull completo de
 * productos, stock y clientes, **todo o nada**, en memoria. No toca IndexedDB,
 * ni los cursores, ni la config guardada — recién `applyConnection` lo hace,
 * y solo si esto salió bien. `options.connector` existe para testear sin red.
 */
export function probeConnection(
  config: SyncConfig,
  options: { timeoutMs?: number; connector?: Connector } = {},
): Promise<Result<ProbeSnapshot>> {
  const connector = options.connector ?? createConnector(config);
  return withTimeout(pullEverything(connector), options.timeoutMs ?? PROBE_TIMEOUT_MS);
}

function normalizeEndpoint(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Identidad del backend: el endpoint normalizado (sin barra final, host en
 * minúsculas). El `type` no forma parte: dos tipos de conector que hablan con
 * el mismo endpoint son el mismo backend. Cambiar la API key, el secreto o el
 * locale no cambia el origen.
 */
export function originKey(config: SyncConfig): string {
  switch (config.type) {
    case 'rest':
    case 'rest-demo':
      return normalizeEndpoint(config.baseUrl);
    case 'google-sheets':
      return normalizeEndpoint(config.webAppUrl);
    default: {
      const exhaustiveCheck: never = config;
      return exhaustiveCheck;
    }
  }
}

export type ConnectionPlan = { wipe: boolean; needsConfirmation: boolean };

/**
 * Decide qué hace falta al aplicar una conexión (función pura):
 * - `wipe`: el origen cambió, o no hay config actual (no se puede saber de
 *   qué origen son los datos, así que se los trata como ajenos).
 * - `needsConfirmation`: hay que borrar **y** hay datos del usuario que se
 *   perderían (ventas, turnos, pendientes de envío, venta en curso). Un
 *   catálogo o clientes solos se reemplazan sin preguntar — nunca se
 *   descartan ventas locales en silencio.
 */
export function planConnectionChange(params: {
  current: SyncConfig | undefined;
  candidate: SyncConfig;
  localData: LocalDataSummary;
}): ConnectionPlan {
  const sameOrigin =
    params.current !== undefined && originKey(params.current) === originKey(params.candidate);
  const wipe = !sameOrigin;
  return { wipe, needsConfirmation: wipe && hasUserData(params.localData) };
}
