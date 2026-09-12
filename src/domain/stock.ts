import { z } from 'zod';

/**
 * Cantidad en stock de un producto. Vive en su propia tabla, indexada por
 * productId. El schema de Zod hace falta para validar la respuesta externa
 * de `GET /stock` (Fase 2) — antes de eso `StockItem` no lo necesitaba,
 * a diferencia de `Product`.
 */
export const stockItemSchema = z.object({
  productId: z.string(),
  quantity: z.number(),
  updatedAt: z.string(), // ISO 8601
});

export type StockItem = z.infer<typeof stockItemSchema>;

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
