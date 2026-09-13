import type { Product } from '../domain/product.ts';
import type { Result } from '../domain/result.ts';
import type { Sale } from '../domain/sale.ts';
import type { StockItem, StockMovement } from '../domain/stock.ts';

export type ConnectorPullResult<T> = { items: T[]; nextCursor?: string };

/**
 * Puerto hacia el sistema externo (§6 del doc de diseño — el POS no conoce
 * ningún backend específico, solo este contrato). Vive en `sync/`, no en
 * `domain/`: a diferencia de `CatalogSearch`, habla en términos
 * inherentemente de red (cursores, Idempotency-Key, resultados
 * HTTP-shaped) que no son vocabulario de dominio puro. `connectors/`
 * (implementaciones de referencia) importa este puerto; `domain/` no sabe
 * que existe.
 */
export type Connector = {
  pullProducts(params: { since?: string }): Promise<Result<ConnectorPullResult<Product>>>;
  pullStock(): Promise<Result<StockItem[]>>;
  pushSale(sale: Sale, idempotencyKey: string): Promise<Result<void>>;
  pushStockMovement(movement: StockMovement, idempotencyKey: string): Promise<Result<void>>;
  pushSaleVoid(
    params: { saleId: string; voidedAt: string; voidReason?: string },
    idempotencyKey: string,
  ): Promise<Result<void>>;
};
