import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { productRoutes } from '../../src/routes/products.ts';
import { seedIfEmpty } from '../../src/seed.ts';

beforeAll(() => {
  registerRoutes(productRoutes);
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

describe('GET /products', () => {
  it('exige Authorization Bearer', async () => {
    const response = await fetch(`${baseUrl}/products`);
    expect(response.status).toBe(401);
  });

  it('sin `since`, trae los 24 productos sembrados y un nextCursor', async () => {
    const response = await fetch(`${baseUrl}/products`, {
      headers: { Authorization: 'Bearer demo-token' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { id: string; name: string }[]; nextCursor?: string };
    expect(body.items).toHaveLength(24);
    expect(body.items.some((p) => p.name === 'Arroz 1kg')).toBe(true);
    expect(body.nextCursor).toBe('2026-01-01T00:00:00.000Z');
  });

  it('con `since` en el futuro, no trae nada', async () => {
    const response = await fetch(`${baseUrl}/products?since=2099-01-01T00:00:00.000Z`, {
      headers: { Authorization: 'Bearer demo-token' },
    });
    const body = (await response.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });
});
