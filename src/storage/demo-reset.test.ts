import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCustomersCursor, getProductsCursor, setCustomersCursor, setProductsCursor } from '../sync/cursor.ts';
import { loadSyncConfig, saveSyncConfig } from '../sync/config.ts';
import { openCashSessionAndPersist } from './cash-session-repository.ts';
import { createCustomerLocally } from './customer-repository.ts';
import { db } from './db.ts';
import { demoReset } from './demo-reset.ts';
import { seedCatalogIfEmpty } from './seed-catalog.ts';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
});

describe('demoReset', () => {
  it('borra catálogo, clientes, turnos y outbox, y re-siembra catálogo y clientes de ejemplo', async () => {
    await seedCatalogIfEmpty({ now: '2026-01-01T00:00:00.000Z' });
    const created = await createCustomerLocally('Cliente de prueba');
    if (!created.ok) throw new Error('setup falló');
    await openCashSessionAndPersist({ openingAmount: 100 });

    const result = await demoReset();

    expect(result.ok).toBe(true);
    // El cliente creado a mano ya no existe — la tabla se vació antes de
    // volver a sembrar los clientes de ejemplo del fixture.
    await expect(db.customers.get(created.value.id)).resolves.toBeUndefined();
    await expect(db.outbox.count()).resolves.toBe(0);
    await expect(db.cashSessions.count()).resolves.toBe(0);
    // Re-sembrado: la terminal queda operable sin depender de una reconexión.
    await expect(db.products.count()).resolves.toBeGreaterThan(0);
    await expect(db.customers.count()).resolves.toBeGreaterThan(0);
  });

  it('limpia los cursores de pull para que el próximo pull traiga todo, no solo deltas', async () => {
    setProductsCursor('cursor-productos-viejo');
    setCustomersCursor('cursor-clientes-viejo');

    await demoReset();

    expect(getProductsCursor()).toBeUndefined();
    expect(getCustomersCursor()).toBeUndefined();
  });

  it('no toca la configuración de /CONFIG (URL, API key, locale)', async () => {
    saveSyncConfig({ baseUrl: 'https://backend.ejemplo.com', apiKey: 'clave-1', locale: 'es-AR' });

    await demoReset();

    const config = loadSyncConfig();
    expect(config).toEqual({
      ok: true,
      value: { baseUrl: 'https://backend.ejemplo.com', apiKey: 'clave-1', locale: 'es-AR' },
    });
  });
});
