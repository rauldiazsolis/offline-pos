import { err, ok, type Result } from '../../domain/result.ts';
import { toZodIssues } from '../../domain/zod-issues.ts';
import {
  accountHoldResultSchema,
  pullBatchResponseSchema,
  toPullBatchResult,
  type AccountHoldResult,
  type Connector,
  type PullBatchParams,
  type PullBatchResult,
  type PushBatch,
} from '../../sync/connector.ts';
import type { RestConnectionConfig } from './config.ts';

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
 * `docs/connector-api.openapi.yaml`, contrato v3 — #96). El *request*
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
    async pushBatch(batch: PushBatch, idempotencyId: string): Promise<Result<void>> {
      const result = await postJson('/sync/push', idempotencyId, batch);
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
      return ok(toPullBatchResult(parsed.data));
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
