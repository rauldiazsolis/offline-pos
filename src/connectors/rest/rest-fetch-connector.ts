import { POS_CONTRACT_VERSION } from '../../domain/contract-version.ts';
import { err, ok, type Result } from '../../domain/result.ts';
import { toZodIssues } from '../../domain/zod-issues.ts';
import {
  accountHoldResultSchema,
  backendInfoSchema,
  CONTRACT_VERSION_HEADER,
  incompatibleContractBodySchema,
  pullBatchResponseSchema,
  toBackendInfo,
  toPullBatchResult,
  type AccountHoldResult,
  type BackendInfo,
  type Connector,
  type PullBatchParams,
  type PullBatchResult,
  type PushBatch,
} from '../../sync/connector.ts';
import type { RestConnectionConfig } from './config.ts';

function buildHeaders(config: RestConnectionConfig, idempotencyKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [CONTRACT_VERSION_HEADER]: POS_CONTRACT_VERSION,
  };
  if (config.apiKey !== undefined) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  if (idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return headers;
}

/**
 * Un `409 { code: 'incompatible-contract' }` (4.0.0, #99) es un backend que no
 * habla esta versión del contrato; cualquier otro error sigue siendo
 * `sync/request-failed` con su status.
 */
async function failedResponse(response: Response): Promise<Result<never>> {
  if (response.status === 409) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const parsed = incompatibleContractBodySchema.safeParse(body);
    if (parsed.success) {
      return err('sync/incompatible-contract', {
        backend: parsed.data.contractVersion,
        pos: POS_CONTRACT_VERSION,
      });
    }
  }
  return err('sync/request-failed', { status: response.status, message: response.statusText });
}

/**
 * Implementación de referencia del puerto `Connector` sobre `fetch` (ver
 * `docs/connector-api.openapi.yaml`, contrato 4.0.0 — #99). Todo request
 * lleva `X-POS-Contract-Version`. El *request* (nuestro propio dato ya
 * tipado) nunca se valida con Zod; la *respuesta* sí es externa → se valida.
 */
export function createRestFetchConnector(config: RestConnectionConfig): Connector {
  async function requestJson(
    method: 'GET' | 'POST',
    path: string,
    idempotencyKey: string | undefined,
    body?: unknown,
  ): Promise<Result<unknown>> {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}${path}`, {
        method,
        headers: buildHeaders(config, idempotencyKey),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      return err('sync/request-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (!response.ok) {
      return failedResponse(response);
    }
    try {
      return ok(await response.json());
    } catch {
      return err('sync/invalid-payload', {
        issues: [{ path: '', message: 'La respuesta no es JSON válido' }],
      });
    }
  }

  const postJson = (path: string, idempotencyKey: string | undefined, body: unknown) =>
    requestJson('POST', path, idempotencyKey, body);

  return {
    async getInfo(): Promise<Result<BackendInfo>> {
      const result = await requestJson('GET', '/info', undefined);
      if (!result.ok) {
        return result;
      }
      const parsed = backendInfoSchema.safeParse(result.value);
      if (!parsed.success) {
        return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
      }
      return ok(toBackendInfo(parsed.data));
    },

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
