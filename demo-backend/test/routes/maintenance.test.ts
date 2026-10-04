import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { accountHoldRoutes } from '../../src/routes/account-holds.ts';
import { demoSessionRoutes } from '../../src/routes/demo-sessions.ts';
import { infoRoutes } from '../../src/routes/info.ts';
import { syncRoutes } from '../../src/routes/sync.ts';
import { setDemoSettings } from '../../src/settings.ts';

beforeAll(() => {
  registerRoutes(infoRoutes);
  registerRoutes(syncRoutes);
  registerRoutes(accountHoldRoutes);
  registerRoutes(demoSessionRoutes);
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

const AUTH = {
  Authorization: 'Bearer demo-token',
  'Content-Type': 'application/json',
  'X-POS-Contract-Version': '4.6.0',
};

const PUSH: RequestInit = {
  method: 'POST',
  headers: { ...AUTH, 'Idempotency-Key': 'l1' },
  body: '{"deviceId":"d1","events":[]}',
};

const CLOSED: [string, RequestInit][] = [
  ['/sync/push', PUSH],
  ['/sync/pull', { method: 'POST', headers: AUTH, body: '{"deviceId":"d1"}' }],
  [
    '/account-holds',
    {
      method: 'POST',
      headers: { ...AUTH, 'Idempotency-Key': 'h1' },
      body: '{"customerId":"c1","amount":1}',
    },
  ],
  [
    '/demo-sessions',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  ],
];

describe('mantenimiento: 503 con Retry-After (4.6.0, #178)', () => {
  it.each(CLOSED)(
    '%s responde 503 maintenance con el mensaje y Retry-After: 30',
    async (path, init) => {
      setDemoSettings(db, { maintenance: { enabled: true, message: 'Migrando' } });

      const response = await fetch(`${baseUrl}${path}`, init);

      expect(response.status).toBe(503);
      expect(response.headers.get('Retry-After')).toBe('30');
      expect(response.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
      expect(await response.json()).toEqual({ code: 'maintenance', message: 'Migrando' });
    },
  );

  it('sin mensaje, el cuerpo es solo el código', async () => {
    setDemoSettings(db, { maintenance: { enabled: true, message: '' } });
    const response = await fetch(`${baseUrl}/sync/push`, PUSH);
    expect(await response.json()).toEqual({ code: 'maintenance' });
  });

  it('sin mantenimiento, el push se procesa como siempre', async () => {
    const response = await fetch(`${baseUrl}/sync/push`, PUSH);
    expect(response.status).toBe(200);
  });

  it('/info sigue respondiendo 200 con status maintenance', async () => {
    setDemoSettings(db, { maintenance: { enabled: true, message: 'Migrando' } });
    const response = await fetch(`${baseUrl}/info`, { headers: AUTH });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'maintenance', message: 'Migrando' });
  });
});
