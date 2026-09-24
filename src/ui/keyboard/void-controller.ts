import { listVoidCandidates, voidSaleAndPersist } from '../../storage/sale-repository.ts';
import { describeError } from '../errors.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { refreshStockSnapshot } from '../state/stock.ts';
import {
  voidConfirmingSignal,
  voidErrorSignal,
  voidLoadedSignal,
  voidSelectionIndexSignal,
  voidableSalesSignal,
} from '../state/void-sale.ts';

function isVoidable(index: number): boolean {
  return voidableSalesSignal.value[index]?.state === 'voidable';
}

/**
 * Los últimos 20 tickets de las últimas 24 h (#99), anulaciones incluidas,
 * más nuevo primero — mínimo operable para elegir cuál anular (la búsqueda y
 * el ticket completo quedan en #110). La selección arranca en el primero que
 * se puede anular: una original ya anulada o el ticket de una anulación no
 * tienen acción.
 */
export async function loadVoidableSales(): Promise<void> {
  voidConfirmingSignal.value = false;
  voidErrorSignal.value = null;
  voidLoadedSignal.value = false;
  voidableSalesSignal.value = await listVoidCandidates(new Date().toISOString());
  voidLoadedSignal.value = true;
  const first = voidableSalesSignal.value.findIndex((candidate) => candidate.state === 'voidable');
  voidSelectionIndexSignal.value = first === -1 ? null : first;
}

/** ↑/↓: al siguiente anulable en esa dirección, sin ciclar (saltea las filas sin acción). */
export function moveVoidSelection(direction: 1 | -1): void {
  const current = voidSelectionIndexSignal.value;
  if (current === null) {
    return;
  }
  for (
    let index = current + direction;
    index >= 0 && index < voidableSalesSignal.value.length;
    index += direction
  ) {
    if (isVoidable(index)) {
      voidSelectionIndexSignal.value = index;
      return;
    }
  }
}

/** Enter sobre la lista: pasa al paso de confirmación. */
export function selectForVoid(): void {
  const index = voidSelectionIndexSignal.value;
  if (index !== null && isVoidable(index)) {
    voidConfirmingSignal.value = true;
  }
}

/** Click en una venta de la lista (Etapa 2 de #94): lo mismo que ↑/↓ hasta ella + Enter. */
export function activateVoidRow(index: number): void {
  if (!isVoidable(index)) {
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
  voidLoadedSignal.value = false;
  activeScreenSignal.value = 'sale';
}

/** Enter en el paso de confirmación: ejecuta la anulación (un ticket propio, #99). */
export async function confirmVoid(): Promise<void> {
  const index = voidSelectionIndexSignal.value;
  if (index === null) {
    return;
  }
  const candidate = voidableSalesSignal.value[index];
  if (candidate?.state !== 'voidable') {
    return;
  }

  const result = await voidSaleAndPersist(candidate.sale.id);
  if (!result.ok) {
    voidErrorSignal.value = describeError(result);
    return;
  }
  await refreshStockSnapshot();
  exitVoidScreen();
}
