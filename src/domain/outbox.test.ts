import { describe, expect, it } from 'vitest';
import {
  buildOutboxEventForSale,
  buildOutboxEventForVoid,
  buildOutboxEventsForStockMovements,
  isDue,
  isSyncStruggling,
  markFailed,
  markSynced,
  nextRetryDelayMs,
  SYNC_ERROR_RETRY_THRESHOLD,
  type OutboxEvent,
} from './outbox.ts';
import type { Sale } from './sale.ts';
import type { StockMovement } from './stock.ts';

const sale: Sale = {
  id: 'sale-1',
  lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }],
  payments: [{ method: 'cash', amount: 100 }],
  total: 100,
  status: 'closed',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const movement: StockMovement = {
  id: 'm1',
  productId: 'p1',
  delta: -1,
  reason: 'sale',
  saleId: 'sale-1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('nextRetryDelayMs', () => {
  it('crece exponencialmente con un techo', () => {
    expect(nextRetryDelayMs(0)).toBe(1000);
    expect(nextRetryDelayMs(1)).toBe(2000);
    expect(nextRetryDelayMs(2)).toBe(4000);
    expect(nextRetryDelayMs(20)).toBe(5 * 60 * 1000);
  });
});

describe('buildOutboxEventForSale', () => {
  it('usa el id de la venta como id del evento (Idempotency-Key)', () => {
    const event = buildOutboxEventForSale(sale, { now: '2026-01-01T00:00:00.000Z' });

    expect(event).toEqual({
      type: 'sale',
      sale,
      id: 'sale-1',
      status: 'pending',
      retries: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      nextAttemptAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('buildOutboxEventsForStockMovements', () => {
  it('genera un evento por movimiento, usando el id del movimiento', () => {
    const events = buildOutboxEventsForStockMovements([movement], {
      now: '2026-01-01T00:00:00.000Z',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'stock-movement',
      movement,
      id: 'm1',
      status: 'pending',
    });
  });
});

describe('buildOutboxEventForVoid', () => {
  it('usa un id propio, distinto del id de la venta', () => {
    const event = buildOutboxEventForVoid({
      id: 'void-event-1',
      saleId: 'sale-1',
      voidedAt: '2026-01-02T00:00:00.000Z',
      voidReason: 'error de cobro',
      now: '2026-01-02T00:00:00.000Z',
    });

    expect(event.id).toBe('void-event-1');
    expect(event.id).not.toBe('sale-1');
    expect(event).toMatchObject({
      type: 'sale-void',
      saleId: 'sale-1',
      voidReason: 'error de cobro',
    });
  });

  it('omite voidReason si no se pasa (nunca undefined explícito)', () => {
    const event = buildOutboxEventForVoid({
      id: 'void-event-1',
      saleId: 'sale-1',
      voidedAt: '2026-01-02T00:00:00.000Z',
      now: '2026-01-02T00:00:00.000Z',
    });

    expect('voidReason' in event).toBe(false);
  });
});

describe('markSynced / markFailed', () => {
  const pendingEvent: OutboxEvent = buildOutboxEventForSale(sale, {
    now: '2026-01-01T00:00:00.000Z',
  });

  it('markSynced pasa el status a synced sin tocar el resto', () => {
    const synced = markSynced(pendingEvent);
    expect(synced.status).toBe('synced');
    expect(synced.retries).toBe(0);
  });

  it('markFailed suma un reintento y calcula el próximo intento con backoff', () => {
    const failed = markFailed(pendingEvent, {
      now: '2026-01-01T00:00:00.000Z',
      error: 'network error',
    });

    expect(failed.retries).toBe(1);
    expect(failed.lastError).toBe('network error');
    expect(failed.nextAttemptAt).toBe('2026-01-01T00:00:02.000Z'); // +2000ms (retries=1)
  });
});

describe('isDue', () => {
  it('true para un evento pendiente cuyo nextAttemptAt ya pasó', () => {
    const event = buildOutboxEventForSale(sale, { now: '2026-01-01T00:00:00.000Z' });
    expect(isDue(event, '2026-01-01T00:00:01.000Z')).toBe(true);
  });

  it('false para un evento pendiente cuyo nextAttemptAt es futuro', () => {
    const event = markFailed(buildOutboxEventForSale(sale, { now: '2026-01-01T00:00:00.000Z' }), {
      now: '2026-01-01T00:00:00.000Z',
      error: 'x',
    });
    expect(isDue(event, '2026-01-01T00:00:00.500Z')).toBe(false);
  });

  it('false para un evento ya sincronizado', () => {
    const event = markSynced(buildOutboxEventForSale(sale, { now: '2026-01-01T00:00:00.000Z' }));
    expect(isDue(event, '2026-01-01T01:00:00.000Z')).toBe(false);
  });
});

describe('isSyncStruggling', () => {
  it('false si ningún evento pendiente superó el umbral de reintentos', () => {
    const event = buildOutboxEventForSale(sale, { now: '2026-01-01T00:00:00.000Z' });
    expect(isSyncStruggling([event])).toBe(false);
  });

  it('true si algún evento pendiente llegó al umbral de reintentos', () => {
    let event = buildOutboxEventForSale(sale, { now: '2026-01-01T00:00:00.000Z' });
    for (let i = 0; i < SYNC_ERROR_RETRY_THRESHOLD; i++) {
      event = markFailed(event, { now: '2026-01-01T00:00:00.000Z', error: 'x' });
    }
    expect(isSyncStruggling([event])).toBe(true);
  });

  it('ignora eventos ya sincronizados', () => {
    let event = buildOutboxEventForSale(sale, { now: '2026-01-01T00:00:00.000Z' });
    for (let i = 0; i < SYNC_ERROR_RETRY_THRESHOLD; i++) {
      event = markFailed(event, { now: '2026-01-01T00:00:00.000Z', error: 'x' });
    }
    expect(isSyncStruggling([markSynced(event)])).toBe(false);
  });
});
