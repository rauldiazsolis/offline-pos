import { z } from 'zod';
import { callBridge } from '../connectors/google-sheets/bridge-client.ts';
import { buildHeaders, failedResponse } from '../connectors/rest/rest-fetch-connector.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { toZodIssues } from '../domain/zod-issues.ts';
import type { ConnectorConfig } from './connector-registry.ts';
import { isAllowedBackendUrl } from './demo-link.ts';
import { errorBodySchema, readJson } from './http-body.ts';

/** Lo que devuelve `POST /portal-links` (4.6.0). Nunca se guarda: si lleva autorización, es un secreto. */
export type PortalLink = { url: string; expiresAt?: string };

const portalLinkSchema = z.object({
  url: z.url().refine(isAllowedBackendUrl, 'Tiene que ser https (o http a localhost)'),
  // Informativo: mal formado se ignora.
  expiresAt: z.string().optional().catch(undefined),
});

const toPortalLink = ({ url, expiresAt }: z.infer<typeof portalLinkSchema>): PortalLink => ({
  url,
  ...(expiresAt !== undefined ? { expiresAt } : {}),
});

/**
 * `POST /portal-links` (4.6.0, #179): el link que el backend decide para la key de esta terminal;
 * con el puente de Google Sheets, su acción `portalLink` (la URL de la planilla, #180). No pasa por
 * el puerto `Connector`. Adaptador HTTP: los únicos try/catch son `fetch` y `json()` (los del
 * puente, en `callBridge`). Sin reintentos. Un 404 es `portal/not-offered`; un 503,
 * `sync/backend-maintenance`; el resto, como en el conector REST (409 incompatible, o
 * `sync/request-failed` con su status).
 */
export async function requestPortalLink(config: ConnectorConfig): Promise<Result<PortalLink>> {
  if (config.type === 'google-sheets') {
    const link = await callBridge(config, { action: 'portalLink' }, portalLinkSchema);
    return link.ok ? ok(toPortalLink(link.value)) : link;
  }
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/portal-links`, {
      method: 'POST',
      headers: buildHeaders(config),
    });
  } catch (error) {
    return err('sync/request-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (response.status === 404) {
    return err('portal/not-offered', undefined);
  }
  if (response.status === 503) {
    const errorBody = errorBodySchema.safeParse(await readJson(response));
    const message = errorBody.success ? errorBody.data.message : undefined;
    return err('sync/backend-maintenance', message !== undefined ? { message } : {});
  }
  if (!response.ok) {
    return failedResponse(response);
  }
  const parsed = portalLinkSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
  }
  return ok(toPortalLink(parsed.data));
}
