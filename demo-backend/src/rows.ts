import type { SQLOutputValue } from 'node:sqlite';

/**
 * Lectura tipada de las filas de `node:sqlite` sin casts (4.7.0, #230): una fila es un
 * `Record<string, SQLOutputValue>` y cada columna se lee con su guarda. Una columna con otro tipo es
 * una invariante rota (el schema la declara así): se lanza y el router responde 500.
 */
export type Row = Record<string, SQLOutputValue>;

export function readString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new Error(`La columna ${column} no es texto`);
  }
  return value;
}

/** Una columna de texto que admite `NULL`: `undefined` si es `NULL`. */
export function readOptionalString(row: Row, column: string): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`La columna ${column} no es texto`);
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parsea el `payload` JSON de una fila; un payload que no es un objeto cuenta como vacío. */
export function readPayload(row: Row, column = 'payload'): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readString(row, column));
  return isRecord(parsed) ? parsed : {};
}
