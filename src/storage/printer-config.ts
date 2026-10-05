import { z } from 'zod';
import { err, ok, type Result } from '../domain/result.ts';
import { storageKey } from './storage-namespace.ts';

/**
 * Config de impresión de esta terminal (#174): es del equipo físico, no de la conexión — vive
 * aparte de `SyncConfig`, no la toca `/CONFIG` ni "Borrar y cambiar" del wizard (que limpia solo
 * IndexedDB), y no viaja en `#connect`. `pos.reset()` sí la borra, como todo el prefijo.
 */
export const PRINT_FORMATS = ['none', '58mm', '80mm', 'a6'] as const;
export type PrintFormat = (typeof PRINT_FORMATS)[number];
/** Un formato con papel: lo que recibe la impresora y lo que dibuja `ReceiptView`. */
export type PaperFormat = Exclude<PrintFormat, 'none'>;

/** Al cobrar: Imprimir · Mostrar el comprobante · Nada (volver a la venta). */
export const CHECKOUT_ACTIONS = ['print', 'show', 'skip'] as const;
export type CheckoutAction = (typeof CHECKOUT_ACTIONS)[number];

const printerConfigSchema = z.object({
  format: z.enum(PRINT_FORMATS),
  onCheckout: z.enum(CHECKOUT_ACTIONS),
  header: z.string(),
  footer: z.string(),
});

export type PrinterConfig = z.infer<typeof printerConfigSchema>;

/** Sin config guardada, como antes de #174: comprobante en pantalla y Enter imprime. */
export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  format: 'a6',
  onCheckout: 'show',
  header: '',
  footer: '',
};

const STORAGE_KEY = storageKey('printer');

/** "No imprimir" no tiene papel: se dibuja (en pantalla) como A6. */
export function paperFormat(format: PrintFormat): PaperFormat {
  return format === 'none' ? 'a6' : format;
}

/** Sin papel no se puede imprimir al cobrar: se muestra el comprobante. */
export function effectiveCheckoutAction(config: PrinterConfig): CheckoutAction {
  return config.format === 'none' && config.onCheckout === 'print' ? 'show' : config.onCheckout;
}

/**
 * Nunca falla: algo ausente, roto o de otra versión cae al default. `localStorage`/`JSON.parse` son
 * el borde real — único try/catch de este módulo junto con `savePrinterConfig`.
 */
export function loadPrinterConfig(): PrinterConfig {
  let parsedJson: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    parsedJson = raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_PRINTER_CONFIG;
  }
  const parsed = printerConfigSchema.safeParse(parsedJson);
  return parsed.success ? parsed.data : DEFAULT_PRINTER_CONFIG;
}

export function savePrinterConfig(config: PrinterConfig): Result<void> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    return err('printer/save-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return ok(undefined);
}
