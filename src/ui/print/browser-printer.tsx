import { render } from 'preact';
import type { PaperFormat } from '../../storage/printer-config.ts';
import type { ReceiptDocument } from './receipt-document.ts';
import type { ReceiptPrinter } from './receipt-printer.ts';
import { pageCss, RECEIPT_CSS } from './receipt-styles.ts';
import { ReceiptView } from './ReceiptView.tsx';

/** Red por si un navegador no dispara `afterprint`: el iframe no queda colgado para siempre. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * `window.print()` sobre un iframe oculto (#174): un documento aparte que solo tiene el
 * comprobante y su `@page`, así el papel no hereda la escala de texto, el tema ni ningún estilo de
 * la app, y se puede imprimir sin pasar por la pantalla del comprobante. `printWindow` se inyecta
 * en los tests (jsdom no implementa `print`).
 */
export function createBrowserPrinter(
  options: { printWindow?: (frameWindow: Window) => void; timeoutMs?: number } = {},
): ReceiptPrinter {
  const printWindow =
    options.printWindow ??
    ((frameWindow: Window) => {
      frameWindow.print();
    });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    print(receipt: ReceiptDocument, format: PaperFormat): Promise<void> {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      Object.assign(iframe.style, {
        position: 'fixed',
        right: '0',
        bottom: '0',
        width: '0',
        height: '0',
        border: '0',
      });
      document.body.appendChild(iframe);

      const frameWindow = iframe.contentWindow;
      const frameDocument = iframe.contentDocument;
      if (frameWindow === null || frameDocument === null) {
        // Invariante del navegador: un iframe recién insertado siempre tiene su documento.
        iframe.remove();
        throw new Error('El iframe de impresión no tiene documento');
      }
      frameDocument.title = receipt.title;
      const style = frameDocument.createElement('style');
      style.textContent = `${RECEIPT_CSS}\n${pageCss(format)}`;
      frameDocument.head.appendChild(style);
      render(<ReceiptView document={receipt} format={format} />, frameDocument.body);

      return new Promise((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          render(null, frameDocument.body);
          iframe.remove();
          resolve();
        };
        const timer = setTimeout(finish, timeoutMs);
        frameWindow.addEventListener('afterprint', finish);
        printWindow(frameWindow);
      });
    },
  };
}
