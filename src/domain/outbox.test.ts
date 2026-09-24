import { describe, expect, it } from 'vitest';
import type { Sale } from './sale.ts';
import {
  buildOutboxEventForCashMovement,
  buildOutboxEventForCustomer,
  buildOutboxEventForCustomerPayment,
  buildOutboxEventForHoldConfirm,
  buildOutboxEventForHoldRelease,
  buildOutboxEventForSale,
  buildOutboxEventsForStockMovements,
  isLegacyOutboxType,
  markSynced,
} from './outbox.ts';

const sale: Sale = {
  id: 'sale-1',
  lines: [],
  payments: [],
  total: 0,
  status: 'closed',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const now = '2026-01-01T00:00:00.000Z';
const origin = { branch: 'Centro', pointOfSale: 'Caja 1' };

describe('buildOutboxEventForSale', () => {
  it('arranca pending, con el id de la venta como id del evento', () => {
    const event = buildOutboxEventForSale(sale, { now, origin });
    expect(event).toEqual({
      type: 'sale',
      sale,
      id: 'sale-1',
      status: 'pending',
      createdAt: now,
      origin,
    });
  });
});

describe('buildOutboxEventsForStockMovements', () => {
  it('un evento por movimiento, cada uno con el id del movimiento', () => {
    const movements = [
      {
        id: 'm1',
        productId: 'p1',
        delta: -1,
        reason: 'sale' as const,
        saleId: 'sale-1',
        createdAt: now,
      },
      {
        id: 'm2',
        productId: 'p2',
        delta: -2,
        reason: 'sale' as const,
        saleId: 'sale-1',
        createdAt: now,
      },
    ];
    const events = buildOutboxEventsForStockMovements(movements, { now, origin });
    expect(events.map((e) => e.id)).toEqual(['m1', 'm2']);
    expect(events[0]).toMatchObject({ type: 'stock-movement', status: 'pending' });
  });
});

describe('buildOutboxEventForCustomer', () => {
  it('id del cliente como id del evento', () => {
    const customer = { id: 'c1', name: 'Juan Pérez', createdAt: now };
    expect(buildOutboxEventForCustomer(customer, { now, origin })).toEqual({
      type: 'customer',
      customer,
      id: 'c1',
      status: 'pending',
      createdAt: now,
      origin,
    });
  });
});

describe('buildOutboxEventForHoldConfirm / HoldRelease', () => {
  it('confirm lleva holdId y saleId, con id propio', () => {
    const event = buildOutboxEventForHoldConfirm({
      id: 'confirm-1',
      holdId: 'hold-1',
      saleId: 'sale-1',
      now,
      origin,
    });
    expect(event).toEqual({
      type: 'account-hold-confirm',
      holdId: 'hold-1',
      saleId: 'sale-1',
      id: 'confirm-1',
      status: 'pending',
      createdAt: now,
      origin,
    });
  });

  it('release lleva holdId, con id propio', () => {
    const event = buildOutboxEventForHoldRelease({
      id: 'release-1',
      holdId: 'hold-1',
      now,
      origin,
    });
    expect(event).toEqual({
      type: 'account-hold-release',
      holdId: 'hold-1',
      id: 'release-1',
      status: 'pending',
      createdAt: now,
      origin,
    });
  });
});

describe('origen y eventos nuevos (contrato v3)', () => {
  it('estampa el origen recibido en el evento', () => {
    const event = buildOutboxEventForSale(sale, { now, origin });
    expect(event.origin).toEqual(origin);
  });

  it('movimiento de caja: el id del evento es el del movimiento', () => {
    const movement = {
      id: 'm1',
      direction: 'out',
      amount: 50,
      concept: 'Flete',
      source: 'manual',
      createdAt: now,
    } as const;
    expect(buildOutboxEventForCashMovement(movement, { now, origin })).toEqual({
      type: 'cash-movement',
      movement,
      id: 'm1',
      status: 'pending',
      createdAt: now,
      origin,
    });
  });

  it('cobranza: el id del evento es el de la cobranza', () => {
    const payment = {
      id: 'cp1',
      customerId: 'c1',
      payments: [{ method: 'cash' as const, amount: 10 }],
      total: 10,
      createdAt: now,
    };
    expect(buildOutboxEventForCustomerPayment(payment, { now, origin })).toMatchObject({
      type: 'customer-payment',
      id: 'cp1',
      origin,
    });
  });

  it('cash-session y sale-void son tipos legados', () => {
    expect(isLegacyOutboxType('cash-session')).toBe(true);
    expect(isLegacyOutboxType('sale-void')).toBe(true);
    expect(isLegacyOutboxType('sale')).toBe(false);
  });
});

describe('markSynced', () => {
  it('pasa el evento a synced sin tocar el resto de los campos', () => {
    const event = buildOutboxEventForSale(sale, { now, origin });
    expect(markSynced(event)).toEqual({ ...event, status: 'synced' });
  });
});
