import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { readOptionalString, readString, type Row } from './rows.ts';

/**
 * Vinculación por dispositivo (4.7.0, #230, capacidad `device-claim`): cada caja (sucursal + punto
 * de venta) tiene su API key y, a lo sumo, un dispositivo activo. El backend emite un `claimToken` de
 * un solo uso; quien lo canjea con `POST /claim` queda como el dispositivo de la caja y el anterior,
 * revocado. Funciones puras sobre `db` y un `now` inyectado: se testean sin HTTP.
 */

/** Vencimiento del `claimToken` (4.7.0, #230): corto, porque se copia de una pantalla a otra. */
export const CLAIM_TOKEN_TTL_MS = 10 * 60_000;

export type Register = {
  id: string;
  branch: string;
  pointOfSale: string;
  name: string;
  apiKey: string;
  activeDeviceId: string | undefined;
};

export type RegisterTarget = { branch: string; pointOfSale: string; name?: string | undefined };

export type ClaimErrorCode = 'claim-not-found' | 'claim-expired' | 'claim-used';

export type ClaimResult = { ok: true; register: Register } | { ok: false; code: ClaimErrorCode };

const REGISTER_COLUMNS =
  'id, branch, point_of_sale, name, api_key, active_device_id FROM registers';

function toRegister(row: Row): Register {
  return {
    id: readString(row, 'id'),
    branch: readString(row, 'branch'),
    pointOfSale: readString(row, 'point_of_sale'),
    name: readString(row, 'name'),
    apiKey: readString(row, 'api_key'),
    activeDeviceId: readOptionalString(row, 'active_device_id'),
  };
}

function registerById(db: DatabaseSync, id: string): Register | undefined {
  const row = db.prepare(`SELECT ${REGISTER_COLUMNS} WHERE id = ?`).get(id);
  return row === undefined ? undefined : toRegister(row);
}

/** La caja de una API key, o `undefined` si la key no es de ninguna (la fija, las de demo, la del alta). */
export function registerForKey(db: DatabaseSync, apiKey: string | undefined): Register | undefined {
  if (apiKey === undefined) {
    return undefined;
  }
  const row = db.prepare(`SELECT ${REGISTER_COLUMNS} WHERE api_key = ?`).get(apiKey);
  return row === undefined ? undefined : toRegister(row);
}

/**
 * La caja de la sucursal y el punto de venta, creada con una key nueva si no existía. Un `name`
 * que viene la renombra; sin él, una caja nueva se llama como su punto de venta.
 */
export function ensureRegister(db: DatabaseSync, target: RegisterTarget, now: Date): Register {
  const row = db
    .prepare(`SELECT ${REGISTER_COLUMNS} WHERE branch = ? AND point_of_sale = ?`)
    .get(target.branch, target.pointOfSale);
  const name = target.name?.trim();
  if (row !== undefined) {
    const existing = toRegister(row);
    if (name === undefined || name === '' || name === existing.name) {
      return existing;
    }
    db.prepare('UPDATE registers SET name = ? WHERE id = ?').run(name, existing.id);
    return { ...existing, name };
  }
  const register: Register = {
    id: `register-${randomUUID()}`,
    branch: target.branch,
    pointOfSale: target.pointOfSale,
    name: name === undefined || name === '' ? target.pointOfSale : name,
    apiKey: `reg-${randomUUID()}`,
    activeDeviceId: undefined,
  };
  db.prepare(
    'INSERT INTO registers (id, branch, point_of_sale, name, api_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    register.id,
    register.branch,
    register.pointOfSale,
    register.name,
    register.apiKey,
    now.toISOString(),
  );
  return register;
}

/** Emite un `claimToken` opaco de un solo uso para la caja (creándola si hace falta). */
export function issueClaimToken(
  db: DatabaseSync,
  target: RegisterTarget,
  now: Date,
): { claimToken: string; expiresAt: string; register: Register } {
  const register = ensureRegister(db, target, now);
  const claimToken = `claim-${randomUUID()}`;
  const expiresAt = new Date(now.getTime() + CLAIM_TOKEN_TTL_MS).toISOString();
  db.prepare(
    'INSERT INTO claim_tokens (token, register_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(claimToken, register.id, expiresAt, now.toISOString());
  return { claimToken, expiresAt, register };
}

/**
 * Canjea el token desde `deviceId`. Repetirlo desde el mismo dispositivo mientras no venció
 * devuelve la caja sin tocar nada (la primera respuesta se pudo perder); desde otro, `claim-used`.
 * Un canje nuevo vincula la caja a `deviceId` y así revoca al dispositivo anterior.
 */
export function redeemClaimToken(
  db: DatabaseSync,
  token: string,
  deviceId: string,
  now: Date,
): ClaimResult {
  const row = db
    .prepare(
      'SELECT register_id, expires_at, claimed_by_device_id FROM claim_tokens WHERE token = ?',
    )
    .get(token);
  if (row === undefined) {
    return { ok: false, code: 'claim-not-found' };
  }
  const registerId = readString(row, 'register_id');
  const expired = Date.parse(readString(row, 'expires_at')) <= now.getTime();
  const claimedBy = readOptionalString(row, 'claimed_by_device_id');
  if (claimedBy !== undefined && claimedBy !== deviceId) {
    return { ok: false, code: 'claim-used' };
  }
  if (expired) {
    return { ok: false, code: 'claim-expired' };
  }
  if (claimedBy === undefined) {
    db.prepare(
      'UPDATE claim_tokens SET claimed_by_device_id = ?, claimed_at = ? WHERE token = ?',
    ).run(deviceId, now.toISOString(), token);
    db.prepare('UPDATE registers SET active_device_id = ? WHERE id = ?').run(deviceId, registerId);
  }
  const register = registerById(db, registerId);
  if (register === undefined) {
    // El token apunta a su caja por FK: sin ella es una invariante rota.
    throw new Error(`El claimToken apunta a una caja que no existe: ${registerId}`);
  }
  return { ok: true, register };
}

/**
 * Si el request viene de un dispositivo revocado: la key es de una caja con dispositivo vinculado y
 * el `X-Device-Id` es otro. Sin el header (un POS 4.6) o con una key sin caja, nunca.
 */
export function isRevokedDevice(
  db: DatabaseSync,
  apiKey: string | undefined,
  deviceId: string | undefined,
): boolean {
  if (deviceId === undefined || deviceId === '') {
    return false;
  }
  const active = registerForKey(db, apiKey)?.activeDeviceId;
  return active !== undefined && active !== deviceId;
}
