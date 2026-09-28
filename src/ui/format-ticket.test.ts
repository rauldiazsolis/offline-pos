import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveSyncConfig } from '../sync/config.ts';
import { formatTime } from './format.ts';
import {
  formatTicketDate,
  receiptLabel,
  receiptName,
  saleName,
  ticketLabel,
  voidOfLabel,
  voidOfReceiptLabel,
} from './format-ticket.ts';

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

describe('receiptLabel (#101)', () => {
  it('"Recibo #3", o "Recibo" a secas sin número', () => {
    expect(receiptLabel({ receipt: { date: '2026-09-27', number: 3 } })).toBe('Recibo #3');
    expect(receiptLabel({})).toBe('Recibo');
  });
});

describe('voidOfReceiptLabel (#125)', () => {
  it('misma fecha: "Anulación del #1"', () => {
    expect(
      voidOfReceiptLabel(
        { receipt: { date: '2026-09-28', number: 2 }, createdAt: at },
        { receipt: { date: '2026-09-28', number: 1 }, createdAt: at },
      ),
    ).toBe('Anulación del #1');
  });

  it('otra fecha: "Anulación del #1 del 27/09"', () => {
    expect(
      voidOfReceiptLabel(
        { receipt: { date: '2026-09-28', number: 2 }, createdAt: at },
        { receipt: { date: '2026-09-27', number: 1 }, createdAt: at },
      ),
    ).toBe('Anulación del #1 del 27/09');
  });

  it('sin original: "Anulación"; original sin número: por su hora', () => {
    expect(voidOfReceiptLabel({ createdAt: at }, undefined)).toBe('Anulación');
    expect(voidOfReceiptLabel({ createdAt: at }, { createdAt: at })).toBe(
      `Anulación de ${formatTime(at)}`,
    );
  });
});

describe('saleName y receiptName (#125)', () => {
  it('con número, "Ticket #1" / "Recibo #1"; sin número, por la hora', () => {
    expect(saleName({ ticket: { date: '2026-09-24', number: 1 }, createdAt: at })).toBe(
      'Ticket #1',
    );
    expect(saleName({ createdAt: at })).toBe(`ticket de las ${formatTime(at)}`);
    expect(receiptName({ receipt: { date: '2026-09-24', number: 3 }, createdAt: at })).toBe(
      'Recibo #3',
    );
    expect(receiptName({ createdAt: at })).toBe(`recibo de las ${formatTime(at)}`);
  });
});
