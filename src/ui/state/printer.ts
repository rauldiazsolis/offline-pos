import { signal } from '@preact/signals';
import { loadPrinterConfig, type PrinterConfig } from '../../storage/printer-config.ts';
import { createBrowserPrinter } from '../print/browser-printer.tsx';
import type { ReceiptPrinter } from '../print/receipt-printer.ts';

/** La config de impresión en memoria (#174): se lee al cargar y se actualiza al guardar en `/IMPRESORA`. */
export const printerConfigSignal = signal<PrinterConfig>(loadPrinterConfig());

let receiptPrinter: ReceiptPrinter = createBrowserPrinter();

export function getReceiptPrinter(): ReceiptPrinter {
  return receiptPrinter;
}

/** Para los tests: una impresora falsa que registra lo que se imprime. */
export function setReceiptPrinter(printer: ReceiptPrinter): void {
  receiptPrinter = printer;
}
