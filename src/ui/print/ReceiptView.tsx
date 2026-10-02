import type { PaperFormat } from '../../storage/printer-config.ts';
import type { ReceiptBlock, ReceiptDocument } from './receipt-document.ts';
import './receipt.css';

function Block({ block }: { block: ReceiptBlock }) {
  switch (block.kind) {
    case 'divider':
      return <hr class="receipt__divider" />;
    case 'row':
      return (
        <div class={block.bold === true ? 'receipt__row receipt__row--bold' : 'receipt__row'}>
          <span>{block.left}</span>
          <span>{block.right}</span>
        </div>
      );
    case 'text':
      return (
        <p class={block.bold === true ? 'receipt__text receipt__text--bold' : 'receipt__text'}>
          {block.text}
        </p>
      );
  }
}

/**
 * Dibuja un `ReceiptDocument` (#174) en el ancho de su formato. Es el mismo componente en la
 * pantalla del comprobante, en la vista previa de `/IMPRESORA` y en el iframe de impresión.
 */
export function ReceiptView({
  document,
  format,
}: {
  document: ReceiptDocument;
  format: PaperFormat;
}) {
  return (
    <div class={`receipt receipt--${format}`}>
      {document.header.length > 0 && (
        <div class="receipt__header">
          {document.header.map((line, index) => (
            <p key={index}>{line === '' ? ' ' : line}</p>
          ))}
        </div>
      )}
      <h1 class="receipt__title">{document.title}</h1>
      {document.marks.map((mark) => (
        <p key={mark} class="receipt__mark">
          {mark}
        </p>
      ))}
      {document.meta.map((line, index) => (
        <p key={index} class="receipt__meta">
          {line}
        </p>
      ))}
      {document.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
      {document.footer.length > 0 && (
        <div class="receipt__footer">
          {document.footer.map((line, index) => (
            <p key={index}>{line === '' ? ' ' : line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
