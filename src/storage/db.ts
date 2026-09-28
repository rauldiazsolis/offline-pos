import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Cart } from '../domain/cart.ts';
import type { CashCount } from '../domain/cash-count.ts';
import type { CashMovement } from '../domain/cash-movement.ts';
import type { CashConcept } from '../domain/concept-ranking.ts';
import type { AccountMovement, Customer, CustomerAccount } from '../domain/customer.ts';
import type { OutboxEvent } from '../domain/outbox.ts';
import type { Product } from '../domain/product.ts';
import type { Sale } from '../domain/sale.ts';
import type { StockItem, StockMovement } from '../domain/stock.ts';

/**
 * Fila única con la venta en curso (Fase de mejoras post-Fase 4, issue #17)
 * — `id` siempre `'current'`, Dexie no tiene noción nativa de "tabla
 * singleton". Ver `draft-cart-repository.ts`.
 */
export type DraftCart = { id: 'current'; cart: Cart; customer?: Customer };

/**
 * Schema de IndexedDB. `outbox` (Fase 2, motor de sync) se agrega en su
 * propia versión — nunca se toca el `.stores()` de una versión ya publicada,
 * Dexie migra automáticamente las instalaciones existentes a la última.
 */
class PosDatabase extends Dexie {
  products!: EntityTable<Product, 'id'>;
  stock!: EntityTable<StockItem, 'productId'>;
  sales!: EntityTable<Sale, 'id'>;
  stockMovements!: EntityTable<StockMovement, 'id'>;
  // `id` siempre lo generamos nosotros (nunca autogenerado por Dexie), así
  // que se pasa OutboxEvent como tipo de inserción explícito: el default de
  // Dexie usa `Omit<T, 'id'>`, que colapsa una unión discriminada (como
  // OutboxEvent) en un tipo sin los campos específicos de cada variante.
  outbox!: EntityTable<OutboxEvent, 'id', OutboxEvent>;
  customers!: EntityTable<Customer, 'id'>;
  customerAccounts!: EntityTable<CustomerAccount, 'customerId'>;
  accountMovements!: EntityTable<AccountMovement, 'id'>;
  draftCart!: EntityTable<DraftCart, 'id'>;
  cashMovements!: EntityTable<CashMovement, 'id'>;
  cashCounts!: EntityTable<CashCount, 'id'>;
  cashConcepts!: Table<CashConcept, [CashConcept['direction'], string]>;

  constructor() {
    super('offline-pos');
    this.version(1).stores({
      products: 'id, sku, *barcodes, category',
      stock: 'productId',
      sales: 'id, status, createdAt',
      stockMovements: 'id, productId, saleId, createdAt',
    });
    this.version(2).stores({
      outbox: 'id, status, createdAt',
    });
    this.version(3).stores({
      customers: 'id, name',
      customerAccounts: 'customerId',
      accountMovements: 'id, customerId, saleId, createdAt',
    });
    this.version(4).stores({
      draftCart: 'id',
    });
    // Fase 6: turnos de caja. La versión 7 elimina la tabla (Etapa 5 de #94).
    this.version(5).stores({
      cashSessions: 'id, openedAt',
    });
    // #99: la anulación es un ticket propio que apunta al original — el índice
    // responde "¿esta venta ya tiene anulación?" sin recorrer la tabla.
    this.version(6).stores({
      sales: 'id, status, createdAt, voidsSaleId',
    });
    // Etapa 5 de #94 (#100): caja sin turnos. `cashMovements` son los del contrato (todos con su
    // evento en el outbox); `cashCounts` guarda cada arqueo, aunque no tenga diferencia (base del
    // saldo); `cashConcepts` es la estadística de conceptos, nunca se limpia a los 7 días.
    // Se elimina la tabla de turnos: un turno abierto al actualizar se pierde sin migración (no
    // hay terminales en producción; el primer arqueo después arranca desde base 0).
    this.version(7).stores({
      cashMovements: 'id, createdAt',
      cashCounts: 'id, createdAt',
      cashConcepts: '[direction+concept], direction',
      cashSessions: null,
    });
  }
}

export const db = new PosDatabase();
