import { roundAmount } from '../../domain/rounding.ts';
import { voidCollectionAndPersist } from '../../storage/customer-payment-repository.ts';
import { voidSaleAndPersist } from '../../storage/sale-repository.ts';
import { listVoidCandidates, type VoidCandidate } from '../../storage/void-repository.ts';
import { describeError } from '../errors.ts';
import { formatBalance } from '../format-balance.ts';
import { receiptName, saleName } from '../format-ticket.ts';
import { commandBarNoticeSignal, overlayDismissedSignal } from '../state/command-bar.ts';
import { customerBalancesSignal, refreshCustomerBalances } from '../state/customer-balance.ts';
import { getCustomerRepository } from '../state/customer-repository.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { refreshStockSnapshot } from '../state/stock.ts';
import {
  filteredVoidCandidatesSignal,
  voidCandidatesSignal,
  voidConfirmingSignal,
  voidErrorSignal,
  voidFilterSignal,
  voidLoadedSignal,
  voidSelectionIndexSignal,
} from '../state/void.ts';

function isVoidable(index: number): boolean {
  return filteredVoidCandidatesSignal.value[index]?.state === 'voidable';
}

function selectFirstVoidable(): void {
  const first = filteredVoidCandidatesSignal.value.findIndex(
    (candidate) => candidate.state === 'voidable',
  );
  voidSelectionIndexSignal.value = first === -1 ? null : first;
}

/**
 * Ventas y cobranzas de las últimas 24 h (#125), lo más nuevo primero. La selección arranca en la
 * anulable más nueva: la original ya anulada y la anulación no tienen acción.
 */
export async function loadVoidCandidates(): Promise<void> {
  voidConfirmingSignal.value = false;
  voidErrorSignal.value = null;
  voidFilterSignal.value = '';
  voidLoadedSignal.value = false;
  voidCandidatesSignal.value = await listVoidCandidates(new Date().toISOString());
  voidLoadedSignal.value = true;
  selectFirstVoidable();
}

/** Cada tecla del buscador: filtra y vuelve a la primera anulable del resultado. */
export function updateVoidFilter(text: string): void {
  voidFilterSignal.value = text;
  selectFirstVoidable();
}

/** ↑/↓: al siguiente anulable en esa dirección, sin ciclar (saltea las filas sin acción). */
export function moveVoidSelection(direction: 1 | -1): void {
  const current = voidSelectionIndexSignal.value;
  if (current === null) {
    return;
  }
  const length = filteredVoidCandidatesSignal.value.length;
  for (let index = current + direction; index >= 0 && index < length; index += direction) {
    if (isVoidable(index)) {
      voidSelectionIndexSignal.value = index;
      return;
    }
  }
}

/** Enter sobre la lista: abre el modal de confirmación. */
export function selectForVoid(): void {
  const index = voidSelectionIndexSignal.value;
  if (index !== null && isVoidable(index)) {
    voidErrorSignal.value = null;
    voidConfirmingSignal.value = true;
  }
}

/** Click en una fila anulable (Etapa 2 de #94): lo mismo que ↑/↓ hasta ella + Enter. */
export function activateVoidRow(index: number): void {
  if (!isVoidable(index)) {
    return;
  }
  voidSelectionIndexSignal.value = index;
  selectForVoid();
}

/** Esc en el modal: vuelve a la lista con la misma selección y el mismo filtro. */
export function cancelVoidConfirmation(): void {
  voidConfirmingSignal.value = false;
  voidErrorSignal.value = null;
}

/** Sale de `/ANULAR` a la venta, limpiando el estado. */
export function exitVoidScreen(): void {
  voidCandidatesSignal.value = [];
  voidFilterSignal.value = '';
  voidSelectionIndexSignal.value = null;
  voidConfirmingSignal.value = false;
  voidErrorSignal.value = null;
  voidLoadedSignal.value = false;
  activeScreenSignal.value = 'sale';
}

/** Esc en la lista: con texto en el buscador lo limpia; si no, sale. */
export function escapeVoidScreen(): void {
  if (voidFilterSignal.value !== '') {
    updateVoidFilter('');
    return;
  }
  exitVoidScreen();
}

/** El nombre del cliente del documento, si sigue en el repositorio; si no, vacío. */
export function candidateCustomerName(candidate: VoidCandidate): string {
  const customerId =
    candidate.kind === 'sale' ? candidate.sale.customerId : candidate.payment.customerId;
  return customerId !== undefined
    ? (getCustomerRepository().getCustomer(customerId)?.name ?? '')
    : '';
}

function documentName(candidate: VoidCandidate): string {
  return candidate.kind === 'sale' ? saleName(candidate.sale) : receiptName(candidate.payment);
}

/** "¿Anular el Ticket #1?" / "¿Anular el Recibo #1 de Ana?" (#125). */
export function voidQuestion(candidate: VoidCandidate): string {
  const name = candidateCustomerName(candidate);
  const who = candidate.kind === 'collection' && name !== '' ? ` de ${name}` : '';
  return `¿Anular el ${documentName(candidate)}${who}?`;
}

/** En una cobranza con saldo conocido: cómo queda el saldo del cliente después de anularla. */
export function voidBalancePreview(candidate: VoidCandidate): string | undefined {
  if (candidate.kind !== 'collection') {
    return undefined;
  }
  const balance = customerBalancesSignal.value.get(candidate.payment.customerId);
  if (balance === undefined) {
    return undefined;
  }
  const name = candidateCustomerName(candidate);
  // La anulación mueve el saldo por `-total` de sí misma, es decir `+total` de la original.
  const after = roundAmount(balance + candidate.payment.total);
  return `Saldo ${name !== '' ? `de ${name}` : 'del cliente'}: ${formatBalance(balance)} → ${formatBalance(after)}`;
}

/** "Anulado el Ticket #1 con el Ticket #3" (la anulación siempre tiene número). */
function voidNotice(original: string, voidDocument: string): string {
  return `Anulado el ${original} con el ${voidDocument}`;
}

function finish(notice: string): void {
  exitVoidScreen();
  commandBarNoticeSignal.value = notice;
  // Mismo cuidado que `/CAJA`: si se llegó con un click, el overlay quedó cerrado y ocultaba el aviso.
  overlayDismissedSignal.value = false;
}

/** Enter en el modal: anula con un documento propio (#99, #125) y vuelve a la venta con un aviso. */
export async function confirmVoid(): Promise<void> {
  const index = voidSelectionIndexSignal.value;
  const candidate = index !== null ? filteredVoidCandidatesSignal.value[index] : undefined;
  if (candidate?.state !== 'voidable') {
    return;
  }
  let notice: string;
  if (candidate.kind === 'sale') {
    const result = await voidSaleAndPersist(candidate.sale.id);
    if (!result.ok) {
      voidErrorSignal.value = describeError(result);
      return;
    }
    notice = voidNotice(saleName(candidate.sale), saleName(result.value));
  } else {
    const result = await voidCollectionAndPersist(candidate.payment.id);
    if (!result.ok) {
      voidErrorSignal.value = describeError(result);
      return;
    }
    notice = voidNotice(receiptName(candidate.payment), receiptName(result.value.payment));
  }
  await refreshStockSnapshot();
  await refreshCustomerBalances();
  finish(notice);
}
