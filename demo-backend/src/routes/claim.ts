import type { IncomingMessage } from 'node:http';
import { issueClaimToken, redeemClaimToken, type ClaimErrorCode } from '../device-claim.ts';
import { readJsonBody, requestOrigin, sendJson } from '../http-helpers.ts';
import type { RouteDef } from '../router.ts';
import { isRecord } from '../rows.ts';
import { getDemoSettings } from '../settings.ts';
import { companyFor } from './info.ts';

/** El body como objeto, o `undefined` si no vino, no es JSON o no es un objeto. */
async function readBodyObject(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const body = await readJsonBody(req);
    return isRecord(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Los mensajes del claim (4.7.0, #230), para que el POS se los muestre al operador. */
const CLAIM_MESSAGES: Record<ClaimErrorCode, string> = {
  'claim-not-found': 'El código para vincular la caja no existe. Pedí uno nuevo.',
  'claim-expired': 'El código para vincular la caja venció. Pedí uno nuevo.',
  'claim-used': 'El código para vincular la caja ya se usó en otro dispositivo. Pedí uno nuevo.',
};

const CLAIM_STATUS: Record<ClaimErrorCode, number> = {
  'claim-not-found': 404,
  'claim-expired': 410,
  'claim-used': 410,
};

export const claimRoutes: RouteDef[] = [
  {
    // El "admin" del backend de referencia (no es del contrato, 4.7.0, #230): emite el código de un
    // solo uso para una caja, creándola si no existe, con el fragmento listo para `#connect=`.
    method: 'POST',
    pattern: /^\/_demo\/claim-tokens$/,
    requiresAuth: false,
    handler: async (req, res, ctx) => {
      const body = await readBodyObject(req);
      const branch = nonEmptyString(body?.branch);
      const pointOfSale = nonEmptyString(body?.pointOfSale);
      if (branch === undefined || pointOfSale === undefined) {
        sendJson(res, 400, {
          error: 'Faltan la sucursal (branch) o el punto de venta (pointOfSale)',
        });
        return;
      }
      const { claimToken, expiresAt } = issueClaimToken(
        ctx.db,
        { branch, pointOfSale, name: nonEmptyString(body?.name) },
        new Date(),
      );
      const connect = Buffer.from(
        JSON.stringify({ baseUrl: requestOrigin(req), claimToken, branch, pointOfSale }),
      ).toString('base64url');
      sendJson(res, 201, { claimToken, expiresAt, connect });
    },
  },
  {
    // `POST /claim` (4.7.0, #230): sin key (el token es la credencial), con `X-Device-Id`.
    method: 'POST',
    pattern: /^\/claim$/,
    requiresAuth: false,
    checksContract: true,
    closedInMaintenance: true,
    isEnabled: (db) => getDemoSettings(db).deviceClaim,
    handler: async (req, res, ctx) => {
      const header = req.headers['x-device-id'];
      const deviceId = typeof header === 'string' ? nonEmptyString(header) : undefined;
      const body = await readBodyObject(req);
      const claimToken = nonEmptyString(body?.claimToken);
      if (deviceId === undefined || claimToken === undefined) {
        sendJson(res, 400, {
          code: 'invalid-request',
          message:
            deviceId === undefined
              ? 'Falta el header X-Device-Id'
              : 'Falta el código para vincular la caja (claimToken)',
        });
        return;
      }
      const result = redeemClaimToken(ctx.db, claimToken, deviceId, new Date());
      if (!result.ok) {
        sendJson(res, CLAIM_STATUS[result.code], {
          code: result.code,
          message: CLAIM_MESSAGES[result.code],
        });
        return;
      }
      // La key de la caja no se rota al vincularla a otro dispositivo: así el anterior, que la
      // sigue mandando, recibe `409 device-revoked` (su `X-Device-Id` ya no es el activo) y el POS
      // le puede explicar qué pasó, en vez de un `401` genérico que no distingue nada.
      const { register } = result;
      const company = companyFor(ctx.db, register.apiKey);
      sendJson(res, 200, {
        apiKey: register.apiKey,
        branch: register.branch,
        pointOfSale: register.pointOfSale,
        register: { name: register.name },
        ...(company !== undefined ? { company } : {}),
      });
    },
  },
];
