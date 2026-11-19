import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { accountHoldRoutes } from '../../src/routes/account-holds.ts';
import { claimRoutes } from '../../src/routes/claim.ts';
import { infoRoutes } from '../../src/routes/info.ts';
import { portalRoutes } from '../../src/routes/portal.ts';
import { snapshotRoutes } from '../../src/routes/snapshot.ts';
import { syncRoutes } from '../../src/routes/sync.ts';
import { setCompanyName, setDemoSettings } from '../../src/settings.ts';
import { isRecord, readJson, stringField } from '../json-helpers.ts';

beforeAll(() => {
  registerRoutes(infoRoutes);
  registerRoutes(syncRoutes);
  registerRoutes(accountHoldRoutes);
  registerRoutes(portalRoutes);
  registerRoutes(claimRoutes);
  registerRoutes(snapshotRoutes);
});

let server: Server;
let baseUrl: string;
let db: ReturnType<typeof openDb>;

beforeEach(async () => {
  db = openDb(':memory:');
  server = createApp(db);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No se pudo obtener el puerto del servidor de test');
  }
  baseUrl = `http://localhost:${String(address.port)}`;
});

afterEach(async () => {
  vi.useRealTimers();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

const VERSION = { 'X-POS-Contract-Version': '4.7.0' };

type Issued = { claimToken: string; expiresAt: string; connect: string };

async function issue(
  body: Record<string, string> = { branch: 'CENTRAL', pointOfSale: 'Caja 1' },
): Promise<Issued> {
  const response = await fetch(`${baseUrl}/_demo/claim-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  const issued = await readJson(response);
  return {
    claimToken: stringField(issued, 'claimToken'),
    expiresAt: stringField(issued, 'expiresAt'),
    connect: stringField(issued, 'connect'),
  };
}

async function claim(
  claimToken: string | undefined,
  deviceId: string | undefined,
): Promise<Response> {
  return fetch(`${baseUrl}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...VERSION,
      ...(deviceId !== undefined ? { 'X-Device-Id': deviceId } : {}),
    },
    body: claimToken === undefined ? '{}' : JSON.stringify({ claimToken }),
  });
}

async function claimKey(claimToken: string, deviceId: string): Promise<string> {
  const response = await claim(claimToken, deviceId);
  expect(response.status).toBe(200);
  return stringField(await readJson(response), 'apiKey');
}

function authHeaders(key: string, deviceId?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...VERSION,
    ...(deviceId !== undefined ? { 'X-Device-Id': deviceId } : {}),
  };
}

/** Las rutas autenticadas del Connector API que validan el dispositivo. */
function authenticatedRequests(key: string, deviceId?: string): [string, RequestInit][] {
  const headers = authHeaders(key, deviceId);
  return [
    [
      '/sync/push',
      {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `lot-${String(deviceId)}` },
        body: JSON.stringify({ deviceId, events: [] }),
      },
    ],
    [
      '/sync/pull',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ deviceId, cursors: {}, pendingLotIds: [] }),
      },
    ],
    [
      '/account-holds',
      {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `hold-${String(deviceId)}` },
        body: JSON.stringify({ customerId: 'c1', amount: 1 }),
      },
    ],
    ['/portal-links', { method: 'POST', headers }],
    ['/snapshot', { method: 'GET', headers }],
  ];
}

