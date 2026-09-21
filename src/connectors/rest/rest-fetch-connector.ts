import { z } from 'zod';
import type { CashSession } from '../../domain/cash-session.ts';
import type { Customer } from '../../domain/customer.ts';
import { productSchema, type Product } from '../../domain/product.ts';
import { err, ok, type Result } from '../../domain/result.ts';
import type { Sale } from '../../domain/sale.ts';
import { stockItemSchema, type StockItem, type StockMovement } from '../../domain/stock.ts';
import { toZodIssues } from '../../domain/zod-issues.ts';
import {
  accountHoldResultSchema,
  connectorCustomerSchema,
  type AccountHoldResult,
  type Connector,
  type ConnectorCustomer,
  type ConnectorPullResult,
} from '../../sync/connector.ts';
import type { RestConnectionConfig } from './config.ts';

const productsPullResponseSchema = z.object({
  items: z.array(productSchema),
  nextCursor: z.string().optional(),
});

const customersPullResponseSchema = z.object({
  items: z.array(connectorCustomerSchema),
  nextCursor: z.string().optional(),
});

function buildHeaders(config: RestConnectionConfig, idempotencyKey?: string): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey !== undefined) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  if (idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return headers;
}

/** GET + parseo a JSON, envuelto en Result — el *contenido* se valida aparte, en el caller. */
async function fetchJson(url: string, headers: HeadersInit): Promise<Result<unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    return err('sync/request-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (!response.ok) {
    return err('sync/request-failed', { status: response.status, message: response.statusText });
  }
  try {
    return ok(await response.json());
  } catch {
    return err('sync/invalid-payload', {
      issues: [{ path: '', message: 'La respuesta no es JSON válido' }],
    });
  }
}

/**
 * Implementación de referencia del puerto `Connector` sobre `fetch` (ver
 * `docs/connector-api.openapi.yaml`). El *request* (nuestro propio dato ya
 * tipado) nunca se valida con Zod — la regla de "unknown solo en el borde,
 * validado" es para datos que entran, no para lo que nosotros mandamos. La
 * *respuesta* de un pull sí es externa → se valida.
 */
export function createRestFetchConnector(config: RestConnectionConfig): Connector {
  async function postEvent(
    path: string,
    idempotencyKey: string,
    body: unknown,
  ): Promise<Result<void>> {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: buildHeaders(config, idempotencyKey),
        body: JSON.stringify(body),
      });
    } catch (error) {
      return err('sync/request-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (!response.ok) {
      return err('sync/request-failed', { status: response.status, message: response.statusText });
    }
    return ok(undefined);
  }

  /** Como `postEvent`, pero devuelve el body parseado — para POSTs que responden datos (el hold). */
  async function postJson(path: string, idempotencyKey: string, body: unknown): Promise<Result<unknown>> {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: buildHeaders(config, idempotencyKey),
        body: JSON.stringify(body),
      });
    } catch (error) {
      return err('sync/request-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (!response.ok) {
      return err('sync/request-failed', { status: response.status, message: response.statusText });
    }
    try {
      return ok(await response.json());
    } catch {
      return err('sync/invalid-payload', {
        issues: [{ path: '', message: 'La respuesta no es JSON válido' }],
      });
    }
  }

  async function deleteResource(path: string, idempotencyKey: string): Promise<Result<void>> {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}${path}`, {
        method: 'DELETE',
        headers: buildHeaders(config, idempotencyKey),
      });
    } catch (error) {
      return err('sync/request-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (!response.ok) {
      return err('sync/request-failed', { status: response.status, message: response.statusText });
    }
    return ok(undefined);
  }

  return {
    async pullProducts(params): Promise<Result<ConnectorPullResult<Product>>> {
      const url = new URL('/products', config.baseUrl);
      if (params.since !== undefined) {
        url.searchParams.set('since', params.since);
      }

      const jsonResult = await fetchJson(url.toString(), buildHeaders(config));
      if (!jsonResult.ok) {
        return jsonResult;
      }

      const parsed = productsPullResponseSchema.safeParse(jsonResult.value);
      if (!parsed.success) {
        return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
      }
      return ok({
        items: parsed.data.items,
        ...(parsed.data.nextCursor !== undefined ? { nextCursor: parsed.data.nextCursor } : {}),
      });
    },

    async pullStock(): Promise<Result<StockItem[]>> {
      const url = new URL('/stock', config.baseUrl);
      const jsonResult = await fetchJson(url.toString(), buildHeaders(config));
      if (!jsonResult.ok) {
        return jsonResult;
      }

      const parsed = z.array(stockItemSchema).safeParse(jsonResult.value);
      if (!parsed.success) {
        return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
      }
      return ok(parsed.data);
    },

    pushSale(sale: Sale, idempotencyKey: string): Promise<Result<void>> {
      return postEvent('/sales', idempotencyKey, sale);
    },

    pushStockMovement(movement: StockMovement, idempotencyKey: string): Promise<Result<void>> {
      return postEvent('/stock-movements', idempotencyKey, movement);
    },

    pushSaleVoid(params, idempotencyKey: string): Promise<Result<void>> {
      return postEvent(`/sales/${params.saleId}/void`, idempotencyKey, params);
    },

    async pullCustomers(params): Promise<Result<ConnectorPullResult<ConnectorCustomer>>> {
      const url = new URL('/customers', config.baseUrl);
      if (params.since !== undefined) {
        url.searchParams.set('since', params.since);
      }

      const jsonResult = await fetchJson(url.toString(), buildHeaders(config));
      if (!jsonResult.ok) {
        return jsonResult;
      }

      const parsed = customersPullResponseSchema.safeParse(jsonResult.value);
      if (!parsed.success) {
        return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
      }
      return ok({
        items: parsed.data.items,
        ...(parsed.data.nextCursor !== undefined ? { nextCursor: parsed.data.nextCursor } : {}),
      });
    },

    pushCustomer(customer: Customer, idempotencyKey: string): Promise<Result<void>> {
      return postEvent('/customers', idempotencyKey, customer);
    },

    async requestAccountHold(params, idempotencyKey: string): Promise<Result<AccountHoldResult>> {
      const jsonResult = await postJson('/account-holds', idempotencyKey, params);
      if (!jsonResult.ok) {
        return jsonResult;
      }

      const parsed = accountHoldResultSchema.safeParse(jsonResult.value);
      if (!parsed.success) {
        return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
      }
      return ok(parsed.data);
    },

    pushAccountHoldConfirm(params, idempotencyKey: string): Promise<Result<void>> {
      return postEvent(`/account-holds/${params.holdId}/confirm`, idempotencyKey, {
        saleId: params.saleId,
      });
    },

    releaseAccountHold(params, idempotencyKey: string): Promise<Result<void>> {
      return deleteResource(`/account-holds/${params.holdId}`, idempotencyKey);
    },

    pushCashSession(session: CashSession, idempotencyKey: string): Promise<Result<void>> {
      return postEvent('/cash-sessions', idempotencyKey, session);
    },
  };
}
