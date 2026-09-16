import { signal } from '@preact/signals';
import type { Sale } from '../../domain/sale.ts';

/** Última venta cerrada — la lee receipt-screen para mostrar el comprobante. */
export const receiptSaleSignal = signal<Sale | null>(null);
