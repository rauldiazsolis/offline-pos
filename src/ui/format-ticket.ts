import type { CustomerPayment } from '../domain/customer-payment.ts';
import type { Sale } from '../domain/sale.ts';
import { localDateKey, type DailyNumber } from '../domain/ticket-number.ts';
import { formatTime } from './format.ts';

/** `'YYYY-MM-DD'` → `'DD/MM'`, sin pasar por `Date` (la fecha del ticket ya es local). */
export function formatTicketDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** "Ticket #12"; una venta anterior a la numeración (#120) es "Ticket" a secas. */
export function ticketLabel(sale: Pick<Sale, 'ticket'>): string {
  return sale.ticket !== undefined ? `Ticket #${String(sale.ticket.number)}` : 'Ticket';
}

/** "Recibo #3" (#101); una cobranza anterior a la numeración es "Recibo" a secas. */
export function receiptLabel(payment: Pick<CustomerPayment, 'receipt'>): string {
  return payment.receipt !== undefined ? `Recibo #${String(payment.receipt.number)}` : 'Recibo';
}

type Numbered = { number?: DailyNumber | undefined; createdAt: string };

/**
 * La marca de un documento de anulación, ticket o recibo (spec de #120, §3; #125): "Anulación del
 * #12" si el original es de la misma fecha de numeración, "Anulación del #12 del 23/09" si es de
 * otra; un original sin número (anterior a la numeración) se nombra por su hora, como antes.
 */
function voidOf(voidDocument: Numbered, original: Numbered | undefined): string {
  if (original === undefined) {
    return 'Anulación';
  }
  if (original.number === undefined) {
    return `Anulación de ${formatTime(original.createdAt)}`;
  }
  const voidDate = voidDocument.number?.date ?? localDateKey(voidDocument.createdAt);
  const suffix =
    original.number.date === voidDate ? '' : ` del ${formatTicketDate(original.number.date)}`;
  return `Anulación del #${String(original.number.number)}${suffix}`;
}

/** La marca de un ticket de anulación: ver `voidOf`. */
export function voidOfLabel(
  voidTicket: Pick<Sale, 'ticket' | 'createdAt'>,
  original: Pick<Sale, 'ticket' | 'createdAt'> | undefined,
): string {
  return voidOf(
    { number: voidTicket.ticket, createdAt: voidTicket.createdAt },
    original !== undefined ? { number: original.ticket, createdAt: original.createdAt } : undefined,
  );
}

/** La marca de la anulación de un recibo (#125), mismo formato que la de un ticket. */
export function voidOfReceiptLabel(
  voidPayment: Pick<CustomerPayment, 'receipt' | 'createdAt'>,
  original: Pick<CustomerPayment, 'receipt' | 'createdAt'> | undefined,
): string {
  return voidOf(
    { number: voidPayment.receipt, createdAt: voidPayment.createdAt },
    original !== undefined
      ? { number: original.receipt, createdAt: original.createdAt }
      : undefined,
  );
}

/** Cómo se nombra un ticket en una frase (#125): "Ticket #1", o "ticket de las 17:20" sin número. */
export function saleName(sale: Pick<Sale, 'ticket' | 'createdAt'>): string {
  return sale.ticket !== undefined
    ? ticketLabel(sale)
    : `ticket de las ${formatTime(sale.createdAt)}`;
}

/** Cómo se nombra un recibo en una frase (#125): "Recibo #1", o "recibo de las 17:20" sin número. */
export function receiptName(payment: Pick<CustomerPayment, 'receipt' | 'createdAt'>): string {
  return payment.receipt !== undefined
    ? receiptLabel(payment)
    : `recibo de las ${formatTime(payment.createdAt)}`;
}
