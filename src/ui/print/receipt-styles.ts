import type { PaperFormat } from '../../storage/printer-config.ts';
import receiptCss from './receipt.css?inline';

/** El CSS del comprobante como texto: el iframe de impresión no ve las hojas de la app. */
export const RECEIPT_CSS: string = receiptCss;

/**
 * La página de cada formato. En las térmicas no se fija `size`: CSS no tiene "ancho fijo y largo
 * libre" (`58mm auto` es inválido y se ignora entero); el papel lo da el driver del rollo y el
 * ticket ya se dibuja en el ancho exacto.
 */
export function pageCss(format: PaperFormat): string {
  return format === 'a6'
    ? '@page { size: A6; margin: 8mm; } body { margin: 0; }'
    : '@page { margin: 0; } body { margin: 0; }';
}
