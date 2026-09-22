import { z } from 'zod';
import type { CashSession } from '../domain/cash-session.ts';
import type { Product } from '../domain/product.ts';
import type { Result } from '../domain/result.ts';
import type { Sale } from '../domain/sale.ts';
import type { Customer } from '../domain/customer.ts';
import type { StockItem, StockMovement } from '../domain/stock.ts';

export type ConnectorPullResult<T> = { items: T[]; nextCursor?: string };

/**
 * Forma cruda de `GET /customers` (§6): un solo recurso con los campos de
 * cuenta corriente opcionales — vive acá, no en `domain/customer.ts`, porque
 * es vocabulario de red (la respuesta plana del backend), no la forma que
 * usa el dominio (que separa `Customer` de `CustomerAccount`, ver
 * `domain/customer.ts::splitConnectorCustomer`).
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
  // Capacidad declarada por el backend/conector para ESE cliente (Etapa 3,
  // #69) — ver `domain/customer.ts::splitConnectorCustomer`/`canChargeOffline`.
  unrestricted: z.boolean().optional(),
});

export type ConnectorCustomer = z.infer<typeof connectorCustomerSchema>;

/** Respuesta de `POST /account-holds` — bloqueo síncrono de crédito (§5). */
export const accountHoldResultSchema = z.discriminatedUnion('approved', [
  z.object({ approved: z.literal(true), holdId: z.string() }),
  z.object({ approved: z.literal(false), reasonCode: z.string() }),
]);

export type AccountHoldResult = z.infer<typeof accountHoldResultSchema>;

/**
 * Puerto hacia el sistema externo (§6 del doc de diseño — el POS no conoce
 * ningún backend específico, solo este contrato). Vive en `sync/`, no en
 * `domain/`: a diferencia de `CatalogSearch`, habla en términos
 * inherentemente de red (cursores, Idempotency-Key, resultados
 * HTTP-shaped) que no son vocabulario de dominio puro. `connectors/`
 * (implementaciones de referencia) importa este puerto; `domain/` no sabe
 * que existe.
 *
 * `requestAccountHold` es la única operación que no pasa por el outbox: es
 * un bloqueo síncrono por diseño (§5), invocado directamente durante el
 * cobro — nunca encolado ni reintentado por el motor.
 */
export type Connector = {
  pullProducts(params: { since?: string }): Promise<Result<ConnectorPullResult<Product>>>;
  pullStock(): Promise<Result<StockItem[]>>;
  pullCustomers(params: { since?: string }): Promise<Result<ConnectorPullResult<ConnectorCustomer>>>;
  pushSale(sale: Sale, idempotencyKey: string): Promise<Result<void>>;
  pushStockMovement(movement: StockMovement, idempotencyKey: string): Promise<Result<void>>;
  pushSaleVoid(
    params: { saleId: string; voidedAt: string; voidReason?: string },
    idempotencyKey: string,
  ): Promise<Result<void>>;
  pushCustomer(customer: Customer, idempotencyKey: string): Promise<Result<void>>;
  requestAccountHold(
    params: { customerId: string; amount: number },
    idempotencyKey: string,
  ): Promise<Result<AccountHoldResult>>;
  pushAccountHoldConfirm(
    params: { holdId: string; saleId: string },
    idempotencyKey: string,
  ): Promise<Result<void>>;
  releaseAccountHold(params: { holdId: string }, idempotencyKey: string): Promise<Result<void>>;
  /** Push de un turno de caja cerrado (Fase 6, `POST /cash-sessions`) — nunca uno abierto. */
  pushCashSession(session: CashSession, idempotencyKey: string): Promise<Result<void>>;
};
