import type { TicketCounter } from '../domain/ticket-number.ts';
import { readDailyCounter, writeDailyCounter } from './daily-counter.ts';
import { storageKey } from '../storage/storage-namespace.ts';

/**
 * Último número de ticket usado (#120). Best-effort, mismo criterio que `sync/cursor.ts`: si se
 * pierde, el próximo número se deriva de las ventas locales de ese día. Vive fuera de IndexedDB a
 * propósito: "Borrar" en `/CONFIG`, `/DEMO_RESET` y la pérdida del id de dispositivo vacían las
 * tablas pero no esta clave, así la numeración no se repite. `pos.reset()` sí la borra (prefijo
 * de `storage-namespace.ts`).
 */
export const TICKET_COUNTER_KEY = storageKey('ticket-counter');

export function getTicketCounter(): TicketCounter | undefined {
  return readDailyCounter(TICKET_COUNTER_KEY);
}

export function setTicketCounter(counter: TicketCounter): void {
  writeDailyCounter(TICKET_COUNTER_KEY, counter);
}
