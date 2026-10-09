import type { ReceiptDocument } from '../../src/ui/print/receipt-document.ts';

/** Ancho del texto: el de un rollo de 58 mm, que entra en un mensaje de WhatsApp sin cortarse. */
const WIDTH = 32;

function row(left: string, right: string): string {
  const space = Math.max(1, WIDTH - left.length - right.length);
  return `${left}${' '.repeat(space)}${right}`;
}

/**
 * El comprobante como texto plano, para compartirlo (WhatsApp, mail) desde el celular. Las mismas
 * partes que el papel, en el mismo orden. Puro.
 */
export function receiptText(document: ReceiptDocument): string {
  const lines: string[] = [
    ...document.header,
    document.title,
    ...document.marks,
    ...document.meta,
    '-'.repeat(WIDTH),
  ];
  for (const block of document.blocks) {
    switch (block.kind) {
      case 'row':
        lines.push(row(block.left, block.right));
        break;
      case 'text':
        lines.push(block.text);
        break;
      case 'divider':
        lines.push('-'.repeat(WIDTH));
        break;
    }
  }
  lines.push(...document.footer);
  return lines.filter((line, index) => line !== '' || index > 0).join('\n');
}
