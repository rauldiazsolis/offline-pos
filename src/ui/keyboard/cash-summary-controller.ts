import { getCashSummaryContext } from '../../storage/cash-summary-repository.ts';
import { describeError } from '../errors.ts';
import { commandBarErrorSignal } from '../state/command-bar.ts';
import {
  cashSummaryContextSignal,
  cashSummaryTabSignal,
  paymentFilterSignal,
  productFilterSignal,
  selectedPaymentIndexSignal,
  selectedProductIndexSignal,
  selectedTicketIndexSignal,
  ticketFilterSignal,
} from '../state/cash-summary.ts';
import { activeScreenSignal } from '../state/screen.ts';

/** Capa de glue entre `/RESUMEN` y `storage/cash-summary-repository.ts` — mismo rol que `cash-session-controller.ts`. */
export async function triggerCashSummary(): Promise<void> {
  const context = await getCashSummaryContext();
  if (context === undefined) {
    commandBarErrorSignal.value = describeError({
      ok: false,
      error: 'cash-session/none-ever',
      meta: undefined,
    });
    return;
  }
  cashSummaryContextSignal.value = context;
  cashSummaryTabSignal.value = 'tickets';
  ticketFilterSignal.value = '';
  productFilterSignal.value = '';
  paymentFilterSignal.value = '';
  selectedTicketIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
  selectedPaymentIndexSignal.value = null;
  activeScreenSignal.value = 'cash-summary';
}

export function exitCashSummaryScreen(): void {
  cashSummaryContextSignal.value = undefined;
  cashSummaryTabSignal.value = 'tickets';
  ticketFilterSignal.value = '';
  productFilterSignal.value = '';
  paymentFilterSignal.value = '';
  selectedTicketIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
  selectedPaymentIndexSignal.value = null;
  activeScreenSignal.value = 'sale';
}

export function setCashSummaryTab(tab: 'tickets' | 'products' | 'payments'): void {
  cashSummaryTabSignal.value = tab;
  ticketFilterSignal.value = '';
  productFilterSignal.value = '';
  paymentFilterSignal.value = '';
  selectedTicketIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
  selectedPaymentIndexSignal.value = null;
}

export function updateTicketFilter(value: string): void {
  // No hace falta resetear `selectedTicketIndexSignal` acá — `useTicketListNavigation` ya lo hace
  // solo cuando cambia la cantidad de tickets filtrados (ver el efecto en ese hook).
  ticketFilterSignal.value = value;
}

export function updateProductFilter(value: string): void {
  // A diferencia de Tickets, la pestaña Productos no tiene un hook que reindexe la selección sola
  // — sin este reset, un índice seleccionado antes de tipear podía apuntar a una fila que ya no
  // existe en la lista filtrada (bug real encontrado en revisión de código).
  selectedProductIndexSignal.value = null;
  productFilterSignal.value = value;
}

export function updatePaymentFilter(value: string): void {
  // Medios de pago es una lista fija (siempre 6 filas) — el filtro acá es puramente para resaltar
  // coincidencias, nunca oculta filas, así que no hace falta reindexar la selección como en
  // Productos.
  paymentFilterSignal.value = value;
}
