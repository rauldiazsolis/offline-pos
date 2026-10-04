import type { DatabaseSync } from 'node:sqlite';
import { isDemoKey } from '../demo-keys.ts';
import { sendJson } from '../http-helpers.ts';
import type { RouteDef } from '../router.ts';
import { DEFAULT_TEMPLATE, DEMO_COMPANY_NAMES, isTemplateName } from '../seed.ts';
import {
  backendContractVersion,
  CAPABILITIES,
  getCompanyName,
  getDemoSettings,
  getDemoTemplate,
  PORTAL,
} from '../settings.ts';

/**
 * La empresa de la key (4.5.0, #193): la de la demo, o la que se cargó en el alta. También la usa
 * el canje del portal (4.6.0, #178).
 */
export function companyFor(
  db: DatabaseSync,
  key: string | undefined,
): { name: string } | undefined {
  if (isDemoKey(db, key)) {
    const template = getDemoTemplate(db);
    return {
      name: DEMO_COMPANY_NAMES[
        template !== undefined && isTemplateName(template) ? template : DEFAULT_TEMPLATE
      ],
    };
  }
  const name = getCompanyName(db);
  return name === undefined ? undefined : { name };
}

/**
 * `GET /info` (contrato 4.0.0, #99): versión del contrato y estado. Nunca
 * responde 409 — es justamente cómo el POS se entera de que no son
 * compatibles. Mantenimiento y "contrato 3.0.0" se prenden desde el panel. 4.4.0 (#128): también
 * informa sus capacidades. 4.5.0 (#193): también la empresa. 4.6.0 (#178): también el portal.
 */
export const infoRoutes: RouteDef[] = [
  {
    method: 'GET',
    pattern: /^\/info$/,
    requiresAuth: true,
    handler: (_req, res, ctx) => {
      const { maintenance } = getDemoSettings(ctx.db);
      const version = backendContractVersion(ctx.db);
      const company = companyFor(ctx.db, ctx.token);
      sendJson(res, 200, {
        contractVersion: version,
        status: maintenance.enabled ? 'maintenance' : 'ok',
        ...(maintenance.enabled && maintenance.message !== ''
          ? { message: maintenance.message }
          : {}),
        backend: { name: 'offline-pos-demo-backend', version },
        capabilities: CAPABILITIES,
        portal: PORTAL,
        ...(company !== undefined ? { company } : {}),
      });
    },
  },
];
