import { z } from 'zod';
import type { EventOrigin } from '../domain/event-origin.ts';
import type { OutboxEventPayload } from '../domain/outbox.ts';
import { productSchema } from '../domain/product.ts';
import type { Result } from '../domain/result.ts';
import { stockItemSchema, type StockItem } from '../domain/stock.ts';

export type ConnectorPullResult<T> = { items: T[]; nextCursor?: string };

/** Bloqueo informativo (contrato v3, #96): nunca impide operar. `reason` puede ser vacío. */
export const blockedSchema = z.object({ reason: z.string() });

/** Producto tal como llega en el pull (contrato v3): la fecha de alta es obligatoria. */
export const connectorProductSchema = productSchema.extend({
  createdAt: z.string(),
  blocked: blockedSchema.optional(),
});

export type ConnectorProduct = z.infer<typeof connectorProductSchema>;

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
  // Contrato v3 (#96): fecha de alta real (obligatoria) y bloqueo informativo.
  createdAt: z.string(),
  blocked: blockedSchema.optional(),
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
 * Un evento del outbox tal como viaja dentro de un lote de push (contrato v3,
 * #96): los mismos campos de negocio que `OutboxEventPayload`
 * (`domain/outbox.ts`) más el sobre — `id` (identifica al evento dentro del
 * lote y en los avisos), `createdAt` y `origin` — sin `status`, que es
 * bookkeeping local.
 */
export type OutboxBatchItem = OutboxEventPayload & {
  id: string;
  createdAt: string;
  /** Contrato v3: obligatorio; `branch`/`pointOfSale` tolerados ausentes hasta la Etapa 2 (#97). */
  origin: EventOrigin;
};

/** Un lote de push: el dispositivo viaja una sola vez por request, no por evento. */
export type PushBatch = { deviceId: string; events: OutboxBatchItem[] };

/** Aviso del backend sobre un lote ya procesado; `eventId` apunta al evento del lote, si aplica. */
export type LotIssue = { message: string; eventId?: string };

export const lotIssueSchema = z.object({ message: z.string(), eventId: z.string().optional() });

/**
 * Estado de un lote de push (contrato v3, #96): `queued` (recibido, sin
 * empezar), `processing`, `ok`, `issues`. Un lote pedido que el backend no
 * informa se trata como `processing`.
 */
export const batchLotStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('queued') }),
  z.object({ status: z.literal('processing') }),
  z.object({ status: z.literal('ok') }),
  z.object({ status: z.literal('issues'), issues: z.array(lotIssueSchema) }),
]);

export type BatchLotStatus =
  | { status: 'queued' }
  | { status: 'processing' }
  | { status: 'ok' }
  | { status: 'issues'; issues: LotIssue[] };

export type PullBatchParams = {
  deviceId: string;
  /** Cursor por recurso — ausente pide la foto completa de ese recurso (todo o nada, sin paginar). */
  cursors: { products?: string; customers?: string };
  /** idempotency_id de lotes de push que el POS mandó y todavía no confirmó `ok`/`issues`. */
  pendingLotIds: string[];
};

export type PullBatchResult = {
  products: ConnectorPullResult<ConnectorProduct>;
  customers: ConnectorPullResult<ConnectorCustomer>;
  /** Sin cursor — mismo criterio que hoy, siempre completo, es liviano. */
  stock: StockItem[];
  /** Solo trae entradas para los ids de `pendingLotIds` que el backend todavía reconoce. */
  lots: Record<string, BatchLotStatus>;
};

export const pullResultSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({ items: z.array(itemSchema), nextCursor: z.string().optional() });

/** Respuesta de `/sync/pull` — compartida por los conectores que hablan el contrato tal cual. */
export const pullBatchResponseSchema = z.object({
  products: pullResultSchema(connectorProductSchema),
  customers: pullResultSchema(connectorCustomerSchema),
  stock: z.array(stockItemSchema),
  lots: z.record(z.string(), batchLotStatusSchema),
});

export function withCursor<T>(result: {
  items: T[];
  nextCursor?: string | undefined;
}): ConnectorPullResult<T> {
  return {
    items: result.items,
    ...(result.nextCursor !== undefined ? { nextCursor: result.nextCursor } : {}),
  };
}

/** `exactOptionalPropertyTypes`: Zod tipa sus opcionales como `T | undefined`; se omiten si faltan. */
export function toLotStatus(status: z.infer<typeof batchLotStatusSchema>): BatchLotStatus {
  if (status.status !== 'issues') {
    return { status: status.status };
  }
  return {
    status: 'issues',
    issues: status.issues.map((issue) => ({
      message: issue.message,
      ...(issue.eventId !== undefined ? { eventId: issue.eventId } : {}),
    })),
  };
}

export function toLots(
  lots: Record<string, z.infer<typeof batchLotStatusSchema>>,
): Record<string, BatchLotStatus> {
  return Object.fromEntries(Object.entries(lots).map(([id, status]) => [id, toLotStatus(status)]));
}

/** Reconstruye la respuesta validada sin `undefined` explícitos (`nextCursor`, `eventId`). */
export function toPullBatchResult(data: z.infer<typeof pullBatchResponseSchema>): PullBatchResult {
  return {
    products: withCursor(data.products),
    customers: withCursor(data.customers),
    stock: data.stock,
    lots: toLots(data.lots),
  };
}

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
  pushBatch(batch: PushBatch, idempotencyId: string): Promise<Result<void>>;
  /** Pide productos/clientes/stock en una sola llamada, más el estado de los lotes de push que interesan. */
  pullBatch(params: PullBatchParams): Promise<Result<PullBatchResult>>;
  requestAccountHold(
    params: { customerId: string; amount: number },
    idempotencyKey: string,
  ): Promise<Result<AccountHoldResult>>;
};
