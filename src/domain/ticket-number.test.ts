import { describe, expect, it } from 'vitest';
import {
  lastTicketNumberOn,
  localDateKey,
  localDayRange,
  nextTicketNumber,
  saleDateKey,
  shiftDateKey,
} from './ticket-number.ts';

// Fechas armadas en hora local: el test no depende de la zona horaria del entorno.
const at = (y: number, m: number, d: number, h = 12, min = 0): string =>
  new Date(y, m - 1, d, h, min).toISOString();

describe('ticket-number', () => {
  it('localDateKey usa la fecha local, con ceros a la izquierda', () => {
    expect(localDateKey(at(2026, 9, 4, 0, 5))).toBe('2026-09-04');
    expect(localDateKey(at(2026, 9, 24, 23, 59))).toBe('2026-09-24');
  });

  it('localDayRange cubre el día local entero, con el fin exclusivo', () => {
    const { from, to } = localDayRange('2026-09-24');
    expect(from).toBe(at(2026, 9, 24, 0));
    expect(to).toBe(at(2026, 9, 25, 0));
  });

  it('shiftDateKey cruza meses', () => {
    expect(shiftDateKey('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDateKey('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('saleDateKey usa ticket.date si lo tiene; si no, la fecha local de createdAt', () => {
    expect(
      saleDateKey({ createdAt: at(2026, 9, 24), ticket: { date: '2026-09-23', number: 4 } }),
    ).toBe('2026-09-23');
    expect(saleDateKey({ createdAt: at(2026, 9, 24) })).toBe('2026-09-24');
  });

  it('lastTicketNumberOn toma el mayor número de esa fecha', () => {
    const sales = [
      { ticket: { date: '2026-09-24', number: 3 } },
      { ticket: { date: '2026-09-24', number: 7 } },
      { ticket: { date: '2026-09-23', number: 40 } },
      {},
    ];
    expect(lastTicketNumberOn(sales, '2026-09-24')).toBe(7);
    expect(lastTicketNumberOn(sales, '2026-09-22')).toBeUndefined();
  });

  it('día nuevo: contador de otra fecha y sin ventas de hoy → 1', () => {
    expect(
      nextTicketNumber({
        date: '2026-09-24',
        stored: { date: '2026-09-23', last: 50 },
        lastLocal: undefined,
      }),
    ).toBe(1);
  });

  it('mismo día: sigue el contador', () => {
    expect(
      nextTicketNumber({ date: '2026-09-24', stored: { date: '2026-09-24', last: 5 }, lastLocal: 5 }),
    ).toBe(6);
  });

  it('contador perdido: retoma desde las ventas locales', () => {
    expect(nextTicketNumber({ date: '2026-09-24', stored: undefined, lastLocal: 9 })).toBe(10);
  });

  it('datos locales borrados: el contador evita repetir', () => {
    expect(
      nextTicketNumber({
        date: '2026-09-24',
        stored: { date: '2026-09-24', last: 12 },
        lastLocal: undefined,
      }),
    ).toBe(13);
  });

  it('reloj que retrocede: contador de otra fecha, usa lo local de la fecha actual', () => {
    expect(
      nextTicketNumber({ date: '2026-09-22', stored: { date: '2026-09-24', last: 30 }, lastLocal: 4 }),
    ).toBe(5);
  });
});
