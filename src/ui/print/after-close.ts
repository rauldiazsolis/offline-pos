import { effectiveCheckoutAction, paperFormat } from '../../storage/printer-config.ts';
import { getReceiptPrinter, printerConfigSignal } from '../state/printer.ts';
import { receiptSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { receiptDocumentFor, type ReceiptSource } from './resolve-receipt.ts';

/** Manda a imprimir sin esperar: la venta ya está registrada y se sigue operando. */
export function printReceipt(source: ReceiptSource): void {
  const config = printerConfigSignal.value;
  void getReceiptPrinter().print(receiptDocumentFor(source, config), paperFormat(config.format));
}

/**
 * Lo que pasa después de registrar una venta o una cobranza (#174), según "Al cobrar" de
 * `/IMPRESORA`: imprimir y seguir, mostrar el comprobante, o volver directo a la venta.
 */
export function showOrPrintReceipt(source: ReceiptSource): void {
  switch (effectiveCheckoutAction(printerConfigSignal.value)) {
    case 'print':
      receiptSignal.value = null;
      activeScreenSignal.value = 'sale';
      printReceipt(source);
      return;
    case 'show':
      receiptSignal.value = { source, returnTo: 'sale' };
      activeScreenSignal.value = 'receipt';
      return;
    case 'skip':
      receiptSignal.value = null;
      activeScreenSignal.value = 'sale';
      return;
  }
}

/** Reimprimir desde `/RESUMEN`: con papel imprime ahí mismo; sin papel, muestra la copia. */
export function reprintReceipt(source: ReceiptSource): void {
  if (printerConfigSignal.value.format === 'none') {
    receiptSignal.value = { source, returnTo: 'cash-summary' };
    activeScreenSignal.value = 'receipt';
    return;
  }
  printReceipt(source);
}
