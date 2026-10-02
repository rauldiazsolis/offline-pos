import {
  savePrinterConfig,
  type CheckoutAction,
  type PrintFormat,
} from '../../storage/printer-config.ts';
import { describeError } from '../errors.ts';
import { sampleDocumentFor } from '../print/resolve-receipt.ts';
import {
  getReceiptPrinter,
  printerConfigSignal,
  printerErrorSignal,
  printerFormSignal,
} from '../state/printer.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { withFormat } from './printer-form-model.ts';

/** `/IMPRESORA` (#174): edita una copia de la config; solo Guardar la persiste. */
export function enterPrinterScreen(): void {
  printerFormSignal.value = printerConfigSignal.value;
  printerErrorSignal.value = null;
  activeScreenSignal.value = 'printer';
}

export function cancelPrinterScreen(): void {
  printerErrorSignal.value = null;
  activeScreenSignal.value = 'sale';
}

export function choosePrinterFormat(format: PrintFormat): void {
  printerFormSignal.value = withFormat(printerFormSignal.value, format);
}

export function choosePrinterCheckout(onCheckout: CheckoutAction): void {
  printerFormSignal.value = { ...printerFormSignal.value, onCheckout };
}

export function setPrinterHeader(header: string): void {
  printerFormSignal.value = { ...printerFormSignal.value, header };
}

export function setPrinterFooter(footer: string): void {
  printerFormSignal.value = { ...printerFormSignal.value, footer };
}

export function savePrinterForm(): void {
  const form = printerFormSignal.value;
  const saved = savePrinterConfig(form);
  if (!saved.ok) {
    printerErrorSignal.value = describeError(saved);
    return;
  }
  printerConfigSignal.value = form;
  printerErrorSignal.value = null;
  activeScreenSignal.value = 'sale';
}

/** La prueba de impresión: el ejemplo con lo que está en pantalla, sin guardar. */
export async function printTestReceipt(): Promise<void> {
  const form = printerFormSignal.value;
  if (form.format === 'none') {
    return;
  }
  await getReceiptPrinter().print(sampleDocumentFor(form), form.format);
}
