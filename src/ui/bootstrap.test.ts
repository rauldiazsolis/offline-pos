import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../storage/db.ts';
import { saveSyncConfig } from '../sync/config.ts';
import { bootstrap } from './bootstrap.ts';
import { connectionStateSignal } from './state/sync.ts';
import { configFieldValuesSignal, configTypeSignal } from './state/sync-config.ts';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
});

describe('bootstrap', () => {
  it('no siembra catálogo ni clientes localmente — una terminal nueva arranca vacía hasta el primer sync', async () => {
    await bootstrap();

    await expect(db.products.count()).resolves.toBe(0);
    await expect(db.customers.count()).resolves.toBe(0);
  });

  it('sin config guardada: la conexión queda unconfigured', async () => {
    await bootstrap();

    expect(connectionStateSignal.value).toBe('unconfigured');
  });

  it('con una config sin verifiedAt (por ejemplo, la guardada antes de la Etapa 2b): unverified y el formulario queda precargado', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });

    await bootstrap();

    expect(connectionStateSignal.value).toBe('unverified');
    expect(configTypeSignal.value).toBe('rest');
    expect(configFieldValuesSignal.value.rest.baseUrl).toBe('https://api.example.com');
  });

  it('con una config con verifiedAt: active', async () => {
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });

    await bootstrap();

    expect(connectionStateSignal.value).toBe('active');
  });
});
