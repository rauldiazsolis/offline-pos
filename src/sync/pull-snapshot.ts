import type { Product } from '../domain/product.ts';
import { err, ok, type Result } from '../domain/result.ts';
import type { StockItem } from '../domain/stock.ts';
import type { Connector, ConnectorCustomer, PullBatchResult } from './connector.ts';
import { getDeviceId } from './terminal-identity.ts';

/** Lo que trae un pull completo (la prueba de conexión y el refresco periódico): todo en memoria, nada tocó IndexedDB todavía. */
export type ProbeSnapshot = {
  products: Product[];
  stock: StockItem[];
  customers: ConnectorCustomer[];
  cursors: { products?: string; customers?: string };
};

/**
 * Carrera contra un tiempo máximo, sin cambiar el puerto `Connector`: si
 * vence, devuelve `sync/timeout` y el trabajo en vuelo se ignora (no se
 * cancela el `fetch`, solo se descarta su resultado).
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

/** Normaliza la respuesta de `pullBatch` (#87) a la forma que `storage/reconcile.ts` espera. */
export function toProbeSnapshot(result: PullBatchResult): ProbeSnapshot {
  return {
    products: result.products.items,
    stock: result.stock,
    customers: result.customers.items,
    cursors: {
      ...(result.products.nextCursor !== undefined ? { products: result.products.nextCursor } : {}),
      ...(result.customers.nextCursor !== undefined
        ? { customers: result.customers.nextCursor }
        : {}),
    },
  };
}

/**
 * Pull completo para la prueba de conexión (`sync/connection.ts::probeConnection`): sin cursores,
 * sin lotes de interés — un candidato nuevo nunca tiene lotes de push en vuelo contra él.
 */
export async function pullEverything(connector: Connector): Promise<Result<ProbeSnapshot>> {
  const result = await connector.pullBatch({
    deviceId: getDeviceId(),
    cursors: {},
    pendingLotIds: [],
  });
  if (!result.ok) {
    return result;
  }
  return ok(toProbeSnapshot(result.value));
}
