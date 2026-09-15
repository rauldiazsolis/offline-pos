import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { customerRoutes } from '../../src/routes/customers.ts';
import { seedIfEmpty } from '../../src/seed.ts';

beforeAll(() => {
  registerRoutes(customerRoutes);
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

describe('GET /customers', () => {
  it('trae los 22 clientes sembrados, incluidos los que tienen cuenta corriente', async () => {
    const response = await fetch(`${baseUrl}/customers`, {
      headers: { Authorization: 'Bearer demo-token' },
    });
    const body = (await response.json()) as {
      items: { id: string; name: string; creditLimit?: number }[];
    };
    expect(body.items).toHaveLength(22);
    const ana = body.items.find((c) => c.id === 'cust-01');
    expect(ana).toMatchObject({ name: 'Ana García', creditLimit: 5000, margin: 1000, balance: 0 });
  });
});

describe('POST /customers', () => {
  it('exige Idempotency-Key', async () => {
    const response = await fetch(`${baseUrl}/customers`, {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'local-1', name: 'Nuevo Cliente' }),
    });
    expect(response.status).toBe(400);
  });

  it('crea el cliente y aparece en un pull posterior, marcado como source pos', async () => {
    const createResponse = await fetch(`${baseUrl}/customers`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer demo-token',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'evt-1',
      },
      body: JSON.stringify({ id: 'local-1', name: 'Nuevo Cliente' }),
    });
    expect(createResponse.status).toBe(200);

    const pullResponse = await fetch(`${baseUrl}/customers?since=2026-01-01T00:00:00.000Z`, {
      headers: { Authorization: 'Bearer demo-token' },
    });
    const body = (await pullResponse.json()) as { items: { id: string; name: string }[] };
    expect(body.items).toEqual([{ id: 'local-1', name: 'Nuevo Cliente' }]);

    // Verify source='pos' in the database for the freshly created customer
    const row = db.prepare('SELECT source FROM customers WHERE id = ?').get('local-1') as { source: string };
    expect(row.source).toBe('pos');
  });

  it('reenviar la misma Idempotency-Key no duplica el cliente', async () => {
    const request = async () =>
      fetch(`${baseUrl}/customers`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer demo-token',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'evt-2',
        },
        body: JSON.stringify({ id: 'local-2', name: 'Repetido' }),
      });

    await request();
    await request();

    const pullResponse = await fetch(`${baseUrl}/customers?since=2026-01-01T00:00:00.000Z`, {
      headers: { Authorization: 'Bearer demo-token' },
    });
    const body = (await pullResponse.json()) as { items: { id: string }[] };
    expect(body.items.filter((c) => c.id === 'local-2')).toHaveLength(1);
  });
});
