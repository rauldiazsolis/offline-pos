import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readJsonBody, sendJson } from '../http-helpers.ts';
import { issueDemoKey, revokeDemoKeys } from '../demo-keys.ts';
import type { RouteDef } from '../router.ts';
import { DEFAULT_TEMPLATE, isTemplateName, resetToSeed, TEMPLATES } from '../seed.ts';

const onboardingHtmlPath = fileURLToPath(new URL('../onboarding.html', import.meta.url));
const onboardingHtml = readFileSync(onboardingHtmlPath, 'utf-8');

/** Sucursal y punto de venta de una demo. La key es propia de cada demo (#176). */
const DEMO_TERMINAL = { branch: 'CENTRAL', pointOfSale: 'Caja 1' };
/**
 * La conexión que devuelve la página falsa de alta: la del comercio "real" que nace del alta, con
 * la key fija (el minibackend acepta cualquier token no revocado), que nunca se revoca.
 */
const DEMO_CONNECTION = { apiKey: 'demo-api-key', ...DEMO_TERMINAL };

function requestOrigin(req: IncomingMessage): string {
  return `http://${req.headers.host ?? 'localhost:4000'}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Página falsa de alta (4.4.0, #128): muestra lo que recibió y ofrece volver al POS con la
 * conexión en el fragmento `#connect=` (base64url de JSON), con el `wipe_key` o sin él (para probar
 * el camino del wizard en el POS).
 */
function renderOnboardingPage(url: URL, origin: string): string {
  const returnUrl = url.searchParams.get('return_url');
  const wipeKey = url.searchParams.get('wipe_key');
  const received = `<dl><dt>return_url</dt><dd>${escapeHtml(returnUrl ?? '(no vino)')}</dd><dt>wipe_key</dt><dd>${escapeHtml(wipeKey ?? '(no vino)')}</dd></dl>`;
  if (returnUrl === null || returnUrl === '') {
    return onboardingHtml.replace('{{content}}', `${received}<p>Falta return_url.</p>`);
  }
  const connect = (withKey: boolean): string =>
    Buffer.from(
      JSON.stringify({
        baseUrl: origin,
        ...DEMO_CONNECTION,
        ...(withKey && wipeKey !== null && wipeKey !== '' ? { wipeKey } : {}),
      }),
    ).toString('base64url');
  const link = (withKey: boolean, label: string): string =>
    `<a href="${escapeHtml(`${returnUrl}#connect=${connect(withKey)}`)}">${label}</a>`;
  return onboardingHtml.replace(
    '{{content}}',
    `${received}<p class="actions">${link(true, 'Crear comercio y volver al POS')}${link(false, 'Volver sin wipe_key')}</p>`,
  );
}

export const demoSessionRoutes: RouteDef[] = [
  {
    // `POST /demo-sessions` (4.4.0, #128): el único endpoint sin autenticación del contrato.
    method: 'POST',
    pattern: /^\/demo-sessions$/,
    requiresAuth: false,
    checksContract: true,
    handler: async (req, res, ctx) => {
      const body = (await readJsonBody(req)) as { template?: unknown } | undefined;
      const requested = typeof body?.template === 'string' ? body.template : DEFAULT_TEMPLATE;
      if (!isTemplateName(requested)) {
        sendJson(res, 422, { code: 'unknown-template', templates: Object.keys(TEMPLATES) });
        return;
      }
      const now = new Date().toISOString();
      // Base única, de un solo comercio: cada demo pisa la anterior. Las keys no se re-siembran.
      resetToSeed(ctx.db, now, requested);
      sendJson(res, 201, {
        apiKey: issueDemoKey(ctx.db, now),
        ...DEMO_TERMINAL,
        template: requested,
        onboarding: { url: `${requestOrigin(req)}/_demo/onboarding`, label: 'Crear mi comercio' },
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/onboarding$/,
    requiresAuth: false,
    handler: (req, res, ctx) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderOnboardingPage(ctx.url, requestOrigin(req)));
    },
  },
  {
    // Panel (#176): revoca las keys de todas las demos, como el reinicio total de mini.
    method: 'POST',
    pattern: /^\/_demo\/revoke-demos$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(res, 200, { revoked: revokeDemoKeys(ctx.db, new Date().toISOString()) });
    },
  },
];
