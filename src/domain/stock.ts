/** Cantidad en stock de un producto. Vive en su propia tabla, indexada por productId. */
export type StockItem = {
  productId: string;
  quantity: number;
  updatedAt: string; // ISO 8601
};

/**
 * Registro de auditoría append-only de un cambio de stock. Nunca se edita
 * una fila existente (RNF-07): una venta resta stock con reason 'sale', una
 * anulación lo repone con una fila NUEVA con reason 'sale-void'.
 */
export type StockMovement = {
  id: string; // ULID
  productId: string;
  delta: number;
  reason: 'sale' | 'sale-void';
  saleId?: string;
  createdAt: string; // ISO 8601
};
