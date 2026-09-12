import { describe, expect, it } from 'vitest';
import {
  addFreeformLine,
  addProductLine,
  applyLineDiscount,
  removeLine,
  setLineQuantity,
} from './cart.ts';
import type { Product } from './product.ts';
import type { Cart } from './cart.ts';
import type { StockItem } from './stock.ts';

const emptyCart: Cart = { lines: [] };

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    sku: 'SKU-1',
    barcodes: ['111'],
    name: 'Producto 1',
    price: 100,
    taxRate: 0.21,
    category: 'general',
    tracksStock: true,
    ...overrides,
  };
}

function makeStock(overrides: Partial<StockItem> = {}): StockItem {
  return { productId: 'p1', quantity: 5, updatedAt: '2026-01-01T00:00:00.000Z', ...overrides };
}

describe('addProductLine', () => {
  it('agrega una línea nueva para un producto no presente en el carrito', () => {
    const result = addProductLine(emptyCart, {
      product: makeProduct(),
      stock: makeStock(),
      qty: 2,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines).toEqual([
        { kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 },
      ]);
    }
  });

  it('suma a la línea existente si el producto ya está en el carrito', () => {
    const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
    const result = addProductLine(cart, { product: makeProduct(), stock: makeStock(), qty: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines[0]?.qty).toBe(3);
    }
  });

  it('resta cantidad con qty negativo y elimina la línea si llega a 0', () => {
    const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] };
    const result = addProductLine(cart, { product: makeProduct(), stock: makeStock(), qty: -2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines).toEqual([]);
    }
  });

  it('rechaza restar de un producto que no está en el carrito', () => {
    const result = addProductLine(emptyCart, {
      product: makeProduct(),
      stock: makeStock(),
      qty: -1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('cart/nothing-to-subtract');
    }
  });

  it('rechaza superar el stock disponible cuando el producto trackea stock', () => {
    const result = addProductLine(emptyCart, {
      product: makeProduct(),
      stock: makeStock({ quantity: 1 }),
      qty: 2,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sale/insufficient-stock');
      expect(result.meta).toEqual({ productId: 'p1', requested: 2, available: 1 });
    }
  });

  it('no valida stock para un producto que no lo trackea', () => {
    const result = addProductLine(emptyCart, {
      product: makeProduct({ tracksStock: false }),
      stock: undefined,
      qty: 1000,
    });

    expect(result.ok).toBe(true);
  });

  it('rechaza qty en 0', () => {
    const result = addProductLine(emptyCart, {
      product: makeProduct(),
      stock: makeStock(),
      qty: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('cart/invalid-quantity');
    }
  });
});

describe('addFreeformLine', () => {
  it('agrega una línea libre con qty 1', () => {
    const result = addFreeformLine(emptyCart, {
      description: 'Reparación varios',
      unitPrice: 3000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines).toEqual([
        { kind: 'freeform', description: 'Reparación varios', qty: 1, unitPrice: 3000 },
      ]);
    }
  });

  it('no fusiona dos líneas libres con la misma descripción', () => {
    const first = addFreeformLine(emptyCart, { description: 'Envío', unitPrice: 500 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = addFreeformLine(first.value, { description: 'Envío', unitPrice: 500 });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.lines).toHaveLength(2);
    }
  });

  it('rechaza descripción vacía', () => {
    const result = addFreeformLine(emptyCart, { description: '  ', unitPrice: 100 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('cart/invalid-freeform-line');
      expect(result.meta).toEqual({ field: 'description' });
    }
  });

  it('rechaza un monto no positivo', () => {
    const result = addFreeformLine(emptyCart, { description: 'Envío', unitPrice: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.meta).toEqual({ field: 'unitPrice' });
    }
  });
});

describe('removeLine', () => {
  it('quita la línea en el índice dado', () => {
    const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
    const result = removeLine(cart, 0);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines).toEqual([]);
    }
  });

  it('rechaza un índice fuera de rango', () => {
    const result = removeLine(emptyCart, 0);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('cart/line-not-found');
    }
  });
});

describe('setLineQuantity', () => {
  it('reemplaza la cantidad de una línea existente', () => {
    const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
    const result = setLineQuantity(cart, 0, 5, { product: makeProduct(), stock: makeStock() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines[0]?.qty).toBe(5);
    }
  });

  it('rechaza superar el stock disponible', () => {
    const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
    const result = setLineQuantity(cart, 0, 10, {
      product: makeProduct(),
      stock: makeStock({ quantity: 3 }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sale/insufficient-stock');
    }
  });

  it('rechaza cantidades no positivas', () => {
    const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
    const result = setLineQuantity(cart, 0, 0);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('cart/invalid-quantity');
    }
  });
});

describe('applyLineDiscount', () => {
  it('aplica un descuento por monto válido', () => {
    const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] };
    const result = applyLineDiscount(cart, 0, { type: 'amount', value: 50 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines[0]?.discount).toEqual({ type: 'amount', value: 50 });
    }
  });

  it('rechaza un descuento por monto mayor al subtotal de la línea', () => {
    const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
    const result = applyLineDiscount(cart, 0, { type: 'amount', value: 200 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('cart/invalid-discount');
    }
  });

  it('rechaza un porcentaje mayor a 100', () => {
    const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
    const result = applyLineDiscount(cart, 0, { type: 'percentage', value: 150 });

    expect(result.ok).toBe(false);
  });
});
