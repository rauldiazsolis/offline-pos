import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import {
  CLAIM_TOKEN_TTL_MS,
  ensureRegister,
  isRevokedDevice,
  issueClaimToken,
  redeemClaimToken,
  registerForKey,
} from '../src/device-claim.ts';

const NOW = new Date('2026-11-19T12:00:00.000Z');

function later(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

describe('cajas y vinculación por dispositivo (4.7.0, #230)', () => {
  it('una caja por sucursal y punto de venta, con su key propia', () => {
    const db = openDb(':memory:');
    const first = ensureRegister(db, { branch: 'CENTRAL', pointOfSale: 'Caja 1' }, NOW);
    const again = ensureRegister(db, { branch: 'CENTRAL', pointOfSale: 'Caja 1' }, NOW);
    const other = ensureRegister(db, { branch: 'CENTRAL', pointOfSale: 'Caja 2' }, NOW);

    expect(again.id).toBe(first.id);
    expect(again.apiKey).toBe(first.apiKey);
    expect(first.apiKey).toMatch(/^reg-/);
    expect(first.name).toBe('Caja 1');
    expect(other.apiKey).not.toBe(first.apiKey);
    expect(registerForKey(db, first.apiKey)?.id).toBe(first.id);
    expect(registerForKey(db, 'demo-api-key')).toBeUndefined();
  });

  it('el nombre, si viene, se guarda', () => {
    const db = openDb(':memory:');
    ensureRegister(db, { branch: 'CENTRAL', pointOfSale: 'Caja 1' }, NOW);
    const renamed = ensureRegister(
      db,
      { branch: 'CENTRAL', pointOfSale: 'Caja 1', name: 'Mostrador' },
      NOW,
    );
    expect(renamed.name).toBe('Mostrador');
  });

  it('emite un token de un solo uso que vence a los 10 minutos', () => {
    const db = openDb(':memory:');
    const issued = issueClaimToken(db, { branch: 'CENTRAL', pointOfSale: 'Caja 1' }, NOW);
    expect(issued.claimToken).toMatch(/^claim-/);
    expect(issued.expiresAt).toBe(later(CLAIM_TOKEN_TTL_MS).toISOString());
    expect(CLAIM_TOKEN_TTL_MS).toBe(10 * 60_000);
  });

  it('canjear vincula la caja al dispositivo; repetirlo desde el mismo devuelve lo mismo', () => {
    const db = openDb(':memory:');
    const { claimToken, register } = issueClaimToken(
      db,
      { branch: 'CENTRAL', pointOfSale: 'Caja 1' },
      NOW,
    );

    const first = redeemClaimToken(db, claimToken, 'dev-a', later(1000));
    const second = redeemClaimToken(db, claimToken, 'dev-a', later(2000));

    expect(first).toEqual({ ok: true, register: { ...register, activeDeviceId: 'dev-a' } });
    expect(second).toEqual(first);
    expect(registerForKey(db, register.apiKey)?.activeDeviceId).toBe('dev-a');
  });

  it('desde otro dispositivo, claim-used; vencido, claim-expired; desconocido, claim-not-found', () => {
    const db = openDb(':memory:');
    const { claimToken } = issueClaimToken(db, { branch: 'CENTRAL', pointOfSale: 'Caja 1' }, NOW);
    const { claimToken: expiring } = issueClaimToken(
      db,
      { branch: 'CENTRAL', pointOfSale: 'Caja 2' },
      NOW,
    );
    redeemClaimToken(db, claimToken, 'dev-a', NOW);

    expect(redeemClaimToken(db, claimToken, 'dev-b', NOW)).toEqual({
      ok: false,
      code: 'claim-used',
    });
    expect(redeemClaimToken(db, expiring, 'dev-a', later(CLAIM_TOKEN_TTL_MS))).toEqual({
      ok: false,
      code: 'claim-expired',
    });
    expect(redeemClaimToken(db, 'claim-nada', 'dev-a', NOW)).toEqual({
      ok: false,
      code: 'claim-not-found',
    });
  });

  it('el mismo dispositivo con el token ya vencido recibe claim-expired', () => {
    const db = openDb(':memory:');
    const { claimToken } = issueClaimToken(db, { branch: 'CENTRAL', pointOfSale: 'Caja 1' }, NOW);
    redeemClaimToken(db, claimToken, 'dev-a', NOW);
    expect(redeemClaimToken(db, claimToken, 'dev-a', later(CLAIM_TOKEN_TTL_MS))).toEqual({
      ok: false,
      code: 'claim-expired',
    });
  });

  it('un token nuevo canjeado desde otro dispositivo revoca al anterior, sin rotar la key', () => {
    const db = openDb(':memory:');
    const target = { branch: 'CENTRAL', pointOfSale: 'Caja 1' };
    const first = issueClaimToken(db, target, NOW);
    redeemClaimToken(db, first.claimToken, 'dev-a', NOW);
    const second = issueClaimToken(db, target, NOW);
    redeemClaimToken(db, second.claimToken, 'dev-b', NOW);

    const key = first.register.apiKey;
    expect(registerForKey(db, key)?.apiKey).toBe(key);
    expect(isRevokedDevice(db, key, 'dev-a')).toBe(true);
    expect(isRevokedDevice(db, key, 'dev-b')).toBe(false);
    // Sin el header (un POS 4.6) no se valida.
    expect(isRevokedDevice(db, key, undefined)).toBe(false);
    // Una key que no es de ninguna caja, nunca.
    expect(isRevokedDevice(db, 'demo-api-key', 'dev-a')).toBe(false);
  });

  it('una caja sin dispositivo vinculado acepta a cualquiera', () => {
    const db = openDb(':memory:');
    const register = ensureRegister(db, { branch: 'CENTRAL', pointOfSale: 'Caja 1' }, NOW);
    expect(isRevokedDevice(db, register.apiKey, 'dev-a')).toBe(false);
  });
});
