import { db } from '../../storage/db.ts';
import { voidSaleAndPersist } from '../../storage/sale-repository.ts';
import { describeError } from '../errors.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  voidConfirmingSignal,
  voidErrorSignal,
  voidSelectionIndexSignal,
  voidableSalesSignal,
} from '../state/void-sale.ts';

const MAX_VOIDABLE_SALES = 20;

/**
 * Últimas ventas cerradas, más recientes primero — mínimo operable para
 * poder elegir cuál anular (no es el historial de Fase 6, solo lo
 * indispensable para RF-06).
 */
export async function loadVoidableSales(): Promise<void> {
  const closedSales = await db.sales.where('status').equals('closed').toArray();
  closedSales.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  voidableSalesSignal.value = closedSales.slice(0, MAX_VOIDABLE_SALES);
  voidSelectionIndexSignal.value = voidableSalesSignal.value.length > 0 ? 0 : null;
  voidConfirmingSignal.value = false;
  voidErrorSignal.value = null;
}

export function moveVoidSelection(direction: 1 | -1): void {
  const sales = voidableSalesSignal.value;
  if (sales.length === 0) {
    return;
  }
  const current = voidSelectionIndexSignal.value ?? 0;
  voidSelectionIndexSignal.value = Math.min(Math.max(current + direction, 0), sales.length - 1);
}

/** Enter sobre la lista: pasa al paso de confirmación. */
export function selectForVoid(): void {
  if (voidSelectionIndexSignal.value !== null) {
    voidConfirmingSignal.value = true;
  }
}

/** Click en una venta de la lista (Etapa 2 de #94): lo mismo que ↑/↓ hasta ella + Enter. */
export function activateVoidRow(index: number): void {
  if (index < 0 || index >= voidableSalesSignal.value.length) {
    return;
  }
  voidSelectionIndexSignal.value = index;
  selectForVoid();
}

/** Esc en el paso de confirmación: vuelve a la lista sin anular nada. */
export function cancelVoidConfirmation(): void {
  voidConfirmingSignal.value = false;
}

/** Esc en la lista: sale de la pantalla de anulación. */
export function exitVoidScreen(): void {
  voidableSalesSignal.value = [];
  voidSelectionIndexSignal.value = null;
  voidConfirmingSignal.value = false;
  voidErrorSignal.value = null;
  activeScreenSignal.value = 'sale';
}

/** Enter en el paso de confirmación: ejecuta la anulación. */
export async function confirmVoid(): Promise<void> {
  const index = voidSelectionIndexSignal.value;
  if (index === null) {
    return;
  }
  const sale = voidableSalesSignal.value[index];
  if (sale === undefined) {
    return;
  }

  const result = await voidSaleAndPersist(sale.id);
  if (!result.ok) {
    voidErrorSignal.value = describeError(result);
    return;
  }
  exitVoidScreen();
}
