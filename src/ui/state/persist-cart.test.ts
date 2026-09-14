import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../storage/db.ts';
import { loadDraftCart } from '../../storage/draft-cart-repository.ts';
import { cartSignal } from './cart.ts';
import { attachedCustomerSignal } from './customer.ts';
import { startCartPersistence } from './persist-cart.ts';

let stop: (() => void) | undefined;

beforeEach(async () => {
  await db.open();
  cartSignal.value = { lines: [] };
  attachedCustomerSignal.value = undefined;
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  db.close();
  await db.delete();
});

describe('startCartPersistence', () => {
  it('persiste el carrito cada vez que cambia', async () => {
    stop = startCartPersistence();

    cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };

    await vi.waitFor(async () => {
      expect(await loadDraftCart()).toEqual({ cart: cartSignal.value });
    });
  });

  it('persiste el cliente adjunto junto con el carrito', async () => {
    stop = startCartPersistence();
    const customer = { id: 'c1', name: 'Ana García', createdAt: '2026-01-01T00:00:00.000Z' };

    attachedCustomerSignal.value = customer;
    cartSignal.value = { lines: [{ kind: 'freeform', description: 'Envío', qty: 1, unitPrice: 50 }] };

    await vi.waitFor(async () => {
      expect(await loadDraftCart()).toEqual({ cart: cartSignal.value, customer });
    });
  });

  it('al vaciar el carrito (venta cerrada), persiste el estado vacío — indistinguible de "sin draft"', async () => {
    stop = startCartPersistence();
    cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };

    await vi.waitFor(async () => {
      expect(await loadDraftCart()).toEqual({ cart: cartSignal.value });
    });

    cartSignal.value = { lines: [] };

    await vi.waitFor(async () => {
      expect(await loadDraftCart()).toEqual({ cart: { lines: [] } });
    });
  });
});
