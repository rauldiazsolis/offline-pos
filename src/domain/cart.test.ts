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

describe('addProductLine', () => {
  it('agrega una línea nueva para un producto no presente en el carrito', () => {
    const result = addProductLine(emptyCart, {
      product: makeProduct(),
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
    const result = addProductLine(cart, { product: makeProduct(), qty: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines[0]?.qty).toBe(3);
    }
  });

  it('resta cantidad con qty negativo y elimina la línea si llega a 0', () => {
    const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] };
    const result = addProductLine(cart, { product: makeProduct(), qty: -2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines).toEqual([]);
    }
  });

  it('nunca bloquea por stock, trackee o no (#99)', () => {
    const result = addProductLine(emptyCart, {
      product: makeProduct({ tracksStock: false }),
      qty: 1000,
    });

    expect(result.ok).toBe(true);
  });

  it('rechaza qty en 0', () => {
    const result = addProductLine(emptyCart, {
      product: makeProduct(),
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

  it('rechaza qty 0 o con más de 3 decimales', () => {
    const zero = addFreeformLine(emptyCart, { description: 'Envío', unitPrice: 500, qty: 0 });
    expect(zero).toMatchObject({
      ok: false,
      error: 'cart/invalid-freeform-line',
      meta: { field: 'qty' },
    });
    const tooPrecise = addFreeformLine(emptyCart, {
      description: 'Envío',
      unitPrice: 500,
      qty: 1.2345,
    });
    expect(tooPrecise.ok).toBe(false);
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
    const result = setLineQuantity(cart, 0, 5);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines[0]?.qty).toBe(5);
    }
  });

  it('rechaza más de 3 decimales', () => {
    const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
    const result = setLineQuantity(cart, 0, 1.2345);

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
    const result = setLineQuantity(cartWithAdjustment, 0, 5);
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

describe('cantidades decimales y negativas (#99)', () => {
  const product = makeProduct({ name: 'Queso', price: 1000 });

  it('suma neta con decimales', () => {
    const r1 = addProductLine(emptyCart, { product, qty: 0.1 });
    if (!r1.ok) throw new Error('esperaba ok');
    const r2 = addProductLine(r1.value, { product, qty: 0.2 });
    expect(r2.ok && r2.value.lines[0]?.qty).toBe(0.3);
  });

  it('crea la línea en negativo sin línea previa', () => {
    const r = addProductLine(emptyCart, { product, qty: -2 });
    expect(r.ok && r.value.lines[0]?.qty).toBe(-2);
  });

  it('puede dejar la línea en negativo y la borra en 0 exacto', () => {
    const r1 = addProductLine(emptyCart, { product, qty: 1 });
    if (!r1.ok) throw new Error('esperaba ok');
    const r2 = addProductLine(r1.value, { product, qty: -3 });
    expect(r2.ok && r2.value.lines[0]?.qty).toBe(-2);
    const r3 = addProductLine(r1.value, { product, qty: -1 });
    expect(r3.ok && r3.value.lines).toEqual([]);
  });

  it('nunca bloquea por stock', () => {
    expect(addProductLine(emptyCart, { product, qty: 999 }).ok).toBe(true);
  });

  it('rechaza más de 3 decimales y 0', () => {
    expect(addProductLine(emptyCart, { product, qty: 1.2345 }).ok).toBe(false);
    expect(addProductLine(emptyCart, { product, qty: 0 }).ok).toBe(false);
  });

  it('línea libre con cantidad negativa', () => {
    const r = addFreeformLine(emptyCart, { description: 'regalo', unitPrice: 100, qty: -1 });
    expect(r.ok && r.value.lines[0]?.qty).toBe(-1);
  });

  it('ajuste de línea libre puede quedar negativo', () => {
    const r1 = addFreeformLine(emptyCart, { description: 'regalo', unitPrice: 100, qty: 1 });
    if (!r1.ok) throw new Error('esperaba ok');
    const r2 = adjustFreeformLineQuantity(r1.value, { description: 'regalo', qty: -2 });
    expect(r2.ok && r2.value.lines[0]?.qty).toBe(-1);
  });

  it('setLineQuantity acepta decimales y negativos, y 0 borra', () => {
    const r1 = addProductLine(emptyCart, { product, qty: 1 });
    if (!r1.ok) throw new Error('esperaba ok');
    expect(setLineQuantity(r1.value, 0, -1.5)).toMatchObject({
      ok: true,
      value: { lines: [{ qty: -1.5 }] },
    });
    const r3 = setLineQuantity(r1.value, 0, 0);
    expect(r3.ok && r3.value.lines).toEqual([]);
  });

  it('un descuento por monto se valida contra el valor absoluto de la línea', () => {
    const cart: Cart = { lines: [{ kind: 'freeform', description: 'x', qty: -2, unitPrice: 100 }] };
    expect(applyLineDiscount(cart, 0, { type: 'amount', value: 150 }).ok).toBe(true);
    expect(applyLineDiscount(cart, 0, { type: 'amount', value: 250 }).ok).toBe(false);
  });
});
