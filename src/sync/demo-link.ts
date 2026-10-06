import { z } from 'zod';
import { err, ok, type Result } from '../domain/result.ts';
import { toZodIssues } from '../domain/zod-issues.ts';

/**
 * Links del onboarding de demo (#128), lectura pura: la entrada `?demo=true&backend=…&template=…`
 * y la vuelta con la config en el fragmento (`#connect=…`, nunca en la query string: el navegador
 * no manda el fragmento al servidor que sirve el POS). La vuelta es la del alta (REST) o la de
 * "Conectar el POS" desde una planilla de Google Sheets (#133). La orquestación está en
 * `ui/onboarding.ts`.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** `https:`, o `http:` solo a la máquina local (desarrollo y e2e). */
export function isAllowedBackendUrl(raw: string): boolean {
  if (!URL.canParse(raw)) {
    return false;
  }
  const url = new URL(raw);
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
}

export type DemoEntry = { backend: string; template?: string };

/** `undefined` = la URL no trae `demo=true`. */
export function readDemoEntry(href: string): Result<DemoEntry> | undefined {
  const params = new URL(href).searchParams;
  if (params.get('demo') !== 'true') {
    return undefined;
  }
  const raw = params.get('backend')?.trim() ?? '';
  if (raw === '') {
    return err('demo/invalid-link', { reason: 'backend-missing' });
  }
  if (!URL.canParse(raw) || !/^https?:$/.test(new URL(raw).protocol)) {
    return err('demo/invalid-link', { reason: 'backend-invalid' });
  }
  if (!isAllowedBackendUrl(raw)) {
    return err('demo/invalid-link', { reason: 'backend-insecure' });
  }
  const template = params.get('template')?.trim();
  return ok({
    backend: raw.replace(/\/+$/, ''),
    ...(template !== undefined && template !== '' ? { template } : {}),
  });
}

const allowedUrl = z.url().refine(isAllowedBackendUrl, 'Tiene que ser https (o http a localhost)');

// La vuelta del alta (REST, #128): sin `type` o con `type: 'rest'`.
const restReturnSchema = z.object({
  type: z.literal('rest').optional(),
  baseUrl: allowedUrl,
  apiKey: z.string().min(1),
  branch: z.string().min(1),
  pointOfSale: z.string().min(1),
  wipeKey: z.string().min(1).optional(),
});

// "Conectar el POS" desde una planilla (#133): la URL del Web App y, opcionales, la sucursal y la
// caja que eligió el comercio en la página del puente. Nunca trae el secreto: la página es pública.
// Una sucursal o caja vacía cuenta como ausente (la página arma el link con lo que haya tipeado).
const sheetsReturnSchema = z.object({
  type: z.literal('google-sheets'),
  webAppUrl: z
    .string()
    .refine(
      (raw) => URL.canParse(raw) && new URL(raw).protocol === 'https:',
      'Tiene que ser https',
    ),
  branch: z.string().optional(),
  pointOfSale: z.string().optional(),
});

const connectReturnSchema = z.union([sheetsReturnSchema, restReturnSchema]);

export type ConnectReturn =
  | {
      type: 'rest';
      baseUrl: string;
      apiKey: string;
      branch: string;
      pointOfSale: string;
      wipeKey?: string;
    }
  | { type: 'google-sheets'; webAppUrl: string; branch?: string; pointOfSale?: string };

/** base64url → JSON: el único borde que lanza (`atob`, `JSON.parse`). */
function decodeBase64UrlJson(value: string): unknown {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** `undefined` = la URL no trae `#connect=`. */
export function readConnectReturn(href: string): Result<ConnectReturn> | undefined {
  const hash = new URL(href).hash.replace(/^#/, '');
  const encoded = new URLSearchParams(hash).get('connect');
  if (encoded === null) {
    return undefined;
  }
  const parsed = connectReturnSchema.safeParse(decodeBase64UrlJson(encoded));
  if (!parsed.success) {
    return err('demo/invalid-return', { issues: toZodIssues(parsed.error) });
  }
  const data = parsed.data;
  if (data.type === 'google-sheets') {
    const branch = data.branch?.trim() ?? '';
    const pointOfSale = data.pointOfSale?.trim() ?? '';
    return ok({
      type: 'google-sheets',
      webAppUrl: data.webAppUrl,
      ...(branch !== '' ? { branch } : {}),
      ...(pointOfSale !== '' ? { pointOfSale } : {}),
    });
  }
  const { baseUrl, apiKey, branch, pointOfSale, wipeKey } = data;
  return ok({
    type: 'rest',
    baseUrl,
    apiKey,
    branch,
    pointOfSale,
    ...(wipeKey !== undefined ? { wipeKey } : {}),
  });
}

/** La ida al alta: conserva la query propia de `onboardingUrl`. */
export function buildOnboardingUrl(
  onboardingUrl: string,
  returnUrl: string,
  wipeKey: string,
): string {
  const url = new URL(onboardingUrl);
  url.searchParams.set('return_url', returnUrl);
  url.searchParams.set('wipe_key', wipeKey);
  return url.toString();
}

/** `origin + pathname`: nada fijo en el código, anda en una subruta. */
export function returnUrlFor(href: string): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}`;
}

/** El link de demo para `/DEMO_NUEVA` (#176): la misma carpeta del POS, sin query ni fragmento. */
export function buildDemoLink(href: string, backend: string, template?: string): string {
  const url = new URL(returnUrlFor(href));
  url.searchParams.set('demo', 'true');
  url.searchParams.set('backend', backend);
  if (template !== undefined) {
    url.searchParams.set('template', template);
  }
  return url.toString();
}

const ONBOARDING_PARAMS = ['demo', 'backend', 'template'];

/** ¿La URL trae un link de demo o la vuelta del alta? En entrenamiento no se procesan (#177). */
export function hasOnboardingParams(href: string): boolean {
  const url = new URL(href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  return ONBOARDING_PARAMS.some((name) => url.searchParams.has(name)) || hashParams.has('connect');
}

/** Ruta relativa (para `history.replaceState`) sin lo del onboarding; el resto queda igual. */
export function stripOnboardingParams(href: string): string {
  const url = new URL(href);
  for (const name of ONBOARDING_PARAMS) {
    url.searchParams.delete(name);
  }
  const search = url.searchParams.toString();
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  hashParams.delete('connect');
  const hash = hashParams.toString();
  return `${url.pathname}${search !== '' ? `?${search}` : ''}${hash !== '' ? `#${hash}` : ''}`;
}
