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

export type Payment = { method: 'cash' | 'card' | 'other'; amount: number; reference?: string };

/**
 * Venta cerrada, persistida en IndexedDB. En Fase 1 nunca se persiste una
 * Sale con status 'open' — el carrito en curso vive solo en signals de UI;
 * una Sale nace ya 'closed' en el mismo momento en que se persiste.
 *
 * `syncedAt`, `voidedAt` y `voidReason` son opcionales (nunca `undefined`
 * explícito, así lo pide `exactOptionalPropertyTypes`). `syncedAt` no lo usa
 * todavía nadie en Fase 1 — lo agrega recién Fase 2 al confirmar el push,
 * pero se define ya para no tener que tocar el tipo (y todo lo que hace
 * switch/destructuring sobre él) más adelante.
 *
 * Anular una venta (RF-06) es la transición de ciclo de vida
 * status: 'closed' -> 'voided', ya contemplada por el enum — nunca se
 * editan `lines`/`payments`/`total`/`createdAt` (RNF-07: nada se edita
 * retroactivamente, solo se anula con un registro nuevo).
 */
export type Sale = {
  id: string; // ULID
  lines: SaleLine[];
  payments: Payment[];
  total: number;
  status: 'open' | 'closed' | 'voided';
  createdAt: string; // ISO 8601
  syncedAt?: string;
  voidedAt?: string;
  voidReason?: string;
};
