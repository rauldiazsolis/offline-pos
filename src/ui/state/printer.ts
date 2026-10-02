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

/** El formulario de `/IMPRESORA`: una copia de la config que se edita sin guardar. */
export const printerFormSignal = signal<PrinterConfig>(printerConfigSignal.value);
export const printerErrorSignal = signal<string | null>(null);
