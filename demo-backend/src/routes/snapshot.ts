import { buildCashSnapshot } from '../cash-snapshot.ts';
import { registerForKey } from '../device-claim.ts';
import { sendJson } from '../http-helpers.ts';
import type { RouteDef } from '../router.ts';
import { getDemoSettings } from '../settings.ts';

export const snapshotRoutes: RouteDef[] = [
  {
    // `GET /snapshot` (4.7.0, #230): la foto de la caja de la key, para retomarla en otro equipo.
    method: 'GET',
    pattern: /^\/snapshot$/,
    requiresAuth: true,
    checksContract: true,
    checksDevice: true,
    closedInMaintenance: true,
    isEnabled: (db) => getDemoSettings(db).cashSnapshot,
    handler: (_req, res, ctx) => {
      const register = registerForKey(ctx.db, ctx.token);
      if (register === undefined) {
        // Una key sin caja (la fija, la de una demo, la del alta): el POS lo toma como "sin foto".
        sendJson(res, 404, {
          code: 'snapshot-not-available',
          message: 'Esta key no es de una caja: no hay foto para retomar.',
        });
        return;
      }
      sendJson(res, 200, buildCashSnapshot(ctx.db, register, new Date()));
    },
  },
];
