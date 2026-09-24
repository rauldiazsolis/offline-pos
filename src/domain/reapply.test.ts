import { describe, expect, it } from 'vitest';
import type { OutboxEvent } from './outbox.ts';
import type { Sale } from './sale.ts';
import { reapplyEffects, roundAmount, roundQuantity } from './reapply.ts';

const now = '2026-09-24T10:00:00.000Z';
const envelope = { status: 'pending' as const, createdAt: now };

function sale(id: string, overrides: Partial<Sale> = {}): Sale {
  return { id, lines: [], payments: [], total: 0, status: 'closed', createdAt: now, ...overrides };
}

describe('reapplyEffects', () => {
  it('un stock-movement suma su delta al producto', () => {
    const events: OutboxEvent[] = [
      {
        ...envelope,
        id: 'm1',
        type: 'stock-movement',
        movement: {
          id: 'm1',
          productId: 'p1',
          delta: -2,
          reason: 'sale',
          saleId: 's1',
          createdAt: now,
        },
      },
      {
        ...envelope,
        id: 'm2',
        type: 'stock-movement',
        movement: {
          id: 'm2',
          productId: 'p1',
          delta: 0.5,
          reason: 'sale-void',
          saleId: 's1',
          createdAt: now,
        },
      },
    ];
    expect(reapplyEffects(events).stock).toEqual(new Map([['p1', -1.5]]));
  });

  it('una venta suma al saldo cada pago a cuenta, con o sin hold, e ignora los demás medios', () => {
    const events: OutboxEvent[] = [
      {
        ...envelope,
        id: 's1',
        type: 'sale',
        sale: sale('s1', {
          customerId: 'c1',
          payments: [
            { method: 'account', amount: 100 },
            { method: 'account', amount: 50, reference: 'hold-1' },
            { method: 'cash', amount: 30 },
          ],
        }),
      },
    ];
    const effects = reapplyEffects(events);
    expect(effects.balance).toEqual(new Map([['c1', 150]]));
    expect(effects.stock.size).toBe(0);
  });

  it('una venta sin cliente no mueve ningún saldo', () => {
    const events: OutboxEvent[] = [{ ...envelope, id: 's1', type: 'sale', sale: sale('s1') }];
    expect(reapplyEffects(events).balance.size).toBe(0);
  });

  it('una cobranza resta su total del saldo del cliente', () => {
    const events: OutboxEvent[] = [
      {
        ...envelope,
        id: 'cp1',
        type: 'customer-payment',
        payment: {
          id: 'cp1',
          customerId: 'c1',
          payments: [{ method: 'cash', amount: 40 }],
          total: 40,
          createdAt: now,
        },
      },
    ];
    expect(reapplyEffects(events).balance).toEqual(new Map([['c1', -40]]));
  });

  it('anulación, cliente, holds y movimientos de caja no mueven stock ni saldo', () => {
    const events: OutboxEvent[] = [
      { ...envelope, id: 'v1', type: 'sale-void', saleId: 's1', voidedAt: now },
      {
        ...envelope,
        id: 'c1',
        type: 'customer',
        customer: { id: 'c1', name: 'Ana', createdAt: now },
      },
      { ...envelope, id: 'h1', type: 'account-hold-confirm', holdId: 'hold-1', saleId: 's1' },
      { ...envelope, id: 'h2', type: 'account-hold-release', holdId: 'hold-2' },
      {
        ...envelope,
        id: 'cm1',
        type: 'cash-movement',
        movement: {
          id: 'cm1',
          direction: 'in',
          amount: 10,
          concept: 'x',
          source: 'manual',
          createdAt: now,
        },
      },
    ];
    const effects = reapplyEffects(events);
    expect(effects.stock.size).toBe(0);
    expect(effects.balance.size).toBe(0);
  });

  it('un evento repetido (mismo id) cuenta una sola vez', () => {
    const movement: OutboxEvent = {
      ...envelope,
      id: 'm1',
      type: 'stock-movement',
      movement: { id: 'm1', productId: 'p1', delta: -1, reason: 'sale', createdAt: now },
    };
    expect(reapplyEffects([movement, { ...movement, status: 'synced' }]).stock).toEqual(
      new Map([['p1', -1]]),
    );
  });

  it('redondea cantidades a 3 decimales e importes a 2', () => {
    const events: OutboxEvent[] = [
      {
        ...envelope,
        id: 'm1',
        type: 'stock-movement',
        movement: { id: 'm1', productId: 'p1', delta: 0.1, reason: 'sale', createdAt: now },
      },
      {
        ...envelope,
        id: 'm2',
        type: 'stock-movement',
        movement: { id: 'm2', productId: 'p1', delta: 0.2, reason: 'sale', createdAt: now },
      },
      {
        ...envelope,
        id: 's1',
        type: 'sale',
        sale: sale('s1', {
          customerId: 'c1',
          payments: [
            { method: 'account', amount: 0.1 },
            { method: 'account', amount: 0.2 },
          ],
        }),
      },
    ];
    const effects = reapplyEffects(events);
    expect(effects.stock.get('p1')).toBe(0.3);
    expect(effects.balance.get('c1')).toBe(0.3);
    expect(roundQuantity(1.23456)).toBe(1.235);
    expect(roundAmount(1.005 + 0.001)).toBe(1.01);
  });
});
