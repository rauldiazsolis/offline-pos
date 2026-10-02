import { effectiveCheckoutAction, paperFormat } from '../../storage/printer-config.ts';
import { receiptLabel, ticketLabel } from '../format-ticket.ts';
import { commandBarNoticeSignal, overlayDismissedSignal } from '../state/command-bar.ts';
import { getReceiptPrinter, printerConfigSignal } from '../state/printer.ts';
import { receiptSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { receiptDocumentFor, type ReceiptSource } from './resolve-receipt.ts';

/** Manda a imprimir sin esperar: la venta ya está registrada y se sigue operando. */
export function printReceipt(source: ReceiptSource): void {
  const config = printerConfigSignal.value;
  void getReceiptPrinter().print(receiptDocumentFor(source, config), paperFormat(config.format));
}

/** "Ticket #4" o "Recibo #3 de Ana": el documento como lo nombran los avisos. */
export function documentName(source: ReceiptSource): string {
  return source.kind === 'sale'
    ? ticketLabel(source.sale)
    : `${receiptLabel(source.payment)} de ${source.customerName}`;
}

/**
 * Sin comprobante en pantalla, el lugar de avisos de la barra dice qué pasó (como `/CAJA` y
 * `/ANULAR`). "Enviado a imprimir" y no "impreso": el POS no sabe si el diálogo se canceló.
 */
function noticeOnSale(notice: string): void {
  commandBarNoticeSignal.value = notice;
  // Si se llegó con un click, el overlay de la barra quedó cerrado y ocultaba el aviso (#28).
  overlayDismissedSignal.value = false;
}

/**
 * Lo que pasa después de registrar una venta o una cobranza (#174), según "Al cobrar" de
 * `/IMPRESORA`: imprimir y seguir, mostrar el comprobante, o volver directo a la venta.
 */
export function showOrPrintReceipt(source: ReceiptSource): void {
  switch (effectiveCheckoutAction(printerConfigSignal.value)) {
    case 'print':
      receiptSignal.value = null;
      noticeOnSale(`${documentName(source)} registrado y enviado a imprimir.`);
      activeScreenSignal.value = 'sale';
      printReceipt(source);
      return;
    case 'show':
      receiptSignal.value = { source, returnTo: 'sale' };
      activeScreenSignal.value = 'receipt';
      return;
    case 'skip':
      receiptSignal.value = null;
      noticeOnSale(`${documentName(source)} registrado.`);
      activeScreenSignal.value = 'sale';
      return;
  }
}

/**
 * Reimprimir desde `/RESUMEN`: con papel imprime ahí mismo (`'printed'`); sin papel, muestra la
 * copia en el comprobante (`'shown'`).
 */
export function reprintReceipt(source: ReceiptSource): 'printed' | 'shown' {
  if (printerConfigSignal.value.format === 'none') {
    receiptSignal.value = { source, returnTo: 'cash-summary' };
    activeScreenSignal.value = 'receipt';
    return 'shown';
  }
  printReceipt(source);
  return 'printed';
}
