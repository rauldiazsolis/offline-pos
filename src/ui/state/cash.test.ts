import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cashCountOverdueSignal,
  lastCashCountAtSignal,
  nowMinuteSignal,
  startCashClock,
} from './cash.ts';

afterEach(() => {
  vi.useRealTimers();
  lastCashCountAtSignal.value = undefined;
});

describe('aviso de arqueo (#100)', () => {
  it('sin arqueo, o con uno de más de 24 h', () => {
    const now = '2026-09-24T12:00:00.000Z';
    nowMinuteSignal.value = now;
    lastCashCountAtSignal.value = undefined;
    expect(cashCountOverdueSignal.value).toBe(true);

    lastCashCountAtSignal.value = '2026-09-24T11:00:00.000Z';
    expect(cashCountOverdueSignal.value).toBe(false);

    nowMinuteSignal.value = '2026-09-25T11:01:00.000Z';
    expect(cashCountOverdueSignal.value).toBe(true);
  });

  it('startCashClock actualiza el reloj cada minuto hasta que se detiene', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
    const stop = startCashClock();

    vi.advanceTimersByTime(60_000);
    expect(nowMinuteSignal.value).toBe('2026-09-24T12:01:00.000Z');

    stop();
    vi.advanceTimersByTime(60_000);
    expect(nowMinuteSignal.value).toBe('2026-09-24T12:01:00.000Z');
  });
});
