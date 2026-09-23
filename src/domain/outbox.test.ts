import { describe, expect, it } from 'vitest';
import type { Sale } from './sale.ts';
import {
  buildOutboxEventForCashSession,
  buildOutboxEventForCustomer,
  buildOutboxEventForHoldConfirm,
  buildOutboxEventForHoldRelease,
  buildOutboxEventForSale,
  buildOutboxEventForVoid,
  buildOutboxEventsForStockMovements,
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

describe('buildOutboxEventForSale', () => {
  it('arranca pending, con el id de la venta como id del evento', () => {
    const event = buildOutboxEventForSale(sale, { now });
    expect(event).toEqual({ type: 'sale', sale, id: 'sale-1', status: 'pending', createdAt: now });
  });
});

describe('buildOutboxEventsForStockMovements', () => {
  it('un evento por movimiento, cada uno con el id del movimiento', () => {
    const movements = [
      { id: 'm1', productId: 'p1', delta: -1, reason: 'sale' as const, saleId: 'sale-1', createdAt: now },
      { id: 'm2', productId: 'p2', delta: -2, reason: 'sale' as const, saleId: 'sale-1', createdAt: now },
    ];
    const events = buildOutboxEventsForStockMovements(movements, { now });
    expect(events.map((e) => e.id)).toEqual(['m1', 'm2']);
    expect(events[0]).toMatchObject({ type: 'stock-movement', status: 'pending' });
  });
});

describe('buildOutboxEventForVoid', () => {
  it('id propio, distinto del id de la venta anulada', () => {
    const event = buildOutboxEventForVoid({
      id: 'void-1',
      saleId: 'sale-1',
      voidedAt: now,
      voidReason: 'error de cobro',
      now,
    });
    expect(event).toEqual({
      type: 'sale-void',
      saleId: 'sale-1',
      voidedAt: now,
      voidReason: 'error de cobro',
      id: 'void-1',
      status: 'pending',
      createdAt: now,
    });
  });

  it('omite voidReason si no se pasa (nunca undefined explícito)', () => {
    const event = buildOutboxEventForVoid({ id: 'void-1', saleId: 'sale-1', voidedAt: now, now });
    expect('voidReason' in event).toBe(false);
  });
});

describe('buildOutboxEventForCustomer', () => {
  it('id del cliente como id del evento', () => {
    const customer = { id: 'c1', name: 'Juan Pérez', createdAt: now };
    expect(buildOutboxEventForCustomer(customer, { now })).toEqual({
      type: 'customer',
      customer,
      id: 'c1',
      status: 'pending',
      createdAt: now,
    });
  });
});

describe('buildOutboxEventForHoldConfirm / HoldRelease', () => {
  it('confirm lleva holdId y saleId, con id propio', () => {
    const event = buildOutboxEventForHoldConfirm({ id: 'confirm-1', holdId: 'hold-1', saleId: 'sale-1', now });
    expect(event).toEqual({
      type: 'account-hold-confirm',
      holdId: 'hold-1',
      saleId: 'sale-1',
      id: 'confirm-1',
      status: 'pending',
      createdAt: now,
    });
  });

  it('release lleva holdId, con id propio', () => {
    const event = buildOutboxEventForHoldRelease({ id: 'release-1', holdId: 'hold-1', now });
    expect(event).toEqual({
      type: 'account-hold-release',
      holdId: 'hold-1',
      id: 'release-1',
      status: 'pending',
      createdAt: now,
    });
  });
});

describe('buildOutboxEventForCashSession', () => {
  it('id del turno como id del evento', () => {
    const session = { id: 'cs1', openedAt: now, openingAmount: 500, sales: ['s1'] };
    expect(buildOutboxEventForCashSession(session, { now })).toEqual({
      type: 'cash-session',
      session,
      id: 'cs1',
      status: 'pending',
      createdAt: now,
    });
  });
});

describe('markSynced', () => {
  it('pasa el evento a synced sin tocar el resto de los campos', () => {
    const event = buildOutboxEventForSale(sale, { now });
    expect(markSynced(event)).toEqual({ ...event, status: 'synced' });
  });
});
