import { z } from 'zod';
import { POS_CONTRACT_VERSION } from '../domain/contract-version.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { toZodIssues } from '../domain/zod-issues.ts';
import { CONTRACT_VERSION_HEADER } from './connector.ts';
import { isAllowedBackendUrl } from './demo-link.ts';
import { errorBodySchema, readJson } from './http-body.ts';

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

/** `Retry-After` en segundos enteros (4.6.0); una fecha HTTP o un valor inválido cuentan como ausente. */
export function parseRetryAfter(value: string | null): number | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

/**
 * `POST /demo-sessions` (4.4.0, #128). No pasa por el puerto `Connector`: no es sync y solo existe
 * en backends REST. Sin API key (todavía no hay). Adaptador HTTP: los únicos try/catch son `fetch`
 * y `json()`. 4.6.0 (#173): un 429 es `demo/rate-limited` (con los segundos de `Retry-After`), un
 * 503 `demo-capacity` es `demo/capacity` y cualquier otro 503, `sync/backend-maintenance`.
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
  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers.get('Retry-After'));
    return err('demo/rate-limited', retryAfterSeconds !== undefined ? { retryAfterSeconds } : {});
  }
  if (response.status === 503) {
    const errorBody = errorBodySchema.safeParse(body);
    if (errorBody.success && errorBody.data.code === 'demo-capacity') {
      return err('demo/capacity', undefined);
    }
    // Mantenimiento, otro código o sin cuerpo: el backend no puede atender ahora (4.6.0).
    const message = errorBody.success ? errorBody.data.message : undefined;
    return err('sync/backend-maintenance', message !== undefined ? { message } : {});
  }
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
