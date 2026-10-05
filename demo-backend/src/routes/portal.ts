import type { DatabaseSync } from 'node:sqlite';
import { isDemoKey, isRevokedKey } from '../demo-keys.ts';
import { escapeHtml, requestOrigin, sendJson } from '../http-helpers.ts';
import { issuePortalLink, redeemPortalLink } from '../portal-links.ts';
import type { RouteDef } from '../router.ts';
import { DEMO_TERMINAL } from './demo-sessions.ts';
import { companyFor } from './info.ts';

type Page = { status: number; html: string };

function page(status: number, content: string): Page {
  return {
    status,
    html: `<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>Portal del minibackend</title></head><body><h1>Portal del minibackend</h1>${content}</body></html>`,
  };
}

/**
 * El canje (4.6.0, #178): el minibackend no tiene sesiones (su panel no tiene login), así que
 * muestra con qué caja se entró. La sesión real limitada a la caja es de mini.
 */
function renderRedeem(db: DatabaseSync, token: string): Page {
  const apiKey = redeemPortalLink(db, token, new Date());
  if (apiKey === undefined || isRevokedKey(db, apiKey)) {
    return page(410, '<p>El link ya se usó o venció. Pedí otro desde el POS.</p>');
  }
  const company = companyFor(db, apiKey);
  const origin = isDemoKey(db, apiKey) ? 'de una demo' : 'del comercio';
  return page(
    200,
    `<p>Entraste como ${escapeHtml(DEMO_TERMINAL.pointOfSale)} de ${escapeHtml(DEMO_TERMINAL.branch)}` +
      `${company !== undefined ? ` (${escapeHtml(company.name)})` : ''}, ${origin}.</p>` +
      '<p><a href="/_demo">Ir al panel</a></p>',
  );
}

export const portalRoutes: RouteDef[] = [
  {
    // `POST /portal-links` (4.6.0, #178): un link de un solo uso para la key que lo pide.
    method: 'POST',
    pattern: /^\/portal-links$/,
    requiresAuth: true,
    checksContract: true,
    closedInMaintenance: true,
    handler: (req, res, ctx) => {
      const { token, expiresAt } = issuePortalLink(ctx.db, ctx.token ?? '', new Date());
      sendJson(res, 201, { url: `${requestOrigin(req)}/_demo/portal/${token}`, expiresAt });
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/portal\/(?<token>[^/]+)$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      const { status, html } = renderRedeem(ctx.db, ctx.params.token ?? '');
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    },
  },
];
