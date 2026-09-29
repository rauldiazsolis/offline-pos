import type { CustomerPayment } from '../domain/customer-payment.ts';
import { isVoidedPayment } from '../domain/customer-payment.ts';
import type { Sale } from '../domain/sale.ts';
import { isVoided, VOID_WINDOW_MS } from '../domain/sale-lifecycle.ts';
import { loadPaymentVoidOriginals, loadVoidedPaymentIds } from './customer-payment-repository.ts';
import { db } from './db.ts';
import { loadVoidedSaleIds, loadVoidOriginals } from './sale-repository.ts';

/** Una fila de `/ANULAR` (#99, #125): anulable, original ya anulada, o el documento de una anulación. */
export type VoidState = 'voidable' | 'voided' | 'void-document';
export type VoidCandidate =
  | { kind: 'sale'; sale: Sale; state: VoidState; original?: Sale }
  | { kind: 'collection'; payment: CustomerPayment; state: VoidState; original?: CustomerPayment };

export function candidateId(candidate: VoidCandidate): string {
  return candidate.kind === 'sale' ? candidate.sale.id : candidate.payment.id;
}

function candidateCreatedAt(candidate: VoidCandidate): string {
  return candidate.kind === 'sale' ? candidate.sale.createdAt : candidate.payment.createdAt;
}

/**
 * Lo que muestra `/ANULAR` (#125): todas las ventas y cobranzas de las últimas 24 h móviles
 * (la ventana de anulación, sin tope), anulaciones incluidas, lo más nuevo primero. Una anulación
 * cuya original quedó fuera de la ventana trae igual su original, para la etiqueta.
 */
export async function listVoidCandidates(now: string): Promise<VoidCandidate[]> {
  const since = new Date(Date.parse(now) - VOID_WINDOW_MS).toISOString();
  const [sales, payments] = await Promise.all([
    db.sales.where('createdAt').above(since).toArray(),
    db.customerPayments.where('createdAt').above(since).toArray(),
  ]);
  const [voidedSaleIds, saleOriginals, voidedPaymentIds, paymentOriginals] = await Promise.all([
    loadVoidedSaleIds(sales.map((sale) => sale.id)),
    loadVoidOriginals(sales),
    loadVoidedPaymentIds(payments.map((payment) => payment.id)),
    loadPaymentVoidOriginals(payments),
  ]);
  const saleCandidates = sales.map((sale): VoidCandidate => {
    if (sale.voidsSaleId !== undefined) {
      const original = saleOriginals.get(sale.voidsSaleId);
      return {
        kind: 'sale',
        sale,
        state: 'void-document',
        ...(original !== undefined ? { original } : {}),
      };
    }
    return { kind: 'sale', sale, state: isVoided(sale, voidedSaleIds) ? 'voided' : 'voidable' };
  });
  const paymentCandidates = payments.map((payment): VoidCandidate => {
    if (payment.voidsPaymentId !== undefined) {
      const original = paymentOriginals.get(payment.voidsPaymentId);
      return {
        kind: 'collection',
        payment,
        state: 'void-document',
        ...(original !== undefined ? { original } : {}),
      };
    }
    return {
      kind: 'collection',
      payment,
      state: isVoidedPayment(payment, voidedPaymentIds) ? 'voided' : 'voidable',
    };
  });
  return [...saleCandidates, ...paymentCandidates].sort((a, b) =>
    candidateCreatedAt(b).localeCompare(candidateCreatedAt(a)),
  );
}
