import { z } from 'zod';
import { POS_CONTRACT_VERSION } from '../domain/contract-version.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { toZodIssues } from '../domain/zod-issues.ts';
import { CONTRACT_VERSION_HEADER } from './connector.ts';
import { isAllowedBackendUrl } from './demo-link.ts';

/** Lo que devuelve `POST /demo-sessions` (4.4.0, #128). `baseUrl` ausente = la misma del link. */
export type DemoSession = {
  apiKey: string;
  branch: string;
  pointOfSale: string;
  template: string;
  onboarding: { url: string; label: string };
  baseUrl?: string;
};

const INSECURE_URL = 'Tiene que ser https (o http a localhost)';

const demoSessionSchema = z.object({
  apiKey: z.string().min(1),
  branch: z.string().min(1),
  pointOfSale: z.string().min(1),
  template: z.string(),
  onboarding: z.object({
    url: z.url().refine(isAllowedBackendUrl, INSECURE_URL),
    label: z.string().min(1),
  }),
  baseUrl: z.url().refine(isAllowedBackendUrl, INSECURE_URL).optional(),
});

const unknownTemplateSchema = z.object({
  code: z.literal('unknown-template'),
  templates: z.array(z.string()),
});

/** Cuerpo JSON de la respuesta, o `undefined` si no es JSON (borde: `json()` lanza). */
async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * `POST /demo-sessions` (4.4.0, #128). No pasa por el puerto `Connector`: no es sync y solo existe
 * en backends REST. Sin API key (todavía no hay). Adaptador HTTP: los únicos try/catch son `fetch`
 * y `json()`.
 */
export async function requestDemoSession(
  backend: string,
  template?: string,
): Promise<Result<DemoSession>> {
  let response: Response;
  try {
    response = await fetch(`${backend}/demo-sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CONTRACT_VERSION_HEADER]: POS_CONTRACT_VERSION,
      },
      body: JSON.stringify(template !== undefined ? { template } : {}),
    });
  } catch (error) {
    return err('sync/request-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (response.status === 404) {
    return err('demo/not-offered', undefined);
  }
  const body = await readJson(response);
  if (response.status === 422) {
    const unknownTemplate = unknownTemplateSchema.safeParse(body);
    if (unknownTemplate.success) {
      return err('demo/unknown-template', {
        template: template ?? '',
        templates: unknownTemplate.data.templates,
      });
    }
  }
  if (!response.ok) {
    return err('sync/request-failed', { status: response.status, message: response.statusText });
  }
  const parsed = demoSessionSchema.safeParse(body);
  if (!parsed.success) {
    return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
  }
  const { baseUrl, ...session } = parsed.data;
  return ok({ ...session, ...(baseUrl !== undefined ? { baseUrl } : {}) });
}
