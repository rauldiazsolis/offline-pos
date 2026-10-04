import { z } from 'zod';

/** Cuerpo de error del contrato (4.6.0): `{ code, message? }`. */
export const errorBodySchema = z.object({ code: z.string(), message: z.string().optional() });

/** Cuerpo JSON de la respuesta, o `undefined` si no es JSON (borde: `json()` lanza). */
export async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}
