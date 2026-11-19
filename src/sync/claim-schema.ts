import { z } from 'zod';

/**
 * Respuesta de `POST /claim` (contrato 4.7.0, capacidad `device-claim`, #230): la conexión de la
 * caja que vinculó el `claimToken`. Tolerante como todo schema de red (reglas de evolución): campos
 * desconocidos se ignoran y `company`/`register` mal formados cuentan como ausentes. La sucursal y
 * el punto de venta del `#connect=`, si los trae, ganan sobre los de acá (lo decide quien la usa).
 */
export const claimResponseSchema = z.object({
  apiKey: z.string().trim().min(1),
  branch: z.string(),
  pointOfSale: z.string(),
  company: z
    .object({ name: z.string().trim().min(1) })
    .optional()
    .catch(undefined),
  register: z
    .object({ name: z.string().trim().min(1) })
    .optional()
    .catch(undefined),
});

export type ClaimResponse = {
  apiKey: string;
  branch: string;
  pointOfSale: string;
  company?: { name: string };
  register?: { name: string };
};

/** Omite los opcionales ausentes (`exactOptionalPropertyTypes`). */
export function toClaimResponse(data: z.infer<typeof claimResponseSchema>): ClaimResponse {
  return {
    apiKey: data.apiKey,
    branch: data.branch,
    pointOfSale: data.pointOfSale,
    ...(data.company !== undefined ? { company: data.company } : {}),
    ...(data.register !== undefined ? { register: data.register } : {}),
  };
}

/** Los `code` del `ErrorBody` de `POST /claim` que el POS distingue; otro cuenta como desconocido. */
export const CLAIM_NOT_FOUND = 'claim-not-found';
export const CLAIM_EXPIRED = 'claim-expired';
export const CLAIM_USED = 'claim-used';
