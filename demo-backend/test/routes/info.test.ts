import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { accountHoldRoutes } from '../../src/routes/account-holds.ts';
import { infoRoutes } from '../../src/routes/info.ts';
import { syncRoutes } from '../../src/routes/sync.ts';
import { setDemoSettings } from '../../src/settings.ts';

beforeAll(() => {
  registerRoutes(infoRoutes);
  registerRoutes(syncRoutes);
  registerRoutes(accountHoldRoutes);
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
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

function headers(version?: string): Record<string, string> {
  return {
    Authorization: 'Bearer demo-token',
    'Content-Type': 'application/json',
    ...(version !== undefined ? { 'X-POS-Contract-Version': version } : {}),
  };
}

async function info(): Promise<unknown> {
  const response = await fetch(`${baseUrl}/info`, { headers: headers('4.0.0') });
  expect(response.status).toBe(200);
  return response.json();
}

async function push(version: string | undefined, id = 'lot-1'): Promise<Response> {
  return fetch(`${baseUrl}/sync/push`, {
    method: 'POST',
    headers: { ...headers(version), 'Idempotency-Key': id },
    body: JSON.stringify({
      deviceId: 'dev-1',
      events: [{ type: 'sale', id: 's1', sale: { id: 's1', total: 100 } }],
    }),
  });
}

describe('GET /info (#99)', () => {
  it('informa el contrato 4.0.0 y el estado ok', async () => {
    expect(await info()).toEqual({
      contractVersion: '4.0.0',
      status: 'ok',
      backend: { name: 'offline-pos-demo-backend', version: '4.0.0' },
    });
  });

  it('pide autenticación', async () => {
    const response = await fetch(`${baseUrl}/info`);
    expect(response.status).toBe(401);
  });

  it('con mantenimiento activado informa el estado y el mensaje', async () => {
    setDemoSettings(db, { maintenance: { enabled: true, message: 'Cierre de mes' } });
    expect(await info()).toMatchObject({ status: 'maintenance', message: 'Cierre de mes' });
  });
});

describe('versión del contrato en cada request (#99)', () => {
  it('con "Simular contrato 3.0.0", /info informa 3.0.0 y el push responde 409 sin guardar nada', async () => {
    setDemoSettings(db, { simulateContract3: true });

    expect(await info()).toMatchObject({ contractVersion: '3.0.0' });
    const response = await push('4.0.0');

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'incompatible-contract',
      contractVersion: '3.0.0',
    });
    expect(db.prepare('SELECT COUNT(*) c FROM push_lots').get()).toEqual({ c: 0 });
  });

  it('un POS con otro major recibe 409 con la versión del backend', async () => {
    const response = await push('3.1.0');

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'incompatible-contract',
      contractVersion: '4.0.0',
    });
  });

  it('sin el header se procesa (criterio del backend)', async () => {
    const response = await push(undefined);

    expect(response.status).toBe(200);
  });

  it('el pull también valida la versión', async () => {
    setDemoSettings(db, { simulateContract3: true });
    const response = await fetch(`${baseUrl}/sync/pull`, {
      method: 'POST',
      headers: headers('4.0.0'),
      body: JSON.stringify({ deviceId: 'dev-1', cursors: {}, pendingLotIds: [] }),
    });

    expect(response.status).toBe(409);
  });

  it('el preflight permite el header de la versión', async () => {
    const response = await fetch(`${baseUrl}/sync/push`, { method: 'OPTIONS' });

    expect(response.headers.get('access-control-allow-headers')).toContain(
      'X-POS-Contract-Version',
    );
  });
});
