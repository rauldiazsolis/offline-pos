import { signal } from '@preact/signals';
import type { CashSummaryContext } from '../../storage/cash-summary-repository.ts';

/**
 * Estado de `/RESUMEN` — un signal por responsabilidad, mismo patrón que `cash-session.ts`.
 * `selectedTicketIndexSignal` arranca en `0` (no `null`): a diferencia de los overlays de la barra
 * de comandos, acá siempre hay "algún" ticket seleccionado apenas hay al menos uno (no hay ningún
 * estado "nada elegido" con la lista no vacía).
 */
export const cashSummaryContextSignal = signal<CashSummaryContext | undefined>(undefined);
export const cashSummaryTabSignal = signal<'tickets' | 'products' | 'payments'>('tickets');
export const ticketFilterSignal = signal('');
export const productFilterSignal = signal('');
export const paymentFilterSignal = signal('');
export const selectedTicketIndexSignal = signal(0);
export const selectedProductIndexSignal = signal<number | null>(null);
export const selectedPaymentIndexSignal = signal<number | null>(null);
