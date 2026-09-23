import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { accountHoldRoutes } from '../../src/routes/account-holds.ts';

beforeAll(() => {
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

  db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
    'cust-01',
    JSON.stringify({
      id: 'cust-01',
      name: 'Ana García',
      creditLimit: 5000,
      margin: 1000,
      balance: 0,
    }),
    'seed',
    '2026-01-01T00:00:00.000Z',
  );
  db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
    'cust-sin-cuenta',
    JSON.stringify({ id: 'cust-sin-cuenta', name: 'Sin Cuenta' }),
    'seed',
    '2026-01-01T00:00:00.000Z',
  );
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

const authHeaders = (idempotencyKey: string) => ({
  Authorization: 'Bearer demo-token',
  'Content-Type': 'application/json',
  'Idempotency-Key': idempotencyKey,
});

describe('POST /account-holds', () => {
  it('aprueba dentro del crédito disponible (creditLimit + margin - balance)', async () => {
    const response = await fetch(`${baseUrl}/account-holds`, {
      method: 'POST',
      headers: authHeaders('key-1'),
      body: JSON.stringify({ customerId: 'cust-01', amount: 6000 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { approved: boolean; holdId?: string };
    expect(body.approved).toBe(true);
    expect(typeof body.holdId).toBe('string');

    const rows = db
      .prepare('SELECT status FROM account_holds WHERE customer_id = ?')
      .all('cust-01');
    expect(rows).toEqual([{ status: 'pending' }]);
  });

  it('rechaza por encima del crédito disponible', async () => {
    const response = await fetch(`${baseUrl}/account-holds`, {
      method: 'POST',
      headers: authHeaders('key-2'),
      body: JSON.stringify({ customerId: 'cust-01', amount: 6001 }),
    });
    const body = (await response.json()) as { approved: boolean; reasonCode?: string };
    expect(body).toEqual({ approved: false, reasonCode: 'insufficient-credit' });
  });

  it('rechaza un cliente sin cuenta corriente', async () => {
    const response = await fetch(`${baseUrl}/account-holds`, {
      method: 'POST',
      headers: authHeaders('key-3'),
      body: JSON.stringify({ customerId: 'cust-sin-cuenta', amount: 100 }),
    });
    const body = (await response.json()) as { approved: boolean; reasonCode?: string };
    expect(body).toEqual({ approved: false, reasonCode: 'no-account' });
  });

  it('descuenta los holds pending de otro cobro en curso del mismo cliente', async () => {
    await fetch(`${baseUrl}/account-holds`, {
      method: 'POST',
      headers: authHeaders('key-4'),
      body: JSON.stringify({ customerId: 'cust-01', amount: 4000 }),
    });

    const response = await fetch(`${baseUrl}/account-holds`, {
      method: 'POST',
      headers: authHeaders('key-5'),
      body: JSON.stringify({ customerId: 'cust-01', amount: 2001 }),
    });
    const body = (await response.json()) as { approved: boolean; reasonCode?: string };
    expect(body).toEqual({ approved: false, reasonCode: 'insufficient-credit' });
  });

  it('es idempotente: la misma Idempotency-Key devuelve el mismo resultado sin crear un segundo hold', async () => {
    const first = await fetch(`${baseUrl}/account-holds`, {
      method: 'POST',
      headers: authHeaders('same-key'),
      body: JSON.stringify({ customerId: 'cust-01', amount: 100 }),
    });
    const second = await fetch(`${baseUrl}/account-holds`, {
      method: 'POST',
      headers: authHeaders('same-key'),
      body: JSON.stringify({ customerId: 'cust-01', amount: 100 }),
    });
    expect(await first.json()).toEqual(await second.json());

    const rows = db.prepare('SELECT COUNT(*) as count FROM account_holds').get() as {
      count: number;
    };
    expect(rows.count).toBe(1);
  });
});

// La confirmación y la liberación de un hold viajan ahora dentro del lote de
// /sync/push (#87) — ver demo-backend/test/routes/sync.test.ts.
