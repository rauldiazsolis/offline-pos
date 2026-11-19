import { POS_CONTRACT_VERSION } from '../domain/contract-version.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { toZodIssues } from '../domain/zod-issues.ts';
import { failedResponse } from '../connectors/rest/rest-fetch-connector.ts';
import {
  CLAIM_NOT_FOUND,
  CLAIM_USED,
  claimResponseSchema,
  toClaimResponse,
  type ClaimResponse,
} from './claim-schema.ts';
import { CONTRACT_VERSION_HEADER, DEVICE_ID_HEADER } from './connector.ts';
import { errorBodySchema, readJson } from './http-body.ts';

/**
 * `POST /claim` (4.7.0, #230, capacidad `device-claim`): canjea el código de vinculación de un
 * solo uso (`claimToken`, de la vuelta con `#connect=`) por la conexión de la caja, y la vincula a
 * este dispositivo. No pasa por el puerto `Connector` (como `demo-session.ts`): todavía no hay
 * key, así que va sin `Authorization`, con la versión del contrato y **siempre** con `X-Device-Id`
 * (es lo que se vincula). Adaptador HTTP: los únicos try/catch son `fetch` y `json()`. Sin
 * reintentos: el backend devuelve lo mismo si se repite desde el mismo equipo mientras el código
 * no vence, pero un reintento lo decide el operador.
 *
 * No se consulta `GET /info` antes para saber si el backend tiene la capacidad: `/info` es
 * autenticado y antes del claim no hay key. Un backend sin claim responde 404 sin cuerpo (o con
 * otro `code`): eso es `claim/not-offered`. Solo un 404 con `code: 'claim-not-found'` es un código
 * que el backend no conoce.
 */
export async function requestClaim(
  baseUrl: string,
  claimToken: string,
  deviceId: string,
): Promise<Result<ClaimResponse>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CONTRACT_VERSION_HEADER]: POS_CONTRACT_VERSION,
        [DEVICE_ID_HEADER]: deviceId,
      },
      body: JSON.stringify({ claimToken }),
    });
  } catch (error) {
    return err('sync/request-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (response.status === 409) {
    // El de contrato (`incompatible-contract`); `/claim` no tiene key que revocar.
    return failedResponse(response);
  }
  const body = await readJson(response);
  const errorBody = errorBodySchema.safeParse(body);
  const code = errorBody.success ? errorBody.data.code : undefined;
  const message = errorBody.success ? errorBody.data.message : undefined;
  if (response.status === 404) {
    return code === CLAIM_NOT_FOUND
      ? err('claim/not-found', undefined)
      : err('claim/not-offered', undefined);
  }
  if (response.status === 410) {
    // `claim-expired` u otro code: venció. Solo `claim-used` dice que lo usó otro equipo.
    return err('claim/expired', { reason: code === CLAIM_USED ? 'used' : 'expired' });
  }
  if (response.status === 503) {
    return err('sync/backend-maintenance', message !== undefined ? { message } : {});
  }
  if (!response.ok) {
    return err('sync/request-failed', {
      status: response.status,
      message: message ?? response.statusText,
    });
  }
  const parsed = claimResponseSchema.safeParse(body);
  if (!parsed.success) {
    return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
  }
  return ok(toClaimResponse(parsed.data));
}
