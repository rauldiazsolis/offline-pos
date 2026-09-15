import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { demoResetRoute } from '../../src/routes/demo-reset.ts';
import { seedIfEmpty } from '../../src/seed.ts';

beforeAll(() => {
  registerRoutes(demoResetRoute);
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

describe('POST /_demo/reset', () => {
  it('no exige Authorization (tooling de desarrollo, no parte del contrato)', async () => {
    db.prepare('INSERT INTO sales (id, payload, created_at) VALUES (?, ?, ?)').run(
      's1',
      '{}',
      '2026-01-01T00:00:00.000Z',
    );

    const response = await fetch(`${baseUrl}/_demo/reset`, { method: 'POST' });

    expect(response.status).toBe(200);
    const salesCount = (
      db.prepare('SELECT COUNT(*) as count FROM sales').get() as { count: number }
    ).count;
    expect(salesCount).toBe(0);
    const productCount = (
      db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number }
    ).count;
    expect(productCount).toBe(24);
  });
});
