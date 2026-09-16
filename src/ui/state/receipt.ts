import { signal } from '@preact/signals';
import type { Sale } from '../../domain/sale.ts';

/** Última venta cerrada — la lee receipt-screen para mostrar el comprobante. */
export const receiptSaleSignal = signal<Sale | null>(null);

/**
 * Vuelto entregado en el cobro que generó `receiptSaleSignal` — efímero,
 * nunca persistido en `Sale` (issue #55: no hay hoy ningún consumidor que lo
 * necesite después de mostrado el comprobante — no hay reimpresión desde
 * Historial todavía). `Payment.amount` es siempre el neto aplicado, así que
 * no se puede reconstruir el vuelto a partir de `sale.payments`.
 */
export const receiptChangeSignal = signal(0);