describe('POST /_demo/claim-tokens (4.7.0, #230)', () => {
  it('emite un token con su vencimiento y el fragmento para #connect=', async () => {
    const issued = await issue({ branch: 'CENTRAL', pointOfSale: 'Caja 1', name: 'Mostrador' });

    expect(issued.claimToken).toMatch(/^claim-/);
    expect(Date.parse(issued.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(JSON.parse(Buffer.from(issued.connect, 'base64url').toString('utf-8'))).toEqual({
      baseUrl,
      claimToken: issued.claimToken,
      branch: 'CENTRAL',
      pointOfSale: 'Caja 1',
    });
  });

  it('sin sucursal o punto de venta → 400', async () => {
    const response = await fetch(`${baseUrl}/_demo/claim-tokens`, {
      method: 'POST',
      body: JSON.stringify({ branch: 'CENTRAL' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /claim (4.7.0, #230)', () => {
  it('canjea el token por la conexión de la caja, con la empresa', async () => {
    setCompanyName(db, 'Almacén Rosa');
    const { claimToken } = await issue({
      branch: 'CENTRAL',
      pointOfSale: 'Caja 1',
      name: 'Mostrador',
    });

    const response = await claim(claimToken, 'dev-a');

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(stringField(body, 'apiKey')).toMatch(/^reg-/);
    expect(isRecord(body) ? { ...body, apiKey: 'reg' } : body).toEqual({
      apiKey: 'reg',
      branch: 'CENTRAL',
      pointOfSale: 'Caja 1',
      register: { name: 'Mostrador' },
      company: { name: 'Almacén Rosa' },
    });
  });

  it('sin empresa cargada no manda company', async () => {
    const { claimToken } = await issue();
    const body = await readJson(await claim(claimToken, 'dev-a'));
    expect(body).not.toHaveProperty('company');
    expect(body).toMatchObject({ register: { name: 'Caja 1' } });
  });

  it('repetirlo desde el mismo dispositivo devuelve lo mismo (idempotente)', async () => {
    const { claimToken } = await issue();
    const first = await readJson(await claim(claimToken, 'dev-a'));
    const again = await claim(claimToken, 'dev-a');

    expect(again.status).toBe(200);
    expect(await readJson(again)).toEqual(first);
  });

  it('desde otro dispositivo → 410 claim-used', async () => {
    const { claimToken } = await issue();
    await claim(claimToken, 'dev-a');

    const response = await claim(claimToken, 'dev-b');

    expect(response.status).toBe(410);
    expect(await readJson(response)).toMatchObject({ code: 'claim-used' });
  });

  it('vencido → 410 claim-expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T12:00:00.000Z'));
    const { claimToken } = await issue();
    vi.setSystemTime(new Date('2026-11-19T12:10:00.000Z'));

    const response = await claim(claimToken, 'dev-a');

    expect(response.status).toBe(410);
    const body = await readJson(response);
    expect(stringField(body, 'code')).toBe('claim-expired');
    expect(stringField(body, 'message')).toContain('venció');
  });

  it('desconocido → 404 claim-not-found', async () => {
    const response = await claim('claim-que-no-existe', 'dev-a');

    expect(response.status).toBe(404);
    expect(await readJson(response)).toMatchObject({ code: 'claim-not-found' });
  });

  it('sin X-Device-Id, con el header vacío o sin claimToken → 400 invalid-request', async () => {
    const { claimToken } = await issue();

    for (const response of [
      await claim(claimToken, undefined),
      await claim(claimToken, ''),
      await claim(undefined, 'dev-a'),
      await fetch(`${baseUrl}/claim`, {
        method: 'POST',
        headers: { 'X-Device-Id': 'dev-a' },
      }),
      await fetch(`${baseUrl}/claim`, {
        method: 'POST',
        headers: { 'X-Device-Id': 'dev-a' },
        body: JSON.stringify({ claimToken: '' }),
      }),
    ]) {
      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({ code: 'invalid-request' });
    }
  });

  it('con otro major del contrato → 409 incompatible-contract', async () => {
    const { claimToken } = await issue();
    const response = await fetch(`${baseUrl}/claim`, {
      method: 'POST',
      headers: { 'X-Device-Id': 'dev-a', 'X-POS-Contract-Version': '3.0.0' },
      body: JSON.stringify({ claimToken }),
    });
    expect(response.status).toBe(409);
    expect(await readJson(response)).toMatchObject({ code: 'incompatible-contract' });
  });

  it('en mantenimiento → 503', async () => {
    const { claimToken } = await issue();
    setDemoSettings(db, { maintenance: { enabled: true, message: '' } });
    expect((await claim(claimToken, 'dev-a')).status).toBe(503);
  });

  it('con "device-claim" apagado en el panel, la ruta no existe', async () => {
    const { claimToken } = await issue();
    setDemoSettings(db, { deviceClaim: false });

    const response = await claim(claimToken, 'dev-a');

    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({ error: 'No existe POST /claim' });
  });

  it('el preflight permite X-Device-Id', async () => {
    const response = await fetch(`${baseUrl}/claim`, { method: 'OPTIONS' });
    expect(response.headers.get('access-control-allow-headers')).toContain('X-Device-Id');
  });
});

describe('exclusividad por X-Device-Id (4.7.0, #230)', () => {
  async function relinkedKey(): Promise<string> {
    const first = await issue();
    const key = await claimKey(first.claimToken, 'dev-a');
    const second = await issue();
    const sameKey = await claimKey(second.claimToken, 'dev-b');
    // La key de la caja no se rota: el dispositivo viejo recibe 409, no 401.
    expect(sameKey).toBe(key);
    return key;
  }

  it('el dispositivo viejo recibe 409 device-revoked en todas las rutas autenticadas', async () => {
    const key = await relinkedKey();

    for (const [path, init] of authenticatedRequests(key, 'dev-a')) {
      const response = await fetch(`${baseUrl}${path}`, init);
      expect(response.status, path).toBe(409);
      expect(await readJson(response)).toEqual({
        code: 'device-revoked',
        message: 'Esta caja fue vinculada en otro dispositivo.',
      });
    }
    // Sin procesar nada: el push no dejó lote ni el hold su intento.
    expect(db.prepare('SELECT COUNT(*) AS c FROM push_lots').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM account_hold_attempts').get()).toEqual({ c: 0 });
  });

  it('el dispositivo nuevo opera', async () => {
    const key = await relinkedKey();

    for (const [path, init] of authenticatedRequests(key, 'dev-b')) {
      const response = await fetch(`${baseUrl}${path}`, init);
      expect(response.status, path).not.toBe(409);
      expect(response.status, path).toBeLessThan(300);
    }
  });

  it('sin X-Device-Id se procesa (un POS 4.6)', async () => {
    const key = await relinkedKey();

    for (const [path, init] of authenticatedRequests(key)) {
      const response = await fetch(`${baseUrl}${path}`, init);
      expect(response.status, path).toBeLessThan(300);
    }
  });

  it('/info nunca responde 409, aunque el header sea de otro dispositivo', async () => {
    const key = await relinkedKey();
    const response = await fetch(`${baseUrl}/info`, { headers: authHeaders(key, 'dev-a') });
    expect(response.status).toBe(200);
  });

  it('una key que no es de ninguna caja no se valida', async () => {
    await relinkedKey();
    for (const [path, init] of authenticatedRequests('demo-api-key', 'dev-a')) {
      const response = await fetch(`${baseUrl}${path}`, init);
      expect(response.status, path).not.toBe(409);
    }
  });

  it('con "device-claim" apagado no se valida la exclusividad', async () => {
    const key = await relinkedKey();
    setDemoSettings(db, { deviceClaim: false });

    for (const [path, init] of authenticatedRequests(key, 'dev-a')) {
      const response = await fetch(`${baseUrl}${path}`, init);
      expect(response.status, path).toBeLessThan(300);
    }
  });

  it('el 409 de contrato gana sobre el del dispositivo', async () => {
    const key = await relinkedKey();
    const response = await fetch(`${baseUrl}/sync/pull`, {
      method: 'POST',
      headers: { ...authHeaders(key, 'dev-a'), 'X-POS-Contract-Version': '3.0.0' },
      body: JSON.stringify({ deviceId: 'dev-a', cursors: {}, pendingLotIds: [] }),
    });
    expect(response.status).toBe(409);
    expect(await readJson(response)).toMatchObject({ code: 'incompatible-contract' });
  });

  it('el 409 device-revoked gana sobre el mantenimiento', async () => {
    const key = await relinkedKey();
    setDemoSettings(db, { maintenance: { enabled: true, message: '' } });
    const [path, init] = authenticatedRequests(key, 'dev-a')[1] ?? ['', {}];
    const response = await fetch(`${baseUrl}${path}`, init);
    expect(response.status).toBe(409);
  });
});
