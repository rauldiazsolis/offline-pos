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
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

const authHeaders = { Authorization: 'Bearer demo-token', 'Content-Type': 'application/json' };

describe('POST /account-holds', () => {
  it('responde 501 y loguea el intento', async () => {
    const response = await fetch(`${baseUrl}/account-holds`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ customerId: 'cust-01', amount: 500 }),
    });
    expect(response.status).toBe(501);

    const rows = db.prepare('SELECT kind FROM account_hold_attempts').all() as { kind: string }[];
    expect(rows).toEqual([{ kind: 'request' }]);
  });
});

describe('POST /account-holds/{holdId}/confirm', () => {
  it('responde 501 y loguea el intento', async () => {
    const response = await fetch(`${baseUrl}/account-holds/hold-1/confirm`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ saleId: 'sale-1' }),
    });
    expect(response.status).toBe(501);

    const rows = db.prepare('SELECT kind FROM account_hold_attempts').all() as { kind: string }[];
    expect(rows).toEqual([{ kind: 'confirm' }]);
  });
});

describe('DELETE /account-holds/{holdId}', () => {
  it('responde 501 y loguea el intento', async () => {
    const response = await fetch(`${baseUrl}/account-holds/hold-1`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer demo-token' },
    });
    expect(response.status).toBe(501);

    const rows = db.prepare('SELECT kind FROM account_hold_attempts').all() as { kind: string }[];
    expect(rows).toEqual([{ kind: 'release' }]);
  });
});
