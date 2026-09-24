import { describe, expect, it } from 'vitest';
import { calculateLineTotal, calculateTotals } from './totals.ts';
import type { Cart } from './cart.ts';

describe('calculateTotals', () => {
  it('suma subtotal y total sobre varias líneas sin descuento', () => {
    const cart: Cart = {
      lines: [
        { kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 },
        { kind: 'freeform', description: 'Envío', qty: 1, unitPrice: 50 },
      ],
    };

    expect(calculateTotals(cart)).toEqual({
      subtotal: 250,
      discountTotal: 0,
      globalAdjustmentAmount: 0,
      total: 250,
    });
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

    expect(calculateTotals(cart)).toEqual({
      subtotal: 100,
      discountTotal: 20,
      globalAdjustmentAmount: 0,
      total: 80,
    });
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

    expect(calculateTotals(cart)).toEqual({
      subtotal: 200,
      discountTotal: 20,
      globalAdjustmentAmount: 0,
      total: 180,
    });
  });

  it('devuelve todo en 0 para un carrito vacío', () => {
    expect(calculateTotals({ lines: [] })).toEqual({
      subtotal: 0,
      discountTotal: 0,
      globalAdjustmentAmount: 0,
      total: 0,
    });
  });

  it('aplica un recargo global sobre el neto de descuentos por línea', () => {
    const cart: Cart = {
      lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }],
      globalAdjustmentPercentage: 10,
    };

    expect(calculateTotals(cart)).toEqual({
      subtotal: 100,
      discountTotal: 0,
      globalAdjustmentAmount: 10,
      total: 110,
    });
  });

  it('aplica un descuento global (porcentaje negativo)', () => {
    const cart: Cart = {
      lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }],
      globalAdjustmentPercentage: -10,
    };

    expect(calculateTotals(cart)).toEqual({
      subtotal: 100,
      discountTotal: 0,
      globalAdjustmentAmount: -10,
      total: 90,
    });
  });

  it('el recargo/descuento global se aplica después del descuento por línea', () => {
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
      globalAdjustmentPercentage: 10, // 10% de (100 - 20) = 8, no de 100
    };

    expect(calculateTotals(cart)).toEqual({
      subtotal: 100,
      discountTotal: 20,
      globalAdjustmentAmount: 8,
      total: 88,
    });
  });
});

describe('calculateLineTotal', () => {
  it('devuelve qty * unitPrice sin descuento', () => {
    expect(calculateLineTotal({ kind: 'product', productId: 'p1', qty: 3, unitPrice: 50 })).toBe(
      150,
    );
  });

  it('resta el descuento de la línea', () => {
    expect(
      calculateLineTotal({
        kind: 'freeform',
        description: 'Envío',
        qty: 1,
        unitPrice: 100,
        discount: { type: 'amount', value: 30 },
      }),
    ).toBe(70);
  });

  it('redondea cada campo a 2 decimales y el total suma lo que se ve (#99)', () => {
    const cart: Cart = {
      lines: [{ kind: 'freeform', description: 'x', qty: 0.333, unitPrice: 10 }],
      globalAdjustmentPercentage: 10,
    };
    const totals = calculateTotals(cart);
    expect(totals.subtotal).toBe(3.33);
    expect(totals.globalAdjustmentAmount).toBe(0.33);
    expect(totals.total).toBe(3.66);
  });

  it('una línea negativa con descuento porcentual devuelve menos (#99)', () => {
    expect(
      calculateLineTotal({
        kind: 'freeform',
        description: 'x',
        qty: -2,
        unitPrice: 100,
        discount: { type: 'percentage', value: 10 },
      }),
    ).toBe(-180);
  });

  it('descuento por monto sobre una línea negativa conserva el signo (#99)', () => {
    expect(
      calculateLineTotal({
        kind: 'freeform',
        description: 'x',
        qty: -1,
        unitPrice: 100,
        discount: { type: 'amount', value: 30 },
      }),
    ).toBe(-70);
  });
});
