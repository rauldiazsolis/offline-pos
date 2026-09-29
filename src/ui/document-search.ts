import { Index } from 'flexsearch';
import type { CustomerPayment } from '../domain/customer-payment.ts';
import type { Sale } from '../domain/sale.ts';
import { lineLabel } from './components/document-rows.tsx';
import { getCatalogRepository } from './state/catalog.ts';
import { getCustomerRepository } from './state/customer-repository.ts';

/** Lo que encuentra el buscador en un ticket: número, cliente, productos, SKU y códigos. */
export function saleSearchText(sale: Sale): string {
  const customerName =
    sale.customerId !== undefined
      ? (getCustomerRepository().getCustomer(sale.customerId)?.name ?? '')
      : '';
  const lineNames = sale.lines.map(lineLabel).join(' ');
  const lineCodes = sale.lines
    .map((line) =>
      line.kind === 'product' ? getCatalogRepository().getProduct(line.productId) : undefined,
    )
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .map((p) => `${p.sku} ${p.barcodes.join(' ')}`)
    .join(' ');
  const number = sale.ticket !== undefined ? String(sale.ticket.number) : '';
  return `${number} ${customerName} ${lineNames} ${lineCodes}`;
}

/** Lo que encuentra en una cobranza (#101): como los tickets, "3", "#3" y el nombre del cliente. */
export function collectionSearchText(payment: CustomerPayment, customerName: string): string {
  const number = payment.receipt?.number;
  return `${number !== undefined ? String(number) : ''} recibo cobranza ${customerName}`;
}

/**
 * Filtro de `/RESUMEN` y `/ANULAR` (#125): FlexSearch por prefijo de palabra, conservando el orden
 * de `items`; también por número de ticket o de recibo ("12" o "#12").
 */
export function filterByText<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => string,
): T[] {
  const cleaned = query.trim().replace(/^#/, '');
  if (cleaned === '') return [...items];
  const index = new Index({ tokenize: 'forward' });
  items.forEach((item, position) => {
    index.add(position, text(item));
  });
  const positions = new Set(index.search(cleaned).map(Number));
  return items.filter((_, position) => positions.has(position));
}
