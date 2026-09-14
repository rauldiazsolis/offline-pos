import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openCashSessionAndPersist } from '../../storage/cash-session-repository.ts';
import { db } from '../../storage/db.ts';
import { commandBarErrorSignal } from '../state/command-bar.ts';
import { cartSignal } from '../state/cart.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { triggerCheckout } from './command-bar-controller.ts';

beforeEach(async () => {
  await db.open();
  activeScreenSignal.value = 'sale';
  commandBarErrorSignal.value = null;
  cartSignal.value = { lines: [] };
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('triggerCheckout (Fase 6: gate de turno de caja)', () => {
  it('sin turno abierto, muestra un error y no cambia de pantalla', async () => {
    await triggerCheckout();

    expect(activeScreenSignal.value).toBe('sale');
    expect(commandBarErrorSignal.value).not.toBeNull();
  });

  it('con un turno abierto, pasa a la pantalla de cobro', async () => {
    await openCashSessionAndPersist({ openingAmount: 0 });

    await triggerCheckout();

    expect(activeScreenSignal.value).toBe('checkout');
    expect(commandBarErrorSignal.value).toBeNull();
  });
});
