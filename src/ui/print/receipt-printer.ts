import type { PaperFormat } from '../../storage/printer-config.ts';
import type { ReceiptDocument } from './receipt-document.ts';

/**
 * Puerto de impresión (#174). La primera implementación es `window.print()` en un iframe
 * (`browser-printer.tsx`); ESC/POS directo (#188) va a ser otra. Vive en `ui/` y no en `domain/`
 * porque el documento ya es presentación (textos formateados).
 */
export interface ReceiptPrinter {
  /** Se resuelve cuando el navegador terminó (imprimió o se canceló el diálogo). */
  print(document: ReceiptDocument, format: PaperFormat): Promise<void>;
}
