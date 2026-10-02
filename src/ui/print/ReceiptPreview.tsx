import type { PaperFormat } from '../../storage/printer-config.ts';
import type { ReceiptDocument } from './receipt-document.ts';
import { ReceiptView } from './ReceiptView.tsx';

/**
 * El papel en pantalla (#174): el comprobante y la vista previa de `/IMPRESORA`. Es un marco de ancho
 * fijo (el de A6 más un margen) que cancela el zoom de la app (`.receipt-paper`, tokens.css), con el
 * papel blanco centrado sobre un fondo gris: se ve el ancho del rollo, A6 no queda pegado al borde y
 * la pantalla no cambia de forma al cambiar el formato. Un formato más ancho que A6, si llega a
 * haber, se tendría que achicar para entrar acá.
 */
export function ReceiptPreview({
  document,
  format,
}: {
  document: ReceiptDocument;
  format: PaperFormat;
}) {
  return (
    <div
      class="receipt-paper"
      style={{
        boxSizing: 'border-box',
        width: 'calc(89mm + 8mm)',
        padding: '4mm 0',
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <ReceiptView document={document} format={format} />
    </div>
  );
}
