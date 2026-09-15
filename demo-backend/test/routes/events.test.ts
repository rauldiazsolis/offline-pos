import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { eventRoutes } from '../../src/routes/events.ts';

beforeAll(() => {
  registerRoutes(eventRoutes);
});

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const db = openDb(':memory:');
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

async function post(path: string, key: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer demo-token',
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /sales', () => {
  it('siempre responde 200, nunca simula rechazo de negocio', async () => {
    const response = await post('/sales', 'sale-1', { id: 'sale-1', total: 1200 });
    expect(response.status).toBe(200);
  });

  it('exige Idempotency-Key', async () => {
    const response = await fetch(`${baseUrl}/sales`, {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'sale-2' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /stock-movements', () => {
  it('siempre responde 200', async () => {
    const response = await post('/stock-movements', 'mov-1', { id: 'mov-1', productId: 'alm-001', delta: -1 });
    expect(response.status).toBe(200);
  });
});

describe('POST /sales/{saleId}/void', () => {
  it('siempre responde 200, con su propia Idempotency-Key (distinta de la venta)', async () => {
    await post('/sales', 'sale-3', { id: 'sale-3', total: 500 });
    const response = await post('/sales/sale-3/void', 'void-1', {
      saleId: 'sale-3',
      voidedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(response.status).toBe(200);
  });
});

describe('POST /cash-sessions', () => {
  it('siempre responde 200', async () => {
    const response = await post('/cash-sessions', 'session-1', { id: 'session-1', sales: [] });
    expect(response.status).toBe(200);
  });
});

describe('idempotencia compartida entre los cuatro recursos', () => {
  it('reenviar la misma Idempotency-Key no vuelve a insertar la fila', async () => {
    await post('/sales', 'sale-4', { id: 'sale-4', total: 100 });
    const second = await post('/sales', 'sale-4', { id: 'sale-4', total: 999 });
    expect(second.status).toBe(200);
  });
});
