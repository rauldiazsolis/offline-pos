import {
  PRINT_FORMATS,
  type CheckoutAction,
  type PrintFormat,
  type PrinterConfig,
} from '../../storage/printer-config.ts';

/** Modelo puro del formulario de `/IMPRESORA` (#174). */
export const FORMAT_OPTIONS: readonly PrintFormat[] = PRINT_FORMATS;

export const FORMAT_LABELS: Record<PrintFormat, string> = {
  none: 'No imprimir',
  '58mm': '58 mm',
  '80mm': '80 mm',
  a6: 'A6',
};

export const CHECKOUT_LABELS: Record<CheckoutAction, string> = {
  print: 'Imprimir',
  show: 'Mostrar el comprobante',
  skip: 'Nada',
};

/** Sin papel no hay "Imprimir". */
export function checkoutOptions(format: PrintFormat): CheckoutAction[] {
  return format === 'none' ? ['show', 'skip'] : ['print', 'show', 'skip'];
}

/** Cambiar el formato; con "No imprimir", "Imprimir" pasa a "Mostrar el comprobante". */
export function withFormat(form: PrinterConfig, format: PrintFormat): PrinterConfig {
  const onCheckout = format === 'none' && form.onCheckout === 'print' ? 'show' : form.onCheckout;
  return { ...form, format, onCheckout };
}
