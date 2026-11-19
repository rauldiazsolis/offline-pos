import { failedResponse, buildHeaders } from '../connectors/rest/rest-fetch-connector.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { raiseDailyCounter } from '../domain/ticket-number.ts';
import { toZodIssues } from '../domain/zod-issues.ts';
import { hydrateSnapshot, type HydrationResult } from '../storage/hydrate-snapshot.ts';
import { CAPABILITY_CASH_SNAPSHOT, supportsCapability } from './backend-capabilities.ts';
import type { ConnectorConfig } from './connector-registry.ts';
import { deviceIdForBackend } from './device-id-header.ts';
import { markDeviceRevoked } from './device-revoked.ts';
import { readJson } from './http-body.ts';
import { withTimeout } from './pull-snapshot.ts';
import { getReceiptCounter, setReceiptCounter } from './receipt-counter.ts';
import { cashSnapshotSchema, toCashSnapshot, type CashSnapshot } from './snapshot-schema.ts';
import { getTicketCounter, setTicketCounter } from './ticket-counter.ts';

/**
 * `GET /snapshot` (4.7.0, #230, capacidad `cash-snapshot`): la foto de la caja de la key, para que
 * una terminal recién vinculada la retome. Fuera del puerto `Connector` (como `portal-link.ts`):
 * solo existe en backends REST; con Google Sheets no hay foto (`ok(undefined)`). Con la key y, a un
 * backend con `device-claim`, `X-Device-Id`. Un 404 es "sin foto" (`ok(undefined)`); cualquier
 * otro fallo vuelve como `Result` y quien llama lo ignora: nunca corta el onboarding. Un `409
 * device-revoked` marca la caja (otro equipo la volvió a vincular en el medio). Sin reintentos.
 */
export async function requestCashSnapshot(
  config: ConnectorConfig,
): Promise<Result<CashSnapshot | undefined>> {
  if (config.type === 'google-sheets') {
    return ok(undefined);
  }
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/snapshot`, {
      method: 'GET',
      headers: buildHeaders(config, { deviceId: deviceIdForBackend() }),
    });
  } catch (error) {
    return err('sync/request-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (response.status === 404) {
    return ok(undefined);
  }
  if (!response.ok) {
    const failed = await failedResponse(response);
    if (!failed.ok && failed.error === 'sync/device-revoked') {
      markDeviceRevoked(new Date().toISOString(), failed.meta.message);
    }
    return failed;
  }
  const parsed = cashSnapshotSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
  }
  return ok(toCashSnapshot(parsed.data));
}

/**
 * Sube los contadores de ticket y recibo a los últimos números de la caja, sin bajar nunca uno
 * local más alto. Se aplica aunque la hidratación se haya salteado: subir un contador nunca
 * duplica nada, y evita repetir un número que ya usó el equipo anterior.
 */
export function raiseCountersFromSnapshot(snapshot: CashSnapshot): void {
  if (snapshot.lastTicket !== undefined) {
    setTicketCounter(raiseDailyCounter(getTicketCounter(), snapshot.lastTicket));
  }
  if (snapshot.lastReceipt !== undefined) {
    setReceiptCounter(raiseDailyCounter(getReceiptCounter(), snapshot.lastReceipt));
  }
}

/** Tope de la foto: un backend colgado no puede dejar la terminal en "Preparando…". */
export const SNAPSHOT_TIMEOUT_MS = 20_000;

export type SnapshotOutcome =
  | { kind: 'not-offered' }
  | { kind: 'none' }
  | { kind: 'failed'; error: string }
  | { kind: 'applied'; hydration: HydrationResult };

/**
 * Después de aplicar una conexión que vino de un claim (4.7.0, #230, `ui/onboarding.ts`): si el
 * backend declara `cash-snapshot` (las capacidades de la prueba recién hecha), pide la foto,
 * hidrata la base y sube los contadores. Nunca falla: cualquier problema queda en la consola
 * (`console.info`) y la terminal arranca como una caja nueva. En entrenamiento no se llega acá
 * (los links de onboarding no se procesan).
 */
export async function retakeCashFromSnapshot(
  config: ConnectorConfig,
  capabilities: readonly string[] | undefined,
): Promise<SnapshotOutcome> {
  if (supportsCapability(capabilities, CAPABILITY_CASH_SNAPSHOT) !== true) {
    return { kind: 'not-offered' };
  }
  const snapshot = await withTimeout(requestCashSnapshot(config), SNAPSHOT_TIMEOUT_MS);
  if (!snapshot.ok) {
    console.info('[snapshot] no se pudo pedir la foto de la caja; arranca sin ella', snapshot);
    return { kind: 'failed', error: snapshot.error };
  }
  if (snapshot.value === undefined) {
    console.info('[snapshot] el backend no tiene foto de esta caja');
    return { kind: 'none' };
  }
  raiseCountersFromSnapshot(snapshot.value);
  const hydrated = await hydrateSnapshot(snapshot.value);
  if (!hydrated.ok) {
    console.info('[snapshot] no se pudo guardar la foto de la caja', hydrated);
    return { kind: 'failed', error: hydrated.error };
  }
  if (hydrated.value.kind === 'skipped') {
    console.info('[snapshot] ya había documentos locales: no se hidrató nada');
  }
  return { kind: 'applied', hydration: hydrated.value };
}
