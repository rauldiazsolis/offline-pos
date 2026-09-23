import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Cart } from '../domain/cart.ts';
import type { Customer } from '../domain/customer.ts';
import { db } from './db.ts';
import { loadDraftCart, saveDraftCart } from './draft-cart-repository.ts';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('draft cart repository', () => {
  it('devuelve undefined cuando no hay ningún draft guardado todavía', async () => {
    expect(await loadDraftCart()).toBeUndefined();
  });

  it('guarda y recupera el carrito, sin cliente adjunto', async () => {
    const cart: Cart = {
      lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }],
    };

    await saveDraftCart({ cart });

    expect(await loadDraftCart()).toEqual({ cart });
  });

  it('guarda y recupera el carrito junto con el cliente adjunto', async () => {
    const cart: Cart = {
      lines: [{ kind: 'freeform', description: 'Envío', qty: 1, unitPrice: 50 }],
    };
    const customer: Customer = {
      id: 'c1',
      name: 'Ana García',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    await saveDraftCart({ cart, customer });

    expect(await loadDraftCart()).toEqual({ cart, customer });
  });

  it('un save posterior reemplaza el draft anterior (no acumula filas)', async () => {
    await saveDraftCart({
      cart: { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 10 }] },
    });
    await saveDraftCart({ cart: { lines: [] } });

    expect(await loadDraftCart()).toEqual({ cart: { lines: [] } });
    expect(await db.draftCart.count()).toBe(1);
  });
});
