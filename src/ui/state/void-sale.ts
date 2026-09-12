import { signal } from '@preact/signals';
import type { Sale } from '../../domain/sale.ts';

/** Últimas ventas cerradas, candidatas a anular. */
export const voidableSalesSignal = signal<Sale[]>([]);
export const voidSelectionIndexSignal = signal<number | null>(null);
/** true = ya se eligió una venta (Enter) y se está pidiendo confirmación. */
export const voidConfirmingSignal = signal(false);
export const voidErrorSignal = signal<string | null>(null);
