import { z } from 'zod';
import { err, ok, type Result } from '../../domain/result.ts';
import { toZodIssues } from '../../domain/zod-issues.ts';
import type { GoogleSheetsConfig } from './config.ts';

export type BridgeRequest = {
  action: string;
  payload?: object;
  idempotencyKey?: string;
};

/**
 * Envelope de respuesta del puente. Apps Script no permite controlar el
 * código HTTP de un `doPost`, así que éxito/error viajan en el body, nunca
 * en el status — mapea directo al `Result<T>` del resto del código.
 */
const bridgeEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

/**
 * Único lugar que conoce el formato del envelope del puente. El *request*
 * (dato nuestro, ya tipado) no se valida; la *respuesta* sí — es externa.
 *
 * `Content-Type: text/plain;charset=utf-8` y **ningún otro header**: Apps
 * Script Web Apps no responden bien al preflight `OPTIONS` que un navegador
 * dispara para `application/json` (o cualquier header custom) cross-origin.
 * Con `text/plain` es un "simple request" sin preflight; el script parsea
 * el body con `JSON.parse(e.postData.contents)` igual. Por eso la
 * idempotency key y el secreto viajan dentro del envelope, no como headers.
 */
export async function callBridge<S extends z.ZodType>(
  config: GoogleSheetsConfig,
  request: BridgeRequest,
  dataSchema: S,
): Promise<Result<z.infer<S>>> {
  const body = {
    action: request.action,
    payload: request.payload ?? {},
    ...(request.idempotencyKey !== undefined ? { idempotencyKey: request.idempotencyKey } : {}),
    ...(config.sharedSecret !== undefined ? { sharedSecret: config.sharedSecret } : {}),
  };

  let response: Response;
  try {
    response = await fetch(config.webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
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

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return err('sync/invalid-payload', {
      issues: [{ path: '', message: 'La respuesta del puente no es JSON válido' }],
    });
  }

  const envelope = bridgeEnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    return err('sync/invalid-payload', { issues: toZodIssues(envelope.error) });
  }
  if (!envelope.data.ok) {
    return err('sync/remote-error', { message: envelope.data.error });
  }

  const data = dataSchema.safeParse(envelope.data.data);
  if (!data.success) {
    return err('sync/invalid-payload', { issues: toZodIssues(data.error) });
  }
  return ok(data.data);
}
