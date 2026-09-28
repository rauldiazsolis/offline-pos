import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveSyncConfig } from '../sync/config.ts';
import { formatTime } from './format.ts';
import { formatTicketDate, ticketLabel, voidOfLabel } from './format-ticket.ts';

const at = '2026-09-24T17:05:00.000Z';

beforeEach(() => {
  saveSyncConfig({ type: 'rest', baseUrl: 'http://x', locale: 'es-AR' });
});

afterEach(() => {
  localStorage.clear();
});

describe('format-ticket (#120)', () => {
  it('formatTicketDate', () => {
    expect(formatTicketDate('2026-09-03')).toBe('03/09');
  });

  it('ticketLabel con y sin número', () => {
    expect(ticketLabel({ ticket: { date: '2026-09-24', number: 12 } })).toBe('Ticket #12');
    expect(ticketLabel({})).toBe('Ticket');
  });

  it('voidOfLabel: mismo día, otro día, original sin número o sin original', () => {
    const voidTicket = { createdAt: at, ticket: { date: '2026-09-24', number: 13 } };
    expect(
      voidOfLabel(voidTicket, { createdAt: at, ticket: { date: '2026-09-24', number: 12 } }),
    ).toBe('Anulación del #12');
    expect(
      voidOfLabel(voidTicket, { createdAt: at, ticket: { date: '2026-09-23', number: 12 } }),
    ).toBe('Anulación del #12 del 23/09');
    expect(voidOfLabel(voidTicket, { createdAt: at })).toBe(`Anulación de ${formatTime(at)}`);
    expect(voidOfLabel(voidTicket, undefined)).toBe('Anulación');
  });
});
