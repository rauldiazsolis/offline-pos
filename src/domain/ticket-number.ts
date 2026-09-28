import type { Sale } from './sale.ts';

/**
 * Número de ticket (#120): un contador por día local de la terminal. `date` es la fecha con la
 * que se numeró (`'YYYY-MM-DD'`), así un ticket conserva su número aunque después se lo mire desde
 * otra zona horaria. Las anulaciones son tickets propios y consumen número.
 */
export type TicketNumber = { date: string; number: number };

/** Último número usado, guardado en `localStorage` (`sync/ticket-counter.ts`). */
export type TicketCounter = { date: string; last: number };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function fromDateKey(date: string, days = 0): Date {
  return new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)) + days,
  );
}

function toDateKey(value: Date): string {
  return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Fecha local (`'YYYY-MM-DD'`) de un instante ISO, en la zona horaria de la terminal. */
export function localDateKey(iso: string): string {
  return toDateKey(new Date(iso));
}

/** El día local entero como rango ISO, `to` exclusivo — para consultar por el índice `createdAt`. */
export function localDayRange(date: string): { from: string; to: string } {
  return { from: fromDateKey(date).toISOString(), to: fromDateKey(date, 1).toISOString() };
}

/** Día calendario `days` días antes (negativo) o después. */
export function shiftDateKey(date: string, days: number): string {
  return toDateKey(fromDateKey(date, days));
}

/** El día al que pertenece una venta: el de su número si lo tiene, si no el de su hora local. */
export function saleDateKey(sale: Pick<Sale, 'createdAt' | 'ticket'>): string {
  return sale.ticket?.date ?? localDateKey(sale.createdAt);
}

/** Mayor número de ticket de `date` entre las ventas dadas. */
export function lastTicketNumberOn(
  sales: readonly Pick<Sale, 'ticket'>[],
  date: string,
): number | undefined {
  let last: number | undefined;
  for (const sale of sales) {
    if (sale.ticket?.date === date && (last === undefined || sale.ticket.number > last)) {
      last = sale.ticket.number;
    }
  }
  return last;
}

/**
 * El próximo número (spec de #120, §3): el mayor entre el contador guardado (si es de la misma
 * fecha) y el último local de esa fecha, más uno. El contador cubre los datos locales borrados;
 * las ventas locales cubren un contador perdido.
 */
export function nextTicketNumber(params: {
  date: string;
  stored: TicketCounter | undefined;
  lastLocal: number | undefined;
}): number {
  const stored = params.stored?.date === params.date ? params.stored.last : 0;
  return Math.max(stored, params.lastLocal ?? 0) + 1;
}
