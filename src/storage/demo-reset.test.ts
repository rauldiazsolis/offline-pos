import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCustomersCursor,
  getProductsCursor,
  setCustomersCursor,
  setProductsCursor,
} from '../sync/cursor.ts';
import { loadSyncConfig, saveSyncConfig } from '../sync/config.ts';
import { openCashSessionAndPersist } from './cash-session-repository.ts';
import { createCustomerLocally } from './customer-repository.ts';
import { db } from './db.ts';
import { demoReset } from './demo-reset.ts';

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: 'status text',
    json: () => Promise.resolve(body),
  } as Response;
}

/** Ruteador mínimo para el fetch mock — alcanza para lo que `demoReset` dispara (reset + un ciclo de sync). */
function fetchRouter(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  return vi.fn((url: string, _init?: RequestInit) => {
    const path = new URL(url).pathname;
    const handler = overrides[path];
    if (handler) {
      return Promise.resolve(handler());
    }
    if (path === '/products' || path === '/customers') {
      return Promise.resolve(jsonResponse({ items: [] }));
    }
    if (path === '/stock') {
      return Promise.resolve(jsonResponse([]));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

beforeEach(async () => {
  await db.open();
  setOnline(true);
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  setOnline(true);
  vi.unstubAllGlobals();
});

describe('demoReset', () => {
  it('sin /CONFIG: borra todo lo local y no re-siembra (queda vacía)', async () => {
    const created = await createCustomerLocally('Cliente de prueba');
    if (!created.ok) throw new Error('setup falló');
    await openCashSessionAndPersist({ openingAmount: 100 });

    const result = await demoReset();

    expect(result.ok).toBe(true);
    await expect(db.customers.get(created.value.id)).resolves.toBeUndefined();
    await expect(db.cashSessions.count()).resolves.toBe(0);
    await expect(db.products.count()).resolves.toBe(0);
    await expect(db.customers.count()).resolves.toBe(0);
  });

  it('con /CONFIG: llama primero a POST /_demo/reset del backend antes de borrar nada local', async () => {
    saveSyncConfig({ baseUrl: 'http://localhost:4000' });
    const fetchMock = fetchRouter();
    vi.stubGlobal('fetch', fetchMock);

    await demoReset();

    const resetCall = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === '/_demo/reset');
    expect(resetCall).not.toBeUndefined();
    expect(resetCall?.[1]).toMatchObject({ method: 'POST' });
  });

  it('si POST /_demo/reset falla, no borra nada local y devuelve el error', async () => {
    saveSyncConfig({ baseUrl: 'http://localhost:4000' });
    const created = await createCustomerLocally('Cliente de prueba');
    if (!created.ok) throw new Error('setup falló');
    vi.stubGlobal(
      'fetch',
      fetchRouter({ '/_demo/reset': () => jsonResponse({}, { ok: false, status: 500 }) }),
    );

    const result = await demoReset();

    expect(result.ok).toBe(false);
    await expect(db.customers.get(created.value.id)).resolves.not.toBeUndefined();
  });

  it('con /CONFIG: dispara un resync después de borrar, repoblando desde el backend', async () => {
    saveSyncConfig({ baseUrl: 'http://localhost:4000' });
    vi.stubGlobal(
      'fetch',
      fetchRouter({
        '/products': () =>
          jsonResponse({
            items: [
              {
                id: 'p1',
                sku: 'SKU-1',
                barcodes: [],
                name: 'Producto Demo',
                price: 100,
                taxRate: 0.21,
                category: 'test',
                tracksStock: true,
              },
            ],
          }),
      }),
    );

    const result = await demoReset();

    expect(result.ok).toBe(true);
    await expect(db.products.count()).resolves.toBe(1);
  });

  it('limpia los cursores de pull para que el próximo pull traiga todo, no solo deltas', async () => {
    setProductsCursor('cursor-productos-viejo');
    setCustomersCursor('cursor-clientes-viejo');

    await demoReset();

    expect(getProductsCursor()).toBeUndefined();
    expect(getCustomersCursor()).toBeUndefined();
  });

  it('no toca la configuración de /CONFIG (URL, API key, locale)', async () => {
    saveSyncConfig({ baseUrl: 'http://localhost:4000', apiKey: 'clave-1', locale: 'es-AR' });
    vi.stubGlobal('fetch', fetchRouter());

    await demoReset();

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { baseUrl: 'http://localhost:4000', apiKey: 'clave-1', locale: 'es-AR' },
    });
  });
});
