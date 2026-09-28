import { beforeEach, describe, expect, it } from 'vitest';
import { getReceiptCounter, RECEIPT_COUNTER_KEY, setReceiptCounter } from './receipt-counter.ts';
import { getTicketCounter, setTicketCounter } from './ticket-counter.ts';

describe('receipt-counter', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('guarda y lee el contador de recibos', () => {
    setReceiptCounter({ date: '2026-09-27', last: 3 });
    expect(getReceiptCounter()).toEqual({ date: '2026-09-27', last: 3 });
  });

  it('es independiente del contador de tickets', () => {
    setTicketCounter({ date: '2026-09-27', last: 40 });
    expect(getReceiptCounter()).toBeUndefined();
    setReceiptCounter({ date: '2026-09-27', last: 1 });
    expect(getTicketCounter()).toEqual({ date: '2026-09-27', last: 40 });
  });

  it('un valor inválido se ignora', () => {
    localStorage.setItem(RECEIPT_COUNTER_KEY, '{"date":"hoy","last":0}');
    expect(getReceiptCounter()).toBeUndefined();
  });
});
