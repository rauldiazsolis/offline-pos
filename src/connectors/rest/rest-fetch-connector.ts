import { z } from 'zod';
import { productSchema } from '../../domain/product.ts';
import { err, ok, type Result } from '../../domain/result.ts';
import { stockItemSchema } from '../../domain/stock.ts';
import { toZodIssues } from '../../domain/zod-issues.ts';
import {
  accountHoldResultSchema,
  connectorCustomerSchema,
  type AccountHoldResult,
  type Connector,
  type OutboxBatchItem,
  type PullBatchParams,
  type PullBatchResult,
} from '../../sync/connector.ts';
import type { RestConnectionConfig } from './config.ts';

const batchLotStatusSchema = z.union([
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('ok') }),
  z.object({ status: z.literal('issues'), issues: z.array(z.string()) }),
]);

const pullBatchResponseSchema = z.object({
  products: z.object({ items: z.array(productSchema), nextCursor: z.string().optional() }),
  customers: z.object({ items: z.array(connectorCustomerSchema), nextCursor: z.string().optional() }),
  stock: z.array(stockItemSchema),
  lots: z.record(z.string(), batchLotStatusSchema),
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

/**
 * Implementación de referencia del puerto `Connector` sobre `fetch` (ver
 * `docs/connector-api.openapi.yaml`, contrato v2 — #87). El *request*
 * (nuestro propio dato ya tipado) nunca se valida con Zod; la *respuesta* de
 * un pull sí es externa → se valida.
 */
export function createRestFetchConnector(config: RestConnectionConfig): Connector {
  async function postJson(
    path: string,
    idempotencyKey: string | undefined,
    body: unknown,
  ): Promise<Result<unknown>> {
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

  return {
    async pushBatch(items: OutboxBatchItem[], idempotencyId: string): Promise<Result<void>> {
      const result = await postJson('/sync/push', idempotencyId, { events: items });
      if (!result.ok) {
        return result;
      }
      return ok(undefined);
    },

    async pullBatch(params: PullBatchParams): Promise<Result<PullBatchResult>> {
      const result = await postJson('/sync/pull', undefined, params);
      if (!result.ok) {
        return result;
      }
      const parsed = pullBatchResponseSchema.safeParse(result.value);
      if (!parsed.success) {
        return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
      }
      // `exactOptionalPropertyTypes`: el `.optional()` de Zod infiere `string | undefined`
      // explícito, distinto de un `nextCursor?: string` sin valor — se reconstruye sin la clave
      // cuando está ausente, mismo criterio que `sync/pull-snapshot.ts::toProbeSnapshot`.
      const { products, customers, stock, lots } = parsed.data;
      return ok({
        products: {
          items: products.items,
          ...(products.nextCursor !== undefined ? { nextCursor: products.nextCursor } : {}),
        },
        customers: {
          items: customers.items,
          ...(customers.nextCursor !== undefined ? { nextCursor: customers.nextCursor } : {}),
        },
        stock,
        lots,
      });
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
  };
}
