import { z } from 'zod';
import { err, ok, type Result } from '../domain/result.ts';
import { toZodIssues } from '../domain/zod-issues.ts';

/**
 * Links del onboarding de demo (#128), lectura pura: la entrada `?demo=true&backend=…&template=…`
 * y la vuelta del alta con la config en el fragmento (`#connect=…`, nunca en la query string: el
 * navegador no manda el fragmento al servidor que sirve el POS). La orquestación está en
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

const connectReturnSchema = z.object({
  baseUrl: allowedUrl,
  apiKey: z.string().min(1),
  branch: z.string().min(1),
  pointOfSale: z.string().min(1),
  wipeKey: z.string().min(1).optional(),
});

export type ConnectReturn = {
  baseUrl: string;
  apiKey: string;
  branch: string;
  pointOfSale: string;
  wipeKey?: string;
};

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
  const { wipeKey, ...connection } = parsed.data;
  return ok({ ...connection, ...(wipeKey !== undefined ? { wipeKey } : {}) });
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
