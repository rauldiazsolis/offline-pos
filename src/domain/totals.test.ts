import { describe, expect, it } from 'vitest';
import { calculateTotals } from './totals.ts';
import type { Cart } from './cart.ts';

describe('calculateTotals', () => {
  it('suma subtotal y total sobre varias líneas sin descuento', () => {
    const cart: Cart = {
      lines: [
        { kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 },
        { kind: 'freeform', description: 'Envío', qty: 1, unitPrice: 50 },
      ],
    };

    expect(calculateTotals(cart)).toEqual({ subtotal: 250, discountTotal: 0, total: 250 });
  });

  it('aplica un descuento por monto a una línea', () => {
    const cart: Cart = {
      lines: [
        {
          kind: 'product',
          productId: 'p1',
          qty: 1,
          unitPrice: 100,
          discount: { type: 'amount', value: 20 },
        },
      ],
    };

    expect(calculateTotals(cart)).toEqual({ subtotal: 100, discountTotal: 20, total: 80 });
  });

  it('aplica un descuento por porcentaje a una línea', () => {
    const cart: Cart = {
      lines: [
        {
          kind: 'product',
          productId: 'p1',
          qty: 2,
          unitPrice: 100,
          discount: { type: 'percentage', value: 10 },
        },
      ],
    };

    expect(calculateTotals(cart)).toEqual({ subtotal: 200, discountTotal: 20, total: 180 });
  });

  it('devuelve todo en 0 para un carrito vacío', () => {
    expect(calculateTotals({ lines: [] })).toEqual({ subtotal: 0, discountTotal: 0, total: 0 });
  });
});
