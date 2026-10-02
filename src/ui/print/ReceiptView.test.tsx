import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import type { ReceiptDocument } from './receipt-document.ts';
import { ReceiptView } from './ReceiptView.tsx';
import { pageCss } from './receipt-styles.ts';

const doc: ReceiptDocument = {
  header: ['Kiosco'],
  title: 'Comprobante',
  marks: ['COPIA'],
  meta: ['Ticket #12'],
  blocks: [
    { kind: 'divider' },
    { kind: 'row', left: 'Total', right: '250,00', bold: true },
    { kind: 'text', text: 'Saldo nuevo: Sin saldo' },
  ],
  footer: ['Gracias'],
};

describe('ReceiptView', () => {
  it('dibuja el encabezado, el título, la marca, las filas y el pie', () => {
    render(<ReceiptView document={doc} format="58mm" />);
    expect(screen.getByRole('heading', { name: 'Comprobante' })).not.toBeNull();
    expect(screen.getByText('Kiosco')).not.toBeNull();
    expect(screen.getByText('COPIA')).not.toBeNull();
    expect(screen.getByText('Ticket #12')).not.toBeNull();
    expect(screen.getByText('250,00')).not.toBeNull();
    expect(screen.getByText('Saldo nuevo: Sin saldo')).not.toBeNull();
    expect(screen.getByText('Gracias')).not.toBeNull();
  });

  it('lleva la clase de su formato', () => {
    const { container } = render(<ReceiptView document={doc} format="80mm" />);
    expect(container.querySelector('.receipt.receipt--80mm')).not.toBeNull();
  });

  it('una fila en negrita lleva su modificador', () => {
    const { container } = render(<ReceiptView document={doc} format="a6" />);
    expect(container.querySelector('.receipt__row--bold')?.textContent).toContain('Total');
  });
});

describe('pageCss', () => {
  it('A6 fija el tamaño; las térmicas solo sacan el margen', () => {
    expect(pageCss('a6')).toContain('size: A6');
    expect(pageCss('58mm')).not.toContain('size');
    expect(pageCss('58mm')).toContain('margin: 0');
  });
});
