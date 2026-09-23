import { describe, expect, it } from 'vitest';
import {
  addFreeformLine,
  addProductLine,
  adjustFreeformLineQuantity,
  applyLineDiscount,
  discardCart,
  removeLine,
  setGlobalAdjustment,
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
      qty: 1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines).toEqual([
        { kind: 'freeform', description: 'Reparación varios', qty: 1, unitPrice: 3000 },
      ]);
    }
  });

  it('el prefijo de cantidad multiplica el precio unitario', () => {
    const result = addFreeformLine(emptyCart, { description: 'Regalo', unitPrice: 100, qty: 3 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines).toEqual([
        { kind: 'freeform', description: 'Regalo', qty: 3, unitPrice: 100 },
      ]);
    }
  });

  it('no fusiona dos líneas libres con la misma descripción', () => {
    const first = addFreeformLine(emptyCart, { description: 'Envío', unitPrice: 500, qty: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = addFreeformLine(first.value, { description: 'Envío', unitPrice: 500, qty: 1 });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.lines).toHaveLength(2);
    }
  });

  it('rechaza descripción vacía', () => {
    const result = addFreeformLine(emptyCart, { description: '  ', unitPrice: 100, qty: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('cart/invalid-freeform-line');
      expect(result.meta).toEqual({ field: 'description' });
    }
  });

  it('rechaza un monto no positivo', () => {
    const result = addFreeformLine(emptyCart, { description: 'Envío', unitPrice: 0, qty: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.meta).toEqual({ field: 'unitPrice' });
    }
  });

  it('rechaza qty no positivo — crear no fusiona, así que no hay nada previo de qué restar', () => {
    const result = addFreeformLine(emptyCart, { description: 'Envío', unitPrice: 500, qty: -2 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('cart/invalid-freeform-line');
      expect(result.meta).toEqual({ field: 'qty' });
    }
  });
});

describe('adjustFreeformLineQuantity', () => {
  const cartWithFreeform: Cart = {
    lines: [{ kind: 'freeform', description: 'Regalo', qty: 2, unitPrice: 100 }],
  };

  it('suma a la línea existente identificada por descripción exacta', () => {
    const result = adjustFreeformLineQuantity(cartWithFreeform, { description: 'Regalo', qty: 3 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines).toEqual([
        { kind: 'freeform', description: 'Regalo', qty: 5, unitPrice: 100 },
      ]);
    }
  });

  it('resta de la línea existente', () => {
    const result = adjustFreeformLineQuantity(cartWithFreeform, { description: 'Regalo', qty: -1 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines).toEqual([
        { kind: 'freeform', description: 'Regalo', qty: 1, unitPrice: 100 },
      ]);
    }
  });

  it('borra la línea si la resta llega a 0', () => {
    const result = adjustFreeformLineQuantity(cartWithFreeform, { description: 'Regalo', qty: -2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines).toEqual([]);
    }
  });

  it('rechaza si no hay ninguna línea con esa descripción exacta', () => {
    const result = adjustFreeformLineQuantity(cartWithFreeform, {
      description: 'Otra cosa',
      qty: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('cart/freeform-line-not-found');
      expect(result.meta).toEqual({ description: 'Otra cosa' });
    }
  });

  it('rechaza si el resultado sería negativo', () => {
    const result = adjustFreeformLineQuantity(cartWithFreeform, { description: 'Regalo', qty: -5 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('cart/invalid-quantity');
    }
  });

  it('un match parcial (no exacto) no cuenta como identidad', () => {
    const result = adjustFreeformLineQuantity(cartWithFreeform, { description: 'Rega', qty: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('cart/freeform-line-not-found');
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

describe('setGlobalAdjustment', () => {
  const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };

  it('aplica un recargo (porcentaje positivo)', () => {
    const result = setGlobalAdjustment(cart, 10);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.globalAdjustmentPercentage).toBe(10);
    }
  });

  it('aplica un descuento (porcentaje negativo)', () => {
    const result = setGlobalAdjustment(cart, -10);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.globalAdjustmentPercentage).toBe(-10);
    }
  });

  it('reemplaza un ajuste anterior', () => {
    const withFirst = setGlobalAdjustment(cart, 10);
    if (!withFirst.ok) throw new Error('setup falló');

    const result = setGlobalAdjustment(withFirst.value, -20);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.globalAdjustmentPercentage).toBe(-20);
    }
  });

  it('0 quita el campo en vez de dejarlo en 0 explícito', () => {
    const withAdjustment = setGlobalAdjustment(cart, 15);
    if (!withAdjustment.ok) throw new Error('setup falló');

    const result = setGlobalAdjustment(withAdjustment.value, 0);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('globalAdjustmentPercentage' in result.value).toBe(false);
    }
  });

  it('rechaza un descuento mayor al 100%', () => {
    const result = setGlobalAdjustment(cart, -150);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('cart/invalid-global-adjustment');
    }
  });
});

// Bug real reportado por el usuario: cada función que muta el carrito
// devolvía `{ lines }` en vez de `{ ...cart, lines }`, perdiendo cualquier
// otro campo a nivel carrito — hoy solo `globalAdjustmentPercentage`, pero
// aplica a cualquier campo que se agregue en el futuro.
describe('el ajuste global sobrevive a cualquier otra mutación del carrito', () => {
  const cartWithAdjustment: Cart = {
    lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }],
    globalAdjustmentPercentage: 10,
  };

  it('addProductLine lo preserva', () => {
    const result = addProductLine(cartWithAdjustment, {
      product: makeProduct({ id: 'p2' }),
      stock: makeStock({ productId: 'p2' }),
      qty: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.globalAdjustmentPercentage).toBe(10);
    }
  });

  it('addFreeformLine lo preserva', () => {
    const result = addFreeformLine(cartWithAdjustment, {
      description: 'Envío',
      unitPrice: 50,
      qty: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.globalAdjustmentPercentage).toBe(10);
    }
  });

  it('adjustFreeformLineQuantity lo preserva', () => {
    const cart: Cart = {
      lines: [{ kind: 'freeform', description: 'Regalo', qty: 2, unitPrice: 100 }],
      globalAdjustmentPercentage: 10,
    };
    const result = adjustFreeformLineQuantity(cart, { description: 'Regalo', qty: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.globalAdjustmentPercentage).toBe(10);
    }
  });

  it('removeLine lo preserva', () => {
    const result = removeLine(cartWithAdjustment, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.globalAdjustmentPercentage).toBe(10);
    }
  });

  it('setLineQuantity lo preserva', () => {
    const result = setLineQuantity(cartWithAdjustment, 0, 5, {
      product: makeProduct(),
      stock: makeStock({ quantity: 100 }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.globalAdjustmentPercentage).toBe(10);
    }
  });

  it('applyLineDiscount lo preserva', () => {
    const result = applyLineDiscount(cartWithAdjustment, 0, { type: 'percentage', value: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.globalAdjustmentPercentage).toBe(10);
    }
  });
});

describe('discardCart (/DESCARTAR, Ciclo 8)', () => {
  it('devuelve un carrito vacío, sin líneas ni ajuste global', () => {
    expect(discardCart()).toEqual({ lines: [] });
  });
});
