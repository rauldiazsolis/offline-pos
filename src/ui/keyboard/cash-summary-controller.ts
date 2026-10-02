import type { DayEntry } from '../../domain/day-summary.ts';
import { localDateKey, shiftDateKey } from '../../domain/ticket-number.ts';
import { getDaySummary } from '../../storage/cash-summary-repository.ts';
import {
  cashSummaryNoticeSignal,
  cashSummaryTabSignal,
  dayViewSignal,
  movementFilterSignal,
  paymentFilterSignal,
  productFilterSignal,
  selectedEntryIndexSignal,
  selectedPaymentIndexSignal,
  selectedProductIndexSignal,
  type CashSummaryTab,
} from '../state/cash-summary.ts';
import { documentName, reprintReceipt } from '../print/after-close.ts';
import type { ReceiptSource } from '../print/resolve-receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';

/** Capa de glue entre `/RESUMEN` y `storage/cash-summary-repository.ts` — mismo rol que `cash-controller.ts`. */

function resetTabsAndFilters(): void {
  cashSummaryNoticeSignal.value = null;
  cashSummaryTabSignal.value = 'movements';
  movementFilterSignal.value = '';
  productFilterSignal.value = '';
  paymentFilterSignal.value = '';
  selectedEntryIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
  selectedPaymentIndexSignal.value = null;
}

/** `/RESUMEN`: abre en el día de hoy, en la pestaña Movimientos. */
export async function triggerCashSummary(): Promise<void> {
  resetTabsAndFilters();
  await showSummaryDay(localDateKey(new Date().toISOString()));
  activeScreenSignal.value = 'cash-summary';
}

/**
 * Carga un día. Pestaña y filtros se conservan; la selección vuelve al principio (antes del
 * `await`, así una tecla en vuelo no se pisa).
 */
export async function showSummaryDay(date: string): Promise<void> {
  cashSummaryNoticeSignal.value = null;
  selectedEntryIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
  selectedPaymentIndexSignal.value = null;
  dayViewSignal.value = await getDaySummary(date, new Date().toISOString());
}

/** Un día calendario hacia atrás, sin pasar del día más viejo con datos locales. */
export async function showPreviousDay(): Promise<void> {
  const view = dayViewSignal.value;
  if (view === undefined || view.date <= view.oldestDate) {
    return;
  }
  await showSummaryDay(shiftDateKey(view.date, -1));
}

/** Un día calendario hacia adelante, sin pasar de hoy. */
export async function showNextDay(): Promise<void> {
  const view = dayViewSignal.value;
  if (view === undefined || view.isToday) {
    return;
  }
  await showSummaryDay(shiftDateKey(view.date, 1));
}

export function exitCashSummaryScreen(): void {
  dayViewSignal.value = undefined;
  resetTabsAndFilters();
  activeScreenSignal.value = 'sale';
}

export function setCashSummaryTab(tab: CashSummaryTab): void {
  cashSummaryNoticeSignal.value = null;
  cashSummaryTabSignal.value = tab;
  movementFilterSignal.value = '';
  productFilterSignal.value = '';
  paymentFilterSignal.value = '';
  selectedEntryIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
  selectedPaymentIndexSignal.value = null;
}

export function updateMovementFilter(value: string): void {
  // No hace falta resetear `selectedEntryIndexSignal` acá — `useTicketListNavigation` ya lo hace
  // solo cuando cambia la cantidad de movimientos filtrados (ver el efecto en ese hook).
  movementFilterSignal.value = value;
}

export function updateProductFilter(value: string): void {
  // A diferencia de Movimientos, la pestaña Productos no tiene un hook que reindexe la selección
  // sola — sin este reset, un índice seleccionado antes de tipear podía apuntar a una fila que ya
  // no existe en la lista filtrada (bug real encontrado en revisión de código).
  selectedProductIndexSignal.value = null;
  productFilterSignal.value = value;
}

export function updatePaymentFilter(value: string): void {
  // Medios de pago es una lista fija (siempre 6 filas) — el filtro acá es puramente para resaltar
  // coincidencias, nunca oculta filas, así que no hace falta reindexar la selección como en
  // Productos.
  paymentFilterSignal.value = value;
}

/**
 * Qué se reimprime de una fila de Movimientos (#174): ventas y cobranzas (también las anuladas y
 * las anulaciones), siempre como copia. Una cobranza va sin saldos: los de ese momento no están
 * guardados. Los movimientos de caja y los arqueos no tienen comprobante.
 */
export function reprintSourceFor(
  entry: DayEntry,
  customerNames: ReadonlyMap<string, string>,
): ReceiptSource | undefined {
  switch (entry.kind) {
    case 'sale':
      return { kind: 'sale', sale: entry.sale, copy: true };
    case 'collection':
      return {
        kind: 'collection',
        payment: entry.payment,
        customerName: customerNames.get(entry.payment.customerId) ?? entry.payment.customerId,
        copy: true,
      };
    case 'movement':
    case 'count':
      return undefined;
  }
}

/**
 * Reimprimir (o ver, sin papel) la fila elegida; nada si no es una venta ni una cobranza. Al
 * imprimir, el aviso de `/RESUMEN` dice qué copia salió.
 */
export function reprintEntry(entry: DayEntry, customerNames: ReadonlyMap<string, string>): void {
  const source = reprintSourceFor(entry, customerNames);
  if (source === undefined) {
    return;
  }
  if (reprintReceipt(source) === 'printed') {
    cashSummaryNoticeSignal.value = `Copia del ${documentName(source)} enviada a imprimir.`;
  }
}
