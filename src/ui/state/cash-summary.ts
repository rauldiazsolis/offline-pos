import { signal } from '@preact/signals';
import type { DayView } from '../../storage/cash-summary-repository.ts';

/**
 * Estado de `/RESUMEN` — un signal por responsabilidad, mismo patrón que `cash.ts`. Desde la
 * Etapa 5 de #94 (#100) muestra un día calendario (`dayViewSignal`). `selectedEntryIndexSignal`
 * arranca en `0` (no `null`): a diferencia de los overlays de la barra de comandos, acá siempre
 * hay "algún" movimiento seleccionado apenas hay al menos uno.
 */
export type CashSummaryTab = 'movements' | 'products' | 'payments';

export const dayViewSignal = signal<DayView | undefined>(undefined);
export const cashSummaryTabSignal = signal<CashSummaryTab>('movements');
export const movementFilterSignal = signal('');
export const productFilterSignal = signal('');
export const paymentFilterSignal = signal('');
export const selectedEntryIndexSignal = signal(0);
export const selectedProductIndexSignal = signal<number | null>(null);
export const selectedPaymentIndexSignal = signal<number | null>(null);
