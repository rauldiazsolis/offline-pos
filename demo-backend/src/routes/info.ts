import { sendJson } from '../http-helpers.ts';
import type { RouteDef } from '../router.ts';
import { backendContractVersion, getDemoSettings } from '../settings.ts';

/**
 * `GET /info` (contrato 4.0.0, #99): versión del contrato y estado. Nunca
 * responde 409 — es justamente cómo el POS se entera de que no son
 * compatibles. Mantenimiento y "contrato 3.0.0" se prenden desde el panel.
 */
export const infoRoutes: RouteDef[] = [
  {
    method: 'GET',
    pattern: /^\/info$/,
    requiresAuth: true,
    handler: (_req, res, ctx) => {
      const { maintenance } = getDemoSettings(ctx.db);
      const version = backendContractVersion(ctx.db);
      sendJson(res, 200, {
        contractVersion: version,
        status: maintenance.enabled ? 'maintenance' : 'ok',
        ...(maintenance.enabled && maintenance.message !== ''
          ? { message: maintenance.message }
          : {}),
        backend: { name: 'offline-pos-demo-backend', version },
      });
    },
  },
];
