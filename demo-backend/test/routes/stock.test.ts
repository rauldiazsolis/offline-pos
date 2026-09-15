import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { stockRoutes } from '../../src/routes/stock.ts';
import { seedIfEmpty } from '../../src/seed.ts';

beforeAll(() => {
  registerRoutes(stockRoutes);
});

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const db = openDb(':memory:');
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

describe('GET /stock', () => {
  it('exige Authorization Bearer', async () => {
    const response = await fetch(`${baseUrl}/stock`);
    expect(response.status).toBe(401);
  });

  it('trae el stock de los 24 productos', async () => {
    const response = await fetch(`${baseUrl}/stock`, {
      headers: { Authorization: 'Bearer demo-token' },
    });
    expect(response.status).toBe(200);
    const items = (await response.json()) as { productId: string; quantity: number }[];
    expect(items).toHaveLength(24);
    expect(items.find((i) => i.productId === 'alm-001')).toEqual({
      productId: 'alm-001',
      quantity: 40,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
