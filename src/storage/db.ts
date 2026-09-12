import Dexie, { type EntityTable } from 'dexie';
import type { Product } from '../domain/product.ts';
import type { Sale } from '../domain/sale.ts';
import type { StockItem, StockMovement } from '../domain/stock.ts';

/**
 * Schema de IndexedDB para Fase 1. Sin tabla `outbox` todavía — eso es
 * Fase 2 (motor de sync), no adelantarlo acá.
 */
class PosDatabase extends Dexie {
  products!: EntityTable<Product, 'id'>;
  stock!: EntityTable<StockItem, 'productId'>;
  sales!: EntityTable<Sale, 'id'>;
  stockMovements!: EntityTable<StockMovement, 'id'>;

  constructor() {
    super('offline-pos');
    this.version(1).stores({
      products: 'id, sku, *barcodes, category',
      stock: 'productId',
      sales: 'id, status, createdAt',
      stockMovements: 'id, productId, saleId, createdAt',
    });
  }
}

export const db = new PosDatabase();
