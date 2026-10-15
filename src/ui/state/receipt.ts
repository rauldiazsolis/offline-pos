import { signal } from '@preact/signals';
import type { ReceiptSource } from '../print/resolve-receipt.ts';
import { activeScreenSignal } from './screen.ts';

/** A dónde vuelve Esc desde el comprobante: la venta, o `/RESUMEN` al ver una copia (#174). */
export type ReceiptReturn = 'sale' | 'cash-summary';

/**
 * El comprobante en pantalla: de qué es (la venta recién cerrada, la cobranza recién registrada con
 * el nombre del cliente y sus saldos, o una copia) y a dónde se vuelve. Un solo signal desde #174.
 */
export const receiptSignal = signal<{ source: ReceiptSource; returnTo: ReceiptReturn } | null>(
  null,
);

/** Esc o "Continuar" en el comprobante (también "Hacelo" de la guía, #226): vuelve a `returnTo`. */
export function closeReceipt(): void {
  const returnTo = receiptSignal.value?.returnTo ?? 'sale';
  receiptSignal.value = null;
  activeScreenSignal.value = returnTo;
}
