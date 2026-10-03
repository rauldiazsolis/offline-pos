import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Keys de las demos (#176): cada `POST /demo-sessions` emite una propia, y el panel las puede revocar
 * (lo que en mini hacen el reinicio total o las 24 h sin uso). Una key revocada da 401; cualquier otra
 * se sigue aceptando (la fija `demo-api-key` de los e2e y de quien lo configure a mano). Viven fuera de
 * lo que re-siembra `resetToSeed`.
 */
export function issueDemoKey(db: DatabaseSync, now: string): string {
  const key = `demo-${randomUUID()}`;
  db.prepare('INSERT INTO demo_keys (key, created_at) VALUES (?, ?)').run(key, now);
  return key;
}

/** Revoca todas las keys emitidas que todavía no lo estaban; devuelve cuántas. */
export function revokeDemoKeys(db: DatabaseSync, now: string): number {
  const result = db
    .prepare('UPDATE demo_keys SET revoked_at = ? WHERE revoked_at IS NULL')
    .run(now);
  return Number(result.changes);
}

export function isRevokedKey(db: DatabaseSync, key: string | undefined): boolean {
  if (key === undefined) {
    return false;
  }
  const row = db
    .prepare('SELECT 1 AS revoked FROM demo_keys WHERE key = ? AND revoked_at IS NOT NULL')
    .get(key);
  return row !== undefined;
}
