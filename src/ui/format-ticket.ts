import type { CustomerPayment } from '../domain/customer-payment.ts';
import type { Sale } from '../domain/sale.ts';
import { localDateKey } from '../domain/ticket-number.ts';
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

/**
 * La marca de un ticket de anulación (spec de #120, §3): "Anulación del #12" si el original es de
 * la misma fecha de ticket, "Anulación del #12 del 23/09" si es de otra; un original sin número
 * (anterior a la Etapa 5) se nombra por su hora, como antes.
 */
export function voidOfLabel(
  voidTicket: Pick<Sale, 'ticket' | 'createdAt'>,
  original: Pick<Sale, 'ticket' | 'createdAt'> | undefined,
): string {
  if (original === undefined) {
    return 'Anulación';
  }
  if (original.ticket === undefined) {
    return `Anulación de ${formatTime(original.createdAt)}`;
  }
  const voidDate = voidTicket.ticket?.date ?? localDateKey(voidTicket.createdAt);
  const suffix =
    original.ticket.date === voidDate ? '' : ` del ${formatTicketDate(original.ticket.date)}`;
  return `Anulación del #${String(original.ticket.number)}${suffix}`;
}
