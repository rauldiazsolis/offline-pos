import { describe, expect, it } from 'vitest';
import {
  buildPushLot,
  isLotDue,
  isPushStruggling,
  markLotFailed,
  nextRetryDelayMs,
  PUSH_ERROR_RETRY_THRESHOLD,
} from './push-lot.ts';

describe('nextRetryDelayMs', () => {
  it('backoff exponencial con techo de 5 minutos', () => {
    expect(nextRetryDelayMs(0)).toBe(1000);
    expect(nextRetryDelayMs(1)).toBe(2000);
    expect(nextRetryDelayMs(2)).toBe(4000);
    expect(nextRetryDelayMs(20)).toBe(5 * 60 * 1000);
  });
});

describe('buildPushLot', () => {
  it('arranca en retries=0 y nextAttemptAt=now, con el id y los eventIds congelados', () => {
    const lot = buildPushLot(['e1', 'e2'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' });
    expect(lot).toEqual({
      id: 'lot-1',
      eventIds: ['e1', 'e2'],
      createdAt: '2026-01-01T00:00:00.000Z',
      retries: 0,
      nextAttemptAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('markLotFailed', () => {
  it('suma un reintento, guarda el error y calcula el próximo intento con backoff', () => {
    const lot = buildPushLot(['e1'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' });

    const failed = markLotFailed(lot, {
      now: '2026-01-01T00:00:00.000Z',
      error: 'sync/request-failed',
    });

    expect(failed.retries).toBe(1);
    expect(failed.lastError).toBe('sync/request-failed');
    expect(failed.nextAttemptAt).toBe('2026-01-01T00:00:02.000Z'); // +2000ms (retries=1)
    expect(failed.id).toBe('lot-1');
    expect(failed.eventIds).toEqual(['e1']); // el conjunto no cambia al fallar
  });
});

describe('isLotDue', () => {
  it('true si nextAttemptAt ya pasó, false si es futuro', () => {
    const lot = markLotFailed(
      buildPushLot(['e1'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' }),
      {
        now: '2026-01-01T00:00:00.000Z',
        error: 'x',
      },
    );

    expect(isLotDue(lot, '2026-01-01T00:00:01.000Z')).toBe(false); // backoff de 2s todavía no pasó
    expect(isLotDue(lot, '2026-01-01T00:00:02.500Z')).toBe(true);
  });
});

describe('isPushStruggling', () => {
  it('false sin lote o con pocos reintentos, true al llegar al umbral', () => {
    expect(isPushStruggling(undefined)).toBe(false);

    let lot = buildPushLot(['e1'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' });
    for (let i = 0; i < PUSH_ERROR_RETRY_THRESHOLD - 1; i += 1) {
      lot = markLotFailed(lot, { now: '2026-01-01T00:00:00.000Z', error: 'x' });
    }
    expect(isPushStruggling(lot)).toBe(false);

    lot = markLotFailed(lot, { now: '2026-01-01T00:00:00.000Z', error: 'x' });
    expect(isPushStruggling(lot)).toBe(true);
  });
});
