import { describe, expect, it } from 'vitest';
import type { Cart } from './cart.ts';
import { buildStockMovementsForSale, closeSale, voidSale } from './sale-lifecycle.ts';
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

describe('voidSale', () => {
  it('anula una venta cerrada sin tocar sus datos originales', () => {
    const result = voidSale(closedSale, {
      now: '2026-01-02T00:00:00.000Z',
      reason: 'error de cobro',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('voided');
      expect(result.value.voidedAt).toBe('2026-01-02T00:00:00.000Z');
      expect(result.value.voidReason).toBe('error de cobro');
      expect(result.value.lines).toBe(closedSale.lines);
      expect(result.value.total).toBe(closedSale.total);
      expect(result.value.createdAt).toBe(closedSale.createdAt);
    }
  });

  it('rechaza anular una venta ya anulada', () => {
    const voided: Sale = { ...closedSale, status: 'voided', voidedAt: '2026-01-02T00:00:00.000Z' };
    const result = voidSale(voided, { now: '2026-01-03T00:00:00.000Z' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sale/already-voided');
    }
  });

  it('rechaza anular una venta que no está cerrada', () => {
    const open: Sale = { ...closedSale, status: 'open' };
    const result = voidSale(open, { now: '2026-01-03T00:00:00.000Z' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sale/not-closed');
      expect(result.meta).toEqual({ status: 'open' });
    }
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

  it('genera un movimiento positivo al anular', () => {
    const movements = buildStockMovementsForSale(closedSale, {
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
