import { sendJson } from '../http-helpers.ts';
import { resetToSeed } from '../seed.ts';
import type { RouteDef } from '../router.ts';

export const demoResetRoute: RouteDef[] = [
  {
    method: 'POST',
    pattern: /^\/_demo\/reset$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      resetToSeed(ctx.db, new Date().toISOString());
      sendJson(res, 200, { reset: true });
    },
  },
];
