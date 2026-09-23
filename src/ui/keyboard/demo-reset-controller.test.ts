import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../storage/db.ts';
import { seedCatalogIfEmpty } from '../../storage/seed-catalog.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { demoResetErrorSignal, demoResetInProgressSignal } from '../state/demo-reset.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  confirmDemoReset,
  enterDemoResetScreen,
  exitDemoResetScreen,
} from './demo-reset-controller.ts';

beforeEach(async () => {
  await db.open();
  activeScreenSignal.value = 'sale';
  demoResetErrorSignal.value = null;
  demoResetInProgressSignal.value = false;
  cartSignal.value = { lines: [] };
  cartSelectionIndexSignal.value = null;
  attachedCustomerSignal.value = undefined;
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
});

describe('enterDemoResetScreen / exitDemoResetScreen', () => {
  it('entra y sale de la pantalla de confirmación sin tocar datos', async () => {
    enterDemoResetScreen();
    expect(activeScreenSignal.value).toBe('demo-reset');

    exitDemoResetScreen();
    expect(activeScreenSignal.value).toBe('sale');
    await expect(db.products.count()).resolves.toBe(0);
  });
});

describe('confirmDemoReset', () => {
  it('resetea catálogo/clientes, limpia la venta en curso y vuelve a la pantalla de venta', async () => {
    await seedCatalogIfEmpty({ now: '2026-01-01T00:00:00.000Z' });
    activeScreenSignal.value = 'demo-reset';
    cartSignal.value = {
      lines: [{ kind: 'freeform', description: 'algo', qty: 1, unitPrice: 10 }],
    };
    cartSelectionIndexSignal.value = 0;
    attachedCustomerSignal.value = {
      id: 'c1',
      name: 'Juan',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    await confirmDemoReset();

    expect(activeScreenSignal.value).toBe('sale');
    expect(cartSignal.value).toEqual({ lines: [] });
    expect(cartSelectionIndexSignal.value).toBeNull();
    expect(attachedCustomerSignal.value).toBeUndefined();
    expect(demoResetErrorSignal.value).toBeNull();
    expect(demoResetInProgressSignal.value).toBe(false);
    // Sin /CONFIG (no configurado en este test), demoReset() ya no re-siembra
    // localmente — la terminal queda vacía (ver storage/demo-reset.ts).
    await expect(db.products.count()).resolves.toBe(0);
  });

  it('con un conector de Google Sheets, Enter no borra nada y muestra el aviso', async () => {
    await seedCatalogIfEmpty({ now: '2026-01-01T00:00:00.000Z' });
    saveSyncConfig({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });
    enterDemoResetScreen();

    await confirmDemoReset();

    expect(activeScreenSignal.value).toBe('demo-reset');
    expect(demoResetErrorSignal.value).toContain('no está disponible con Google Sheets');
    await expect(db.products.count()).resolves.toBeGreaterThan(0);
  });
});
