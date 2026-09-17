import { getCashSummaryContext } from '../../storage/cash-summary-repository.ts';
import { describeError } from '../errors.ts';
import { commandBarErrorSignal } from '../state/command-bar.ts';
import {
  cashSummaryContextSignal,
  cashSummaryTabSignal,
  productFilterSignal,
  selectedProductIndexSignal,
  selectedTicketIndexSignal,
  ticketFilterSignal,
} from '../state/cash-summary.ts';
import { activeScreenSignal } from '../state/screen.ts';

/** Capa de glue entre `/RESUMEN` y `storage/cash-summary-repository.ts` — mismo rol que `cash-session-controller.ts`. */
export async function triggerCashSummary(): Promise<void> {
  const context = await getCashSummaryContext();
  if (context === undefined) {
    commandBarErrorSignal.value = describeError({ ok: false, error: 'cash-session/none-ever', meta: undefined });
    return;
  }
  cashSummaryContextSignal.value = context;
  cashSummaryTabSignal.value = 'tickets';
  ticketFilterSignal.value = '';
  productFilterSignal.value = '';
  selectedTicketIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
  activeScreenSignal.value = 'cash-summary';
}

export function exitCashSummaryScreen(): void {
  cashSummaryContextSignal.value = undefined;
  cashSummaryTabSignal.value = 'tickets';
  ticketFilterSignal.value = '';
  productFilterSignal.value = '';
  selectedTicketIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
  activeScreenSignal.value = 'sale';
}

export function setCashSummaryTab(tab: 'tickets' | 'products' | 'payments'): void {
  cashSummaryTabSignal.value = tab;
  ticketFilterSignal.value = '';
  productFilterSignal.value = '';
  selectedTicketIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
}

export function updateTicketFilter(value: string): void {
  ticketFilterSignal.value = value;
}

export function updateProductFilter(value: string): void {
  productFilterSignal.value = value;
}
