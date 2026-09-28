import { z } from 'zod';
import type { TicketCounter } from '../domain/ticket-number.ts';

/**
 * Último número de ticket usado (#120). Best-effort, mismo criterio que `sync/cursor.ts`: si se
 * pierde, el próximo número se deriva de las ventas locales de ese día. Vive fuera de IndexedDB a
 * propósito: "Borrar" en `/CONFIG`, `/DEMO_RESET` y la pérdida del id de dispositivo vacían las
 * tablas pero no esta clave, así la numeración no se repite. `pos.reset()` sí la borra (prefijo
 * `offline-pos:`).
 */
export const TICKET_COUNTER_KEY = 'offline-pos:ticket-counter';

const ticketCounterSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  last: z.number().int().min(1),
});

export function getTicketCounter(): TicketCounter | undefined {
  try {
    const raw = localStorage.getItem(TICKET_COUNTER_KEY);
    if (raw === null) {
      return undefined;
    }
    const parsed = ticketCounterSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function setTicketCounter(counter: TicketCounter): void {
  try {
    localStorage.setItem(TICKET_COUNTER_KEY, JSON.stringify(counter));
  } catch {
    /* best-effort, ver comentario de arriba */
  }
}
