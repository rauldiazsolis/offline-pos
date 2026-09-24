import type { ReapplyEffects } from '../domain/reapply.ts';
import { roundAmount, roundQuantity } from '../domain/rounding.ts';
import type { StockItem } from '../domain/stock.ts';
import type { ConnectorCustomer } from './connector.ts';

/**
 * Stock y clientes del pull tal como se van a aplicar (spec de #98, §1). Pura.
 *
 * - Reteniendo (algún lote `processing`): el stock queda el local entero y
 *   cada cliente con cuenta local conserva su saldo local; datos maestros y
 *   bloqueos llegan igual.
 * - Sin retener: valor del backend + efectos de los eventos a reaplicar. El
 *   stock viaja completo, así que un producto con efectos y sin fila parte de
 *   0; el saldo se ajusta solo en los clientes que vinieron con saldo (los que
 *   no vienen conservan el local, que ya incluye todo lo de esta terminal).
 */
export function adjustPull(params: {
  customers: readonly ConnectorCustomer[];
  stock: readonly StockItem[];
  retain: boolean;
  effects: ReapplyEffects;
  localStock: readonly StockItem[];
  localBalances: ReadonlyMap<string, number>;
  now: string;
}): { customers: ConnectorCustomer[]; stock: StockItem[] } {
  if (params.retain) {
    return {
      stock: [...params.localStock],
      customers: params.customers.map((item) => {
        const local = params.localBalances.get(item.id);
        return item.balance !== undefined && local !== undefined
          ? { ...item, balance: local }
          : item;
      }),
    };
  }

  const incoming = new Set(params.stock.map((item) => item.productId));
  const stock = params.stock.map((item) => {
    const delta = params.effects.stock.get(item.productId);
    return delta === undefined ? item : { ...item, quantity: roundQuantity(item.quantity + delta) };
  });
  for (const [productId, delta] of params.effects.stock) {
    if (!incoming.has(productId)) {
      stock.push({ productId, quantity: delta, updatedAt: params.now });
    }
  }

  const customers = params.customers.map((item) => {
    const delta = params.effects.balance.get(item.id);
    return item.balance === undefined || delta === undefined
      ? item
      : { ...item, balance: roundAmount(item.balance + delta) };
  });
  return { customers, stock };
}
