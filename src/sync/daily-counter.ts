import { z } from 'zod';
import type { DailyCounter } from '../domain/ticket-number.ts';

const dailyCounterSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  last: z.number().int().min(1),
});

/**
 * Contador de un documento numerado por día (tickets, #120; recibos, #101) en `localStorage`.
 * Best-effort, mismo criterio que `sync/cursor.ts` (ver `ticket-counter.ts`): un valor ausente,
 * ilegible o con otra forma se lee como `undefined`.
 */
export function readDailyCounter(key: string): DailyCounter | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return undefined;
    }
    const parsed = dailyCounterSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeDailyCounter(key: string, counter: DailyCounter): void {
  try {
    localStorage.setItem(key, JSON.stringify(counter));
  } catch {
    /* best-effort, ver comentario de arriba */
  }
}
