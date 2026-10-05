import type { CustomerPayment } from '../../domain/customer-payment.ts';
import type { Sale } from '../../domain/sale.ts';
import type { PrinterConfig } from '../../storage/printer-config.ts';
import { isTrainingMode } from '../../storage/training-mode.ts';
import { lineLabel } from '../components/document-rows.tsx';
import { formatBalance } from '../format-balance.ts';
import { formatMoney, formatQuantity, resolveLocale } from '../format.ts';
import {
  collectionReceiptDocument,
  saleReceiptDocument,
  sampleReceiptDocument,
  type ReceiptDocument,
  type ReceiptFormatters,
} from './receipt-document.ts';

/**
 * De qué es un comprobante (#174): lo que se guarda al cerrar y al elegir una fila de `/RESUMEN`.
 * El documento se arma recién al mostrarlo o imprimirlo; los saldos de una cobranza viajan acá
 * porque después no se pueden recalcular.
 */
export type ReceiptSource =
  | { kind: 'sale'; sale: Sale; copy: boolean }
  | {
      kind: 'collection';
      payment: CustomerPayment;
      customerName: string;
      balances?: { before: number | undefined; after: number };
      copy: boolean;
    };

const formatters: ReceiptFormatters = {
  money: formatMoney,
  quantity: formatQuantity,
  dateTime: (isoDate) => new Date(isoDate).toLocaleString(resolveLocale()),
  balance: formatBalance,
};

/** #177: todo comprobante hecho en entrenamiento lo dice, también la copia y la prueba. */
function withTrainingMark(document: ReceiptDocument): ReceiptDocument {
  return isTrainingMode() ? { ...document, marks: [...document.marks, 'ENTRENAMIENTO'] } : document;
}

export function receiptDocumentFor(source: ReceiptSource, config: PrinterConfig): ReceiptDocument {
  const text = { header: config.header, footer: config.footer };
  if (source.kind === 'sale') {
    return withTrainingMark(
      saleReceiptDocument({
        sale: source.sale,
        lineNames: source.sale.lines.map(lineLabel),
        copy: source.copy,
        text,
        format: formatters,
      }),
    );
  }
  return withTrainingMark(
    collectionReceiptDocument({
      payment: source.payment,
      customerName: source.customerName,
      // Una copia nunca muestra saldos: los de ese momento no están guardados.
      ...(source.balances !== undefined && !source.copy ? { balances: source.balances } : {}),
      copy: source.copy,
      text,
      format: formatters,
    }),
  );
}

/** El ticket de ejemplo con el encabezado y el pie de una config (la del formulario, sin guardar). */
export function sampleDocumentFor(config: PrinterConfig): ReceiptDocument {
  return withTrainingMark(
    sampleReceiptDocument({ header: config.header, footer: config.footer }, formatters),
  );
}
