import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { panelRoutes } from '../../src/routes/panel.ts';

beforeAll(() => {
  registerRoutes(panelRoutes);
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

describe('GET /_demo', () => {
  it('sirve el HTML del panel sin exigir Authorization', async () => {
    const response = await fetch(`${baseUrl}/_demo`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Minibackend de demo');
  });
});

describe('GET /_demo/api/sales', () => {
  it('trae las ventas guardadas, sin exigir Authorization', async () => {
    db.prepare('INSERT INTO sales (id, payload, created_at) VALUES (?, ?, ?)').run(
      's1',
      JSON.stringify({ id: 's1', total: 1200, status: 'closed' }),
      '2026-01-01T00:00:00.000Z',
    );

    const response = await fetch(`${baseUrl}/_demo/api/sales`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; total: number }[];
    expect(body).toEqual([{ id: 's1', total: 1200, status: 'closed' }]);
  });
});

describe('GET /_demo/api/customers', () => {
  it('trae solo los clientes con source pos, no los sembrados', async () => {
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'seed-1',
      JSON.stringify({ id: 'seed-1', name: 'Sembrado' }),
      'seed',
      '2026-01-01T00:00:00.000Z',
    );
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'pos-1',
      JSON.stringify({ id: 'pos-1', name: 'Del POS' }),
      'pos',
      '2026-01-01T00:00:00.000Z',
    );

    const response = await fetch(`${baseUrl}/_demo/api/customers`);
    const body = (await response.json()) as { id: string; name: string }[];
    expect(body).toEqual([{ id: 'pos-1', name: 'Del POS' }]);
  });
});
