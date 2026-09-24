import { describe, expect, it } from 'vitest';
import type { Cart } from './cart.ts';
import {
  buildStockMovementsForSale,
  buildVoidSale,
  closeSale,
  isVoided,
  isWithinVoidWindow,
} from './sale-lifecycle.ts';
import type { Sale } from './sale.ts';

const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] };

describe('closeSale', () => {
  it('cierra una venta cuando los pagos cubren el total', () => {
    const result = closeSale({
      cart,
      payments: [{ method: 'cash', amount: 200 }],
      id: 'sale-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        id: 'sale-1',
        lines: cart.lines,
        payments: [{ method: 'cash', amount: 200 }],
        total: 200,
        status: 'closed',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    }
  });

  it('permite pagar de más (vuelto en efectivo)', () => {
    const result = closeSale({
      cart,
      payments: [{ method: 'cash', amount: 500 }],
      id: 'sale-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
  });

  it('rechaza un carrito vacío', () => {
    const result = closeSale({
      cart: { lines: [] },
      payments: [],
      id: 'sale-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sale/empty-cart');
    }
  });

  it('rechaza un pago insuficiente', () => {
    const result = closeSale({
      cart,
      payments: [{ method: 'cash', amount: 100 }],
      id: 'sale-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sale/insufficient-payment');
      expect(result.meta).toEqual({ total: 200, paid: 100 });
    }
  });

  it('rechaza un monto de pago no positivo', () => {
    const result = closeSale({
      cart,
      payments: [{ method: 'cash', amount: 0 }],
      id: 'sale-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sale/invalid-payment-amount');
    }
  });

  it('rechaza un pago a cuenta corriente sin cliente adjunto', () => {
    const result = closeSale({
      cart,
      payments: [{ method: 'account', amount: 200 }],
      id: 'sale-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('account/no-customer-attached');
    }
  });

  it('copia el recargo/descuento global al Sale y exige pago contra el total ajustado', () => {
    const cartWithAdjustment: Cart = { ...cart, globalAdjustmentPercentage: 10 }; // total: 220

    const rejected = closeSale({
      cart: cartWithAdjustment,
      payments: [{ method: 'cash', amount: 200 }], // cubre el subtotal, no el total ajustado
      id: 'sale-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(rejected.ok).toBe(false);

    const accepted = closeSale({
      cart: cartWithAdjustment,
      payments: [{ method: 'cash', amount: 220 }],
      id: 'sale-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.value.globalAdjustmentPercentage).toBe(10);
      expect(accepted.value.total).toBe(220);
    }
  });

  it('acepta un pago a cuenta corriente con cliente adjunto y guarda el customerId', () => {
    const result = closeSale({
      cart,
      payments: [{ method: 'account', amount: 200, reference: 'hold-1' }],
      id: 'sale-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      customerId: 'c1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.customerId).toBe('c1');
    }
  });
});

const closedSale: Sale = {
  id: 'sale-1',
  lines: cart.lines,
  payments: [{ method: 'cash', amount: 200 }],
  total: 200,
  status: 'closed',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('buildVoidSale (#99)', () => {
  const original: Sale = {
    id: 'S1',
    status: 'closed',
    createdAt: '2026-09-24T10:00:00.000Z',
    total: 250,
    customerId: 'C1',
    globalAdjustmentPercentage: -10,
    lines: [
      {
        kind: 'product',
        productId: 'p1',
        qty: 2,
        unitPrice: 100,
        discount: { type: 'amount', value: 10 },
      },
    ],
    payments: [
      { method: 'account', amount: 150, reference: 'H1' },
      { method: 'cash', amount: 100 },
    ],
  };

  it('arma un ticket negativo con referencia al original', () => {
    const r = buildVoidSale(original, {
      id: 'V1',
      now: '2026-09-24T12:00:00.000Z',
      reason: 'error',
      isAlreadyVoided: false,
    });
    expect(r).toEqual({
      ok: true,
      value: {
        id: 'V1',
        status: 'closed',
        createdAt: '2026-09-24T12:00:00.000Z',
        total: -250,
        customerId: 'C1',
        globalAdjustmentPercentage: -10,
        voidsSaleId: 'S1',
        voidReason: 'error',
        lines: [
          {
            kind: 'product',
            productId: 'p1',
            qty: -2,
            unitPrice: 100,
            discount: { type: 'amount', value: 10 },
          },
        ],
        payments: [
          { method: 'account', amount: -150 },
          { method: 'cash', amount: -100 },
        ],
      },
    });
  });

  it('rechaza anular dos veces, una anulación, o fuera de las 24 h', () => {
    const now = '2026-09-24T12:00:00.000Z';
    expect(buildVoidSale(original, { id: 'V', now, isAlreadyVoided: true })).toMatchObject({
      ok: false,
      error: 'sale/already-voided',
    });
    expect(
      buildVoidSale({ ...original, status: 'voided' }, { id: 'V', now, isAlreadyVoided: false }),
    ).toMatchObject({ ok: false, error: 'sale/already-voided' });
    expect(
      buildVoidSale({ ...original, voidsSaleId: 'S0' }, { id: 'V', now, isAlreadyVoided: false }),
    ).toMatchObject({ ok: false, error: 'sale/cannot-void-a-void' });
    expect(
      buildVoidSale(original, {
        id: 'V',
        now: '2026-09-25T10:00:00.000Z',
        isAlreadyVoided: false,
      }),
    ).toMatchObject({ ok: false, error: 'sale/void-window-expired' });
  });

  it('una devolución común (negativa, sin voidsSaleId) se anula con un ticket positivo', () => {
    const refund: Sale = {
      ...original,
      total: -100,
      payments: [{ method: 'cash', amount: -100 }],
      lines: [{ kind: 'freeform', description: 'dev', qty: -1, unitPrice: 100 }],
    };
    const r = buildVoidSale(refund, {
      id: 'V',
      now: '2026-09-24T12:00:00.000Z',
      isAlreadyVoided: false,
    });
    expect(r.ok && r.value.total).toBe(100);
  });

  it('ventana de 24 h móviles: 23:59 se anula a las 00:01', () => {
    expect(
      isWithinVoidWindow({ createdAt: '2026-09-24T23:59:00.000Z' }, '2026-09-25T00:01:00.000Z'),
    ).toBe(true);
    expect(
      isWithinVoidWindow({ createdAt: '2026-09-24T10:00:00.000Z' }, '2026-09-25T10:00:00.000Z'),
    ).toBe(false);
  });

  it('isVoided con el status legado o con una anulación', () => {
    expect(isVoided({ id: 'S1', status: 'voided' }, new Set())).toBe(true);
    expect(isVoided({ id: 'S1', status: 'closed' }, new Set(['S1']))).toBe(true);
    expect(isVoided({ id: 'S1', status: 'closed' }, new Set())).toBe(false);
  });
});

describe('buildStockMovementsForSale', () => {
  it('genera un movimiento negativo por línea de producto trackeado al vender', () => {
    let counter = 0;
    const movements = buildStockMovementsForSale(closedSale, {
      reason: 'sale',
      now: '2026-01-01T00:00:00.000Z',
      newMovementId: () => `m${String(++counter)}`,
      trackedProductIds: new Set(['p1']),
    });

    expect(movements).toEqual([
      {
        id: 'm1',
        productId: 'p1',
        delta: -2,
        reason: 'sale',
        saleId: 'sale-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('una línea negativa (el ticket de una anulación) genera un movimiento positivo', () => {
    const voidTicket: Sale = {
      ...closedSale,
      lines: closedSale.lines.map((line) => ({ ...line, qty: -line.qty })),
    };
    const movements = buildStockMovementsForSale(voidTicket, {
      reason: 'sale-void',
      now: '2026-01-02T00:00:00.000Z',
      newMovementId: () => 'm1',
      trackedProductIds: new Set(['p1']),
    });

    expect(movements[0]?.delta).toBe(2);
  });

  it('ignora líneas de productos que no trackean stock', () => {
    const movements = buildStockMovementsForSale(closedSale, {
      reason: 'sale',
      now: '2026-01-01T00:00:00.000Z',
      newMovementId: () => 'm1',
      trackedProductIds: new Set(),
    });

    expect(movements).toEqual([]);
  });

  it('ignora líneas libres', () => {
    const saleWithFreeform: Sale = {
      ...closedSale,
      lines: [{ kind: 'freeform', description: 'Envío', qty: 1, unitPrice: 50 }],
    };
    const movements = buildStockMovementsForSale(saleWithFreeform, {
      reason: 'sale',
      now: '2026-01-01T00:00:00.000Z',
      newMovementId: () => 'm1',
      trackedProductIds: new Set(['p1']),
    });

    expect(movements).toEqual([]);
  });
});

describe('closeSale con total 0 o negativo (#99)', () => {
  it('cierra un ticket negativo con pagos negativos que suman exacto', () => {
    const cart = {
      lines: [{ kind: 'freeform' as const, description: 'dev', qty: -1, unitPrice: 500 }],
    };
    const r = closeSale({
      cart,
      payments: [{ method: 'cash', amount: -500 }],
      id: 's1',
      createdAt: 'now',
    });
    expect(r.ok && r.value.total).toBe(-500);
  });

  it('rechaza un pago con signo distinto al total', () => {
    const cart = {
      lines: [{ kind: 'freeform' as const, description: 'dev', qty: -1, unitPrice: 500 }],
    };
    const r = closeSale({
      cart,
      payments: [{ method: 'cash', amount: 500 }],
      id: 's1',
      createdAt: 'now',
    });
    expect(r).toMatchObject({ ok: false, error: 'sale/invalid-payment-amount' });
  });

  it('rechaza pagos negativos que no suman exactamente el total', () => {
    const cart = {
      lines: [{ kind: 'freeform' as const, description: 'dev', qty: -1, unitPrice: 500 }],
    };
    const r = closeSale({
      cart,
      payments: [{ method: 'cash', amount: -400 }],
      id: 's1',
      createdAt: 'now',
    });
    expect(r).toMatchObject({ ok: false, error: 'sale/refund-amount-mismatch' });
  });

  it('cierra un ticket en 0 sin pagos y rechaza uno con pagos', () => {
    const cart = {
      lines: [
        { kind: 'freeform' as const, description: 'a', qty: 1, unitPrice: 100 },
        { kind: 'freeform' as const, description: 'b', qty: -1, unitPrice: 100 },
      ],
    };
    expect(closeSale({ cart, payments: [], id: 's1', createdAt: 'now' }).ok).toBe(true);
    expect(
      closeSale({ cart, payments: [{ method: 'cash', amount: 10 }], id: 's1', createdAt: 'now' }),
    ).toMatchObject({ ok: false, error: 'sale/invalid-payment-amount' });
  });
});
