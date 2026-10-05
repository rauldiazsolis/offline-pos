import type { DailyCounter } from '../domain/ticket-number.ts';
import { readDailyCounter, writeDailyCounter } from './daily-counter.ts';
// #177: en entrenamiento, claves propias (training:…).
import { operationalKey } from '../storage/training-mode.ts';

/**
 * Último número de recibo de cobranza usado (#101), independiente del de tickets. Mismas razones
 * que `ticket-counter.ts` para vivir fuera de IndexedDB: si se pierde, el próximo número se deriva
 * de las cobranzas locales de ese día; si se borran los datos locales, la numeración no se repite.
 * `pos.reset()` la borra (prefijo de `storage-namespace.ts`).
 */
export const RECEIPT_COUNTER_KEY = operationalKey('receipt-counter');

export function getReceiptCounter(): DailyCounter | undefined {
  return readDailyCounter(RECEIPT_COUNTER_KEY);
}

export function setReceiptCounter(counter: DailyCounter): void {
  writeDailyCounter(RECEIPT_COUNTER_KEY, counter);
}
