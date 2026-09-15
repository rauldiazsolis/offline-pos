import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';

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

describe('createApp', () => {
  it('responde 404 para una ruta que no existe (sin rutas registradas todavía)', async () => {
    const response = await fetch(`${baseUrl}/no-existe`);
    expect(response.status).toBe(404);
  });
});
