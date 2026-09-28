import { beforeEach, describe, expect, it } from 'vitest';
import { getTicketCounter, setTicketCounter, TICKET_COUNTER_KEY } from './ticket-counter.ts';

describe('ticket-counter', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('guarda y lee el contador', () => {
    setTicketCounter({ date: '2026-09-24', last: 3 });
    expect(getTicketCounter()).toEqual({ date: '2026-09-24', last: 3 });
  });

  it('sin clave → undefined', () => {
    expect(getTicketCounter()).toBeUndefined();
  });

  it('un valor con otra forma se ignora', () => {
    localStorage.setItem(TICKET_COUNTER_KEY, JSON.stringify({ date: 'ayer', last: -1 }));
    expect(getTicketCounter()).toBeUndefined();
    localStorage.setItem(TICKET_COUNTER_KEY, 'no es json');
    expect(getTicketCounter()).toBeUndefined();
  });
});
