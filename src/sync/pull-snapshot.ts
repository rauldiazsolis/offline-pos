import type { Product } from '../domain/product.ts';
import { err, ok, type Result } from '../domain/result.ts';
import type { StockItem } from '../domain/stock.ts';
import type { Connector, ConnectorCustomer } from './connector.ts';

/** Lo que trae una foto completa (la prueba de conexión y el refresco periódico): todo en memoria, nada tocó IndexedDB todavía. */
export type ProbeSnapshot = {
  products: Product[];
  stock: StockItem[];
  customers: ConnectorCustomer[];
  cursors: { products?: string; customers?: string };
};

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

/**
 * El catálogo completo (productos, stock y clientes) en memoria, **todo o nada**: si una parte
 * falla, devuelve ese fallo y nada se aplicó. Sin `since`: es la fuente de verdad de lo que existe.
 * Vive acá (y no en `connection.ts`) para que el motor de sync la use sin un ciclo de imports.
 */
export async function pullEverything(connector: Connector): Promise<Result<ProbeSnapshot>> {
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
