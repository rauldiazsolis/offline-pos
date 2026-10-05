import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { issueDemoKey, revokeDemoKeys } from '../../src/demo-keys.ts';
import { issuePortalLink } from '../../src/portal-links.ts';
import { registerRoutes } from '../../src/router.ts';
import { infoRoutes } from '../../src/routes/info.ts';
import { portalRoutes } from '../../src/routes/portal.ts';
import { seedIfEmpty } from '../../src/seed.ts';
import { setDemoSettings } from '../../src/settings.ts';

beforeAll(() => {
  registerRoutes(infoRoutes);
  registerRoutes(portalRoutes);
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

const AUTH = { Authorization: 'Bearer demo-api-key', 'X-POS-Contract-Version': '4.6.0' };

async function requestLink(headers: Record<string, string> = AUTH): Promise<Response> {
  return fetch(`${baseUrl}/portal-links`, { method: 'POST', headers });
}

async function linkFor(key: string): Promise<string> {
  const response = await requestLink({ ...AUTH, Authorization: `Bearer ${key}` });
  return ((await response.json()) as { url: string }).url;
}

describe('POST /portal-links y el canje (4.6.0, #178)', () => {
  it('sin Authorization → 401', async () => {
    expect((await requestLink({})).status).toBe(401);
  });

  it('devuelve un link de un solo uso a la página del canje, sin la key', async () => {
    const response = await requestLink();
    expect(response.status).toBe(201);
    const { url, expiresAt } = (await response.json()) as { url: string; expiresAt: string };
    expect(url).toMatch(new RegExp(`^${baseUrl}/_demo/portal/[A-Za-z0-9_-]+$`));
    expect(url).not.toContain('demo-api-key');
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(50_000);

    const first = await fetch(url);
    expect(first.status).toBe(200);
    const page = await first.text();
    expect(page).toContain('Caja 1');
    expect(page).toContain('CENTRAL');
    expect(page).toContain('del comercio');

    const second = await fetch(url);
    expect(second.status).toBe(410);
    expect(await second.text()).toContain('El link ya se usó o venció');
  });

  it('con la key de una demo, la página lo dice', async () => {
    const url = await linkFor(issueDemoKey(db, new Date().toISOString()));
    expect(await (await fetch(url)).text()).toContain('de una demo');
  });

  it('un link vencido da 410', async () => {
    const { token } = issuePortalLink(db, 'demo-api-key', new Date(Date.now() - 61_000));
    expect((await fetch(`${baseUrl}/_demo/portal/${token}`)).status).toBe(410);
  });

  it('una key revocada: 401 al pedir, y 410 al canjear un link emitido antes', async () => {
    const key = issueDemoKey(db, new Date().toISOString());
    const url = await linkFor(key);
    revokeDemoKeys(db, new Date().toISOString());

    expect((await requestLink({ ...AUTH, Authorization: `Bearer ${key}` })).status).toBe(401);
    expect((await fetch(url)).status).toBe(410);
  });

  it('en mantenimiento → 503', async () => {
    setDemoSettings(db, { maintenance: { enabled: true, message: '' } });
    expect((await requestLink()).status).toBe(503);
  });
});
