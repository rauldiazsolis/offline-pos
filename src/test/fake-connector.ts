import type { Product } from '../domain/product.ts';
import { ok } from '../domain/result.ts';
import type { StockItem } from '../domain/stock.ts';
import type {
  AccountHoldResult,
  Connector,
  ConnectorCustomer,
  ConnectorPullResult,
} from '../sync/connector.ts';

/** `Connector` de mentira para tests: todo responde OK y vacío; cada test pisa lo que le importa. */
export function fakeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    pullProducts: () => Promise.resolve(ok<ConnectorPullResult<Product>>({ items: [] })),
    pullStock: () => Promise.resolve(ok<StockItem[]>([])),
    pullCustomers: () => Promise.resolve(ok<ConnectorPullResult<ConnectorCustomer>>({ items: [] })),
    pushSale: () => Promise.resolve(ok(undefined)),
    pushStockMovement: () => Promise.resolve(ok(undefined)),
    pushSaleVoid: () => Promise.resolve(ok(undefined)),
    pushCustomer: () => Promise.resolve(ok(undefined)),
    requestAccountHold: () =>
      Promise.resolve(ok<AccountHoldResult>({ approved: true, holdId: 'hold-1' })),
    pushAccountHoldConfirm: () => Promise.resolve(ok(undefined)),
    releaseAccountHold: () => Promise.resolve(ok(undefined)),
    pushCashSession: () => Promise.resolve(ok(undefined)),
    ...overrides,
  };
}
