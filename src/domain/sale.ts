/** Descuento aplicado a una línea de venta, por monto fijo o por porcentaje. */
export type Discount = { type: 'amount' | 'percentage'; value: number };

/**
 * Línea de una venta. Unión discriminada por `kind` porque la barra de
 * comandos permite una "línea libre" (`descripción$monto`, ver §7 del doc de
 * diseño) que no corresponde a ningún producto del catálogo — modelarla
 * aparte evita inventar un Product sintético que ensuciaría búsqueda/reportes.
 */
export type SaleLine =
  | { kind: 'product'; productId: string; qty: number; unitPrice: number; discount?: Discount }
  | { kind: 'freeform'; description: string; qty: number; unitPrice: number; discount?: Discount };

/**
 * Medios de pago reales del negocio (issue #55, sesión de brainstorming
 * 2026-09-16) — se retiró el catálogo abierto `'other'` que tenía Fase 3:
 * todo pago tiene que mapear a uno de estos.
 */
export type PaymentMethod = 'cash' | 'debit' | 'credit' | 'transfer' | 'qr' | 'account';

/**
 * `'account'` (Fase 3, cuenta corriente) usa `reference` para el `holdId`
 * cuando el hold se aprobó con red — sin red (RF-18), no hay `holdId`.
 */
export type Payment = {
  method: PaymentMethod;
  amount: number;
  reference?: string;
};

/**
 * Venta cerrada, persistida en IndexedDB. Nunca se persiste una venta
 * abierta — el carrito en curso vive solo en signals de UI; una Sale nace ya
 * 'closed' en el mismo momento en que se persiste.
 *
 * `syncedAt` y `voidReason` son opcionales (nunca `undefined` explícito, así
 * lo pide `exactOptionalPropertyTypes`). `syncedAt` no lo usa
 * todavía nadie en Fase 1 — lo agrega recién Fase 2 al confirmar el push,
 * pero se define ya para no tener que tocar el tipo (y todo lo que hace
 * switch/destructuring sobre él) más adelante.
 *
 * `customerId` (Fase 3) identifica al cliente de la venta (RF-16) — se puede
 * adjuntar independientemente de cómo se pague; solo es obligatorio cuando
 * algún `Payment.method` es `'account'` (ver `closeSale`).
 *
 * Anular una venta (RF-06) es, desde la Etapa 4 de #94 (#99), un ticket
 * nuevo con las líneas y los pagos invertidos y `voidsSaleId` apuntando al
 * original (`buildVoidSale`) — el original nunca se toca (RNF-07: nada se
 * edita retroactivamente, solo se compensa con un registro nuevo).
 */
export type Sale = {
  id: string; // ULID
  lines: SaleLine[];
  payments: Payment[];
  total: number;
  /**
   * `voided` solo aparece en ventas guardadas antes de la Etapa 4 de #94;
   * desde entonces una anulación es un ticket negativo aparte (`voidsSaleId`)
   * y ningún código nuevo lo escribe.
   */
  status: 'closed' | 'voided';
  createdAt: string; // ISO 8601
  syncedAt?: string;
  /** Solo en un ticket de anulación: el motivo que tipeó el cajero. */
  voidReason?: string;
  /**
   * Solo en un ticket de anulación (#99): la venta que anula. Es un
   * documento independiente que mueve stock, saldo y efectivo por su cuenta;
   * esto queda para auditoría y para marcar el original como anulado.
   */
  voidsSaleId?: string;
  customerId?: string;
  /** Recargo (positivo) o descuento (negativo) global aplicado, RF-03 — copiado del Cart al cerrar. */
  globalAdjustmentPercentage?: number;
};
