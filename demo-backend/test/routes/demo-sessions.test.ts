import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { demoSessionRoutes } from '../../src/routes/demo-sessions.ts';
import { infoRoutes } from '../../src/routes/info.ts';
import { seedIfEmpty } from '../../src/seed.ts';
import { getDemoSettings, setDemoSettings } from '../../src/settings.ts';

beforeAll(() => {
  registerRoutes(demoSessionRoutes);
  registerRoutes(infoRoutes);
});

let server: Server;
let baseUrl: string;
let db: ReturnType<typeof openDb>;

beforeEach(async () => {
  db = openDb(':memory:');
  seedIfEmpty(db, '2026-01-01T00:00:00.000Z');
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

async function createDemo(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/demo-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-POS-Contract-Version': '4.4.0' },
    body: JSON.stringify(body),
  });
}

function listProductNames(): string[] {
  const rows = db.prepare('SELECT payload FROM products').all() as { payload: string }[];
  return rows.map((row) => (JSON.parse(row.payload) as { name: string }).name);
}

describe('POST /demo-sessions (4.4.0, #128)', () => {
  it('crea una demo con el template por defecto, sin pedir Authorization', async () => {
    const response = await createDemo({});

    expect(response.status).toBe(201);
    const { apiKey, ...rest } = (await response.json()) as { apiKey: string };
    expect(apiKey).toMatch(/^demo-.+/);
    expect(apiKey).not.toBe('demo-api-key');
    expect(rest).toEqual({
      branch: 'CENTRAL',
      pointOfSale: 'Caja 1',
      template: 'kiosco',
      onboarding: { url: `${baseUrl}/_demo/onboarding`, label: 'Crear mi comercio' },
    });
    expect(listProductNames()).toContain('Arroz 1kg');
  });

  it('re-siembra la base: cada demo pisa la anterior, incluidos los ajustes del panel', async () => {
    db.prepare('DELETE FROM products').run();
    setDemoSettings(db, { maintenance: { enabled: true, message: 'x' } });

    await createDemo({});

    expect(listProductNames()).toContain('Arroz 1kg');
    expect(getDemoSettings(db).maintenance.enabled).toBe(false);
  });

  it('otro template siembra otro catálogo', async () => {
    const response = await createDemo({ template: 'almacen' });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ template: 'almacen' });
    const names = listProductNames();
    expect(names).toContain('Leche entera 1L');
    expect(names).not.toContain('Arroz 1kg');
  });

  it('template desconocido → 422 con la lista, sin tocar la base', async () => {
    const response = await createDemo({ template: 'nope' });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: 'unknown-template',
      templates: ['kiosco', 'almacen'],
    });
    expect(listProductNames()).toContain('Arroz 1kg');
  });

  it('un POS con otro major recibe 409', async () => {
    const response = await fetch(`${baseUrl}/demo-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-POS-Contract-Version': '3.0.0' },
      body: '{}',
    });

    expect(response.status).toBe(409);
  });
});

describe('GET /_demo/onboarding (4.4.0, #128)', () => {
  function decodeConnect(html: string, label: string): unknown {
    const match = new RegExp(`href="http://localhost:4173/#connect=([^"]+)">${label}<`).exec(html);
    const encoded = match?.[1];
    expect(encoded).toBeDefined();
    return encoded === undefined
      ? undefined
      : (JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as unknown);
  }

  it('arma la vuelta con #connect, con y sin el wipe_key', async () => {
    const response = await fetch(
      `${baseUrl}/_demo/onboarding?return_url=${encodeURIComponent('http://localhost:4173/')}&wipe_key=k1`,
    );
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();

    const connection = {
      baseUrl,
      apiKey: 'demo-api-key',
      branch: 'CENTRAL',
      pointOfSale: 'Caja 1',
    };
    expect(decodeConnect(html, 'Crear comercio y volver al POS')).toEqual({
      ...connection,
      wipeKey: 'k1',
    });
    expect(decodeConnect(html, 'Volver sin wipe_key')).toEqual(connection);
    expect(html).toContain('k1');
  });

  it('escapa lo que recibe', async () => {
    const html = await (
      await fetch(`${baseUrl}/_demo/onboarding?return_url=${encodeURIComponent('http://x/"><b>')}`)
    ).text();

    expect(html).not.toContain('"><b>');
    expect(html).toContain('&quot;&gt;&lt;b&gt;');
  });

  it('sin return_url no ofrece volver', async () => {
    const html = await (await fetch(`${baseUrl}/_demo/onboarding`)).text();

    expect(html).toContain('Falta return_url.');
    expect(html).not.toContain('#connect=');
  });
});

async function getInfo(apiKey: string): Promise<Response> {
  return fetch(`${baseUrl}/info`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'X-POS-Contract-Version': '4.4.0' },
  });
}

async function createDemoKey(): Promise<string> {
  const body = (await (await createDemo({})).json()) as { apiKey: string };
  return body.apiKey;
}

describe('keys de demo y revocación (#176)', () => {
  it('cada demo emite una key propia que anda', async () => {
    const first = await createDemoKey();
    const second = await createDemoKey();
    expect(first).toMatch(/^demo-/);
    expect(second).not.toBe(first);
    expect((await getInfo(first)).status).toBe(200);
  });

  it('revocar las demos: sus keys dan 401, otras keys siguen andando', async () => {
    const apiKey = await createDemoKey();
    const revoke = await fetch(`${baseUrl}/_demo/revoke-demos`, { method: 'POST' });
    expect(await revoke.json()).toEqual({ revoked: 1 });

    const response = await getInfo(apiKey);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'La demo terminó' });
    expect((await getInfo('demo-api-key')).status).toBe(200);
  });

  it('una demo nueva después de revocar anda, y re-sembrar no borra las keys revocadas', async () => {
    const old = await createDemoKey();
    await fetch(`${baseUrl}/_demo/revoke-demos`, { method: 'POST' });
    const apiKey = await createDemoKey();
    expect((await getInfo(apiKey)).status).toBe(200);
    expect((await getInfo(old)).status).toBe(401);
  });
});
