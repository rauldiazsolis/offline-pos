/**
 * Lectura de respuestas JSON en los tests sin casts (4.7.0, #230): el cuerpo queda `unknown` y los
 * campos se sacan con guardas.
 */
export async function readJson(response: Response): Promise<unknown> {
  const value: unknown = await response.json();
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** El campo `key` de un objeto, que tiene que ser un string (si no, el test falla acá). */
export function stringField(value: unknown, key: string): string {
  const field = isRecord(value) ? value[key] : undefined;
  if (typeof field !== 'string') {
    throw new Error(`Se esperaba un string en ${key}: ${JSON.stringify(value)}`);
  }
  return field;
}

/** El campo `key` de un objeto, que tiene que ser una lista. */
export function arrayField(value: unknown, key: string): unknown[] {
  const field = isRecord(value) ? value[key] : undefined;
  if (!Array.isArray(field)) {
    throw new Error(`Se esperaba una lista en ${key}: ${JSON.stringify(value)}`);
  }
  return field;
}
