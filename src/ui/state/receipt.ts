import { signal } from '@preact/signals';
import type { Sale } from '../../domain/sale.ts';
import type { CollectionRecord } from '../../storage/customer-payment-repository.ts';

/** Última venta cerrada — la lee receipt-screen para mostrar el comprobante. */
export const receiptSaleSignal = signal<Sale | null>(null);

/**
 * Última cobranza registrada (#101) con el nombre del cliente, que ya se desadjuntó al confirmar.
 * Un signal propio junto al de la venta: el comprobante muestra el que esté puesto.
 */
export type CollectionReceipt = CollectionRecord & { customerName: string };

export const receiptCollectionSignal = signal<CollectionReceipt | null>(null);
