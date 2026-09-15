import type { DatabaseSync } from 'node:sqlite';

export type IdempotentResponse = { status: number; body: unknown };

/**
 * Si `key` ya se procesó antes, devuelve la respuesta ya grabada sin volver
 * a ejecutar `handler` — el contrato exige que todo POST de evento sea
 * idempotente (RNF-07). Si es la primera vez, corre `handler` y graba su
 * resultado antes de devolverlo.
 */
export async function withIdempotency(
  db: DatabaseSync,
  key: string,
  handler: () => Promise<IdempotentResponse> | IdempotentResponse,
): Promise<IdempotentResponse> {
  const existing = db
    .prepare('SELECT status, body FROM idempotency_keys WHERE key = ?')
    .get(key) as { status: number; body: string } | undefined;
  if (existing !== undefined) {
    return { status: existing.status, body: JSON.parse(existing.body) as unknown };
  }

  const response = await handler();
  db.prepare(
    'INSERT INTO idempotency_keys (key, status, body, created_at) VALUES (?, ?, ?, ?)',
  ).run(key, response.status, JSON.stringify(response.body), new Date().toISOString());
  return response;
}
