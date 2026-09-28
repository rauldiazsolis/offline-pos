import type { Sale } from './sale.ts';

/**
 * Número de un documento en su día local (#120 tickets, #101 recibos de cobranza): un contador por
 * día local de la terminal. `date` es la fecha con la que se numeró (`'YYYY-MM-DD'`), así un
 * documento conserva su número aunque después se lo mire desde otra zona horaria. Tickets y
 * recibos siguen la misma regla con contadores propios. Las anulaciones son tickets propios y
 * consumen número.
 */
export type DailyNumber = { date: string; number: number };
export type TicketNumber = DailyNumber;

/** Último número usado, guardado en `localStorage` (`sync/daily-counter.ts`). */
export type DailyCounter = { date: string; last: number };
export type TicketCounter = DailyCounter;

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

/** El día al que pertenece una cobranza: el de su recibo si lo tiene, si no el de su hora local. */
export function collectionDateKey(payment: { createdAt: string; receipt?: DailyNumber }): string {
  return payment.receipt?.date ?? localDateKey(payment.createdAt);
}

/** Mayor número de `date` entre los dados (los `undefined` son documentos sin número). */
export function lastDailyNumberOn(
  numbers: readonly (DailyNumber | undefined)[],
  date: string,
): number | undefined {
  let last: number | undefined;
  for (const item of numbers) {
    if (item?.date === date && (last === undefined || item.number > last)) {
      last = item.number;
    }
  }
  return last;
}

/** Mayor número de ticket de `date` entre las ventas dadas. */
export function lastTicketNumberOn(
  sales: readonly Pick<Sale, 'ticket'>[],
  date: string,
): number | undefined {
  return lastDailyNumberOn(
    sales.map((sale) => sale.ticket),
    date,
  );
}

/**
 * El próximo número (spec de #120, §3; los recibos de #101 siguen la misma regla): el mayor entre
 * el contador guardado (si es de la misma fecha) y el último local de esa fecha, más uno. El
 * contador cubre los datos locales borrados; los documentos locales cubren un contador perdido.
 */
export function nextDailyNumber(params: {
  date: string;
  stored: DailyCounter | undefined;
  lastLocal: number | undefined;
}): number {
  const stored = params.stored?.date === params.date ? params.stored.last : 0;
  return Math.max(stored, params.lastLocal ?? 0) + 1;
}

export const nextTicketNumber = nextDailyNumber;
