import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { issuePortalLink, PORTAL_LINK_TTL_MS, redeemPortalLink } from '../src/portal-links.ts';

const NOW = new Date('2026-10-04T12:00:00.000Z');

describe('links del portal (4.6.0, #178)', () => {
  it('emite un token que vence a los 60 s y se canjea una sola vez', () => {
    const db = openDb(':memory:');
    const { token, expiresAt } = issuePortalLink(db, 'k1', NOW);

    expect(expiresAt).toBe(new Date(NOW.getTime() + PORTAL_LINK_TTL_MS).toISOString());
    expect(token).not.toContain('k1');
    expect(redeemPortalLink(db, token, NOW)).toBe('k1');
    expect(redeemPortalLink(db, token, NOW)).toBeUndefined();
  });

  it('vencido o inexistente no se canjea', () => {
    const db = openDb(':memory:');
    const { token } = issuePortalLink(db, 'k1', NOW);
    expect(
      redeemPortalLink(db, token, new Date(NOW.getTime() + PORTAL_LINK_TTL_MS)),
    ).toBeUndefined();
    expect(redeemPortalLink(db, 'nope', NOW)).toBeUndefined();
  });
});
