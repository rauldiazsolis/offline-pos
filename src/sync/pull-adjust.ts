import type { ReapplyEffects } from '../domain/reapply.ts';
import { roundAmount, roundQuantity } from '../domain/rounding.ts';
import type { StockItem } from '../domain/stock.ts';
import type { ConnectorCustomer } from './connector.ts';

/**
 * Stock y clientes del pull tal como se van a aplicar (spec de #98, §1). Pura.
 *
 * - Reteniendo (algún lote `processing`): el stock queda el local entero y
 *   cada cliente con saldo local conserva su saldo local (`customerBalances`,
 *   #101: tenga o no cuenta corriente); datos maestros y bloqueos llegan igual.
 * - Sin retener: valor del backend + efectos de los eventos a reaplicar. El
 *   stock viaja completo, así que un producto con efectos y sin fila parte de
 *   0 — salvo con `stock: []`, que no toca el stock (#115); el saldo se ajusta solo en los clientes que vinieron con saldo (los que
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

  const stock =
    params.stock.length === 0 ? [] : adjustStock(params.stock, params.effects, params.now);

  const customers = params.customers.map((item) => {
    const delta = params.effects.balance.get(item.id);
    return item.balance === undefined || delta === undefined
      ? item
      : { ...item, balance: roundAmount(item.balance + delta) };
  });
  return { customers, stock };
}

/**
 * Stock del backend más los efectos. Solo con stock no vacío: desde 4.4.0, `stock: []` es "el
 * backend no mandó stock", no "todo en 0" (#115), así que no se arma ninguna fila desde 0.
 */
function adjustStock(
  incomingStock: readonly StockItem[],
  effects: ReapplyEffects,
  now: string,
): StockItem[] {
  const incoming = new Set(incomingStock.map((item) => item.productId));
  const stock = incomingStock.map((item) => {
    const delta = effects.stock.get(item.productId);
    return delta === undefined ? item : { ...item, quantity: roundQuantity(item.quantity + delta) };
  });
  for (const [productId, delta] of effects.stock) {
    if (!incoming.has(productId)) {
      stock.push({ productId, quantity: delta, updatedAt: now });
    }
  }
  return stock;
}
