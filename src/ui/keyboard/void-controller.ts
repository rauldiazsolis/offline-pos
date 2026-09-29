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
  voidMessageSignal,
  voidSelectionIndexSignal,
} from '../state/void.ts';

function selectedCandidate(): VoidCandidate | undefined {
  return filteredVoidCandidatesSignal.value[voidSelectionIndexSignal.value];
}

/**
 * Ventas y cobranzas de las últimas 24 h (#125), lo más nuevo primero. La selección arranca en la
 * más nueva, como en `/RESUMEN`, aunque no se pueda anular.
 */
export async function loadVoidCandidates(): Promise<void> {
  voidConfirmingSignal.value = false;
  voidErrorSignal.value = null;
  voidMessageSignal.value = null;
  voidFilterSignal.value = '';
  voidSelectionIndexSignal.value = 0;
  voidLoadedSignal.value = false;
  voidCandidatesSignal.value = await listVoidCandidates(new Date().toISOString());
  voidLoadedSignal.value = true;
}

/** Cada tecla del buscador: filtra y vuelve a la primera fila del resultado. */
export function updateVoidFilter(text: string): void {
  voidFilterSignal.value = text;
  voidSelectionIndexSignal.value = 0;
  voidMessageSignal.value = null;
}

/** Cualquier otra tecla o click borra el mensaje de una fila sin acción. */
export function clearVoidMessage(): void {
  voidMessageSignal.value = null;
}

/** El documento que anula a `candidate`, si está entre los candidatos (siempre es más nuevo). */
function voidingDocumentName(candidate: VoidCandidate): string | undefined {
  for (const other of voidCandidatesSignal.value) {
    if (candidate.kind === 'sale' && other.kind === 'sale') {
      if (other.sale.voidsSaleId === candidate.sale.id) return saleName(other.sale);
    } else if (candidate.kind === 'collection' && other.kind === 'collection') {
      if (other.payment.voidsPaymentId === candidate.payment.id) return receiptName(other.payment);
    }
  }
  return undefined;
}

/**
 * Por qué una fila no se anula (prueba manual de #125): "El Ticket #1 ya está anulado (con el Ticket
 * #3)." o "El Ticket #3 es la anulación del Ticket #1: no se puede anular.".
 */
function notVoidableMessage(candidate: VoidCandidate): string {
  const name = documentName(candidate);
  if (candidate.state === 'voided') {
    const voider = voidingDocumentName(candidate);
    return `El ${name} ya está anulado${voider !== undefined ? ` (con el ${voider})` : ''}.`;
  }
  const original =
    candidate.kind === 'sale'
      ? candidate.original !== undefined
        ? saleName(candidate.original)
        : undefined
      : candidate.original !== undefined
        ? receiptName(candidate.original)
        : undefined;
  return original !== undefined
    ? `El ${name} es la anulación del ${original}: no se puede anular.`
    : `El ${name} es una anulación: no se puede anular.`;
}

/**
 * Enter sobre la lista: sobre una fila anulable abre el modal de confirmación; sobre la original ya
 * anulada o sobre una anulación, dice por qué no se puede.
 */
export function selectForVoid(): void {
  const candidate = selectedCandidate();
  if (candidate === undefined) {
    return;
  }
  if (candidate.state !== 'voidable') {
    voidMessageSignal.value = notVoidableMessage(candidate);
    return;
  }
  voidMessageSignal.value = null;
  voidErrorSignal.value = null;
  voidConfirmingSignal.value = true;
}

/** Click en una fila (Etapa 2 de #94): lo mismo que llegar a ella con ↑/↓ + Enter. */
export function activateVoidRow(index: number): void {
  if (filteredVoidCandidatesSignal.value[index] === undefined) {
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
  voidSelectionIndexSignal.value = 0;
  voidMessageSignal.value = null;
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
  const candidate = selectedCandidate();
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
