import { shiftDateKey } from '../domain/ticket-number.ts';
import { resolveLocale } from './format.ts';
import { formatTicketDate } from './format-ticket.ts';

/**
 * Encabezado del día de `/RESUMEN` (spec de #100, §5): "Hoy · jueves 24/09", "Ayer · miércoles
 * 23/09" o "martes 22/09". `date` y `today` son claves locales (`'YYYY-MM-DD'`).
 */
export function formatDayHeading(date: string, today: string): string {
  const weekday = new Intl.DateTimeFormat(resolveLocale(), { weekday: 'long' }).format(
    new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))),
  );
  const label = `${weekday} ${formatTicketDate(date)}`;
  if (date === today) {
    return `Hoy · ${label}`;
  }
  if (date === shiftDateKey(today, -1)) {
    return `Ayer · ${label}`;
  }
  return label;
}
