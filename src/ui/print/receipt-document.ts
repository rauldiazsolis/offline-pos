import type { CustomerPayment } from '../../domain/customer-payment.ts';
import type { Payment, Sale } from '../../domain/sale.ts';
import { calculateLineTotal, calculateTotals } from '../../domain/totals.ts';
import { receiptLabel, ticketLabel } from '../format-ticket.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';

/**
 * Modelo del comprobante (#174), independiente de cómo se imprime: lo dibuja `ReceiptView` en la
 * pantalla y en el iframe de `window.print()`, y ESC/POS (#188) lo va a convertir en bytes. Puro:
 * recibe los nombres ya resueltos y los formateadores, así se testea sin catálogo ni locale.
 */
export type ReceiptBlock =
  | { kind: 'row'; left: string; right: string; bold?: boolean }
  | { kind: 'text'; text: string; bold?: boolean }
  | { kind: 'divider' };

export type ReceiptDocument = {
  header: string[];
  title: string;
  /** "COPIA" al reimprimir, "PRUEBA" en la prueba de impresión (y "ENTRENAMIENTO" con #177). */
  marks: string[];
  meta: string[];
  blocks: ReceiptBlock[];
  footer: string[];
};

/** Encabezado y pie libres de `/IMPRESORA`. */
export type ReceiptText = { header: string; footer: string };

export type ReceiptFormatters = {
  money: (amount: number) => string;
  quantity: (qty: number) => string;
  dateTime: (isoDate: string) => string;
  balance: (balance: number | undefined) => string;
};

/** Renglones de un texto libre, sin espacios sobrantes ni renglones vacíos en las puntas. */
export function textLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start++;
  while (end > start && lines[end - 1] === '') end--;
  return lines.slice(start, end);
}

function paymentRows(payments: readonly Payment[], format: ReceiptFormatters): ReceiptBlock[] {
  return payments.map((payment) => ({
    kind: 'row',
    left: PAYMENT_METHOD_LABELS[payment.method],
    right: format.money(payment.amount),
  }));
}

function copyMarks(copy: boolean): string[] {
  return copy ? ['COPIA'] : [];
}

export function saleReceiptDocument(params: {
  sale: Sale;
  /** El nombre de cada línea, en el mismo orden que `sale.lines`. */
  lineNames: readonly string[];
  copy: boolean;
  text: ReceiptText;
  format: ReceiptFormatters;
}): ReceiptDocument {
  const { sale, lineNames, format } = params;
  // Mismo cálculo que el carrito, sobre los datos ya cerrados de la venta.
  const totals = calculateTotals({
    lines: sale.lines,
    ...(sale.globalAdjustmentPercentage !== undefined
      ? { globalAdjustmentPercentage: sale.globalAdjustmentPercentage }
      : {}),
  });
  const adjustment = sale.globalAdjustmentPercentage ?? 0;
  const adjustmentRows: ReceiptBlock[] =
    adjustment === 0
      ? []
      : [
          {
            kind: 'row',
            left: `${adjustment > 0 ? 'Recargo' : 'Descuento'} global (${adjustment > 0 ? '+' : ''}${String(adjustment)}%)`,
            right: format.money(totals.globalAdjustmentAmount),
          },
        ];
  return {
    header: textLines(params.text.header),
    title: 'Comprobante',
    marks: copyMarks(params.copy),
    meta: [ticketLabel(sale), format.dateTime(sale.createdAt)],
    blocks: [
      { kind: 'divider' },
      ...sale.lines.map((line, index): ReceiptBlock => ({
        kind: 'row',
        left: `${format.quantity(line.qty)} × ${lineNames[index] ?? ''}`,
        right: format.money(calculateLineTotal(line)),
      })),
      { kind: 'divider' },
      ...adjustmentRows,
      { kind: 'row', left: 'Total', right: format.money(sale.total), bold: true },
      ...paymentRows(sale.payments, format),
    ],
    footer: textLines(params.text.footer),
  };
}

export function collectionReceiptDocument(params: {
  payment: CustomerPayment;
  customerName: string;
  /** Los saldos de cuando se cobró: solo en el comprobante original, nunca en una copia. */
  balances?: { before: number | undefined; after: number };
  copy: boolean;
  text: ReceiptText;
  format: ReceiptFormatters;
}): ReceiptDocument {
  const { payment, balances, format } = params;
  const balanceBlocks: ReceiptBlock[] =
    balances === undefined
      ? []
      : [
          { kind: 'text', text: `Saldo anterior: ${format.balance(balances.before)}` },
          { kind: 'text', text: `Saldo nuevo: ${format.balance(balances.after)}`, bold: true },
        ];
  return {
    header: textLines(params.text.header),
    title: 'Recibo de cobranza',
    marks: copyMarks(params.copy),
    meta: [receiptLabel(payment), format.dateTime(payment.createdAt), params.customerName],
    blocks: [
      { kind: 'divider' },
      ...paymentRows(payment.payments, format),
      { kind: 'divider' },
      { kind: 'row', left: 'Total', right: format.money(payment.total), bold: true },
      ...balanceBlocks,
    ],
    footer: textLines(params.text.footer),
  };
}

/** El ticket de ejemplo de `/IMPRESORA`: la vista previa y la prueba de impresión. */
export function sampleReceiptDocument(
  text: ReceiptText,
  format: ReceiptFormatters,
): ReceiptDocument {
  const sample = saleReceiptDocument({
    sale: {
      id: 'muestra',
      lines: [
        { kind: 'freeform', description: 'Artículo de ejemplo', qty: 2, unitPrice: 1250 },
        { kind: 'freeform', description: 'Otro artículo', qty: 1, unitPrice: 800 },
      ],
      payments: [{ method: 'cash', amount: 3300 }],
      total: 3300,
      status: 'closed',
      createdAt: new Date().toISOString(),
      // Solo se muestra el número ("Ticket #1"): la fecha de numeración no se usa.
      ticket: { date: '', number: 1 },
    },
    lineNames: ['Artículo de ejemplo', 'Otro artículo'],
    copy: false,
    text,
    format,
  });
  return { ...sample, marks: ['PRUEBA'] };
}
