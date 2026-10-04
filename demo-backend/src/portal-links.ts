import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Vencimiento del link del portal (4.6.0, #178): el que recomienda el contrato y usa mini. */
export const PORTAL_LINK_TTL_MS = 60_000;

/**
 * Emite un link de un solo uso para la key que lo pide (4.6.0, #178). El token es aleatorio y
 * opaco: la key nunca viaja en la URL.
 */
export function issuePortalLink(
  db: DatabaseSync,
  apiKey: string,
  now: Date,
): { token: string; expiresAt: string } {
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(now.getTime() + PORTAL_LINK_TTL_MS).toISOString();
  db.prepare(
    'INSERT INTO portal_links (token, api_key, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(token, apiKey, now.toISOString(), expiresAt);
  return { token, expiresAt };
}

/** Canjea el link: la key que lo pidió, o `undefined` si no existe, ya se usó o venció. */
export function redeemPortalLink(db: DatabaseSync, token: string, now: Date): string | undefined {
  const nowIso = now.toISOString();
  const row = db
    .prepare(
      'SELECT api_key AS apiKey FROM portal_links WHERE token = ? AND used_at IS NULL AND expires_at > ?',
    )
    .get(token, nowIso) as { apiKey: string } | undefined;
  if (row === undefined) {
    return undefined;
  }
  db.prepare('UPDATE portal_links SET used_at = ? WHERE token = ?').run(nowIso, token);
  return row.apiKey;
}
