import { z } from 'zod';
import type { OutboxEventPayload } from '../domain/outbox.ts';
import type { Product } from '../domain/product.ts';
import type { Result } from '../domain/result.ts';
import type { StockItem } from '../domain/stock.ts';

export type ConnectorPullResult<T> = { items: T[]; nextCursor?: string };

/**
 * Forma cruda de un cliente dentro de `pullBatch` (§6): un solo recurso con
 * los campos de cuenta corriente opcionales — vive acá, no en
 * `domain/customer.ts`, porque es vocabulario de red (la respuesta plana del
 * backend), no la forma que usa el dominio (que separa `Customer` de
 * `CustomerAccount`, ver `domain/customer.ts::splitConnectorCustomer`).
 */
export const connectorCustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  document: z.string().optional(),
  phone: z.string().optional(),
  creditLimit: z.number().optional(),
  margin: z.number().optional(),
  balance: z.number().optional(),
  updatedAt: z.string().optional(),
  // Capacidad declarada por el backend/conector para ESE cliente puntual (Etapa 3, #69).
  unrestricted: z.boolean().optional(),
});

export type ConnectorCustomer = z.infer<typeof connectorCustomerSchema>;

/** Respuesta de la reserva síncrona de crédito — única operación que sigue siendo un round-trip propio (§5, #87). */
export const accountHoldResultSchema = z.discriminatedUnion('approved', [
  z.object({ approved: z.literal(true), holdId: z.string() }),
  z.object({ approved: z.literal(false), reasonCode: z.string() }),
]);

export type AccountHoldResult = z.infer<typeof accountHoldResultSchema>;

/**
 * Un evento del outbox tal como viaja dentro de un lote de push: los mismos
 * campos de negocio que `OutboxEventPayload` (`domain/outbox.ts`) más el
 * `id` que lo identifica dentro del lote — sin `status`/`createdAt`, que son
 * bookkeeping local que al backend no le importa.
 */
export type OutboxBatchItem = OutboxEventPayload & { id: string };

/**
 * Estado de un lote de push, tal como lo informa `pullBatch` (#87). `pending`
 * es un valor propio, no la ausencia de `ok`/`issues`: mientras un lote está
 * `pending` no se sabe todavía si va a tener problemas.
 */
export type BatchLotStatus =
  | { status: 'pending' }
  | { status: 'ok' }
  | { status: 'issues'; issues: string[] };

export type PullBatchParams = {
  /** Cursor por recurso — ausente pide la foto completa de ese recurso (todo o nada, sin paginar). */
  cursors: { products?: string; customers?: string };
  /** idempotency_id de lotes de push que el POS mandó y todavía no confirmó `ok`/`issues`. */
  pendingLotIds: string[];
};

export type PullBatchResult = {
  products: ConnectorPullResult<Product>;
  customers: ConnectorPullResult<ConnectorCustomer>;
  /** Sin cursor — mismo criterio que hoy, siempre completo, es liviano. */
  stock: StockItem[];
  /** Solo trae entradas para los ids de `pendingLotIds` que el backend todavía reconoce. */
  lots: Record<string, BatchLotStatus>;
};

/**
 * Puerto hacia el sistema externo (§6 del doc de diseño, rediseñado por
 * #87 — "el backend nunca rechaza, casi todo es diferible"). Vive en
 * `sync/`, no en `domain/`: habla en términos de red (cursores,
 * idempotency_id, resultados HTTP-shaped) que no son vocabulario de dominio
 * puro. `connectors/` (implementaciones) importa este puerto; `domain/` no
 * sabe que existe.
 *
 * Dos operaciones batch (reemplazan los 10 endpoints por-recurso de antes de
 * #87) más `requestAccountHold`, la única que sigue siendo síncrona: decide
 * el flujo del cobro en el momento (§5), nunca pasa por el outbox.
 */
export type Connector = {
  /** Manda TODA la cola pendiente del outbox de una vez, con un solo idempotency_id para el lote entero. */
  pushBatch(items: OutboxBatchItem[], idempotencyId: string): Promise<Result<void>>;
  /** Pide productos/clientes/stock en una sola llamada, más el estado de los lotes de push que interesan. */
  pullBatch(params: PullBatchParams): Promise<Result<PullBatchResult>>;
  requestAccountHold(
    params: { customerId: string; amount: number },
    idempotencyKey: string,
  ): Promise<Result<AccountHoldResult>>;
};
