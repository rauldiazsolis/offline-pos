import { describe, expect, it } from 'vitest';
import type { CustomerPayment } from '../../domain/customer-payment.ts';
import type { Sale } from '../../domain/sale.ts';
import {
  collectionReceiptDocument,
  saleReceiptDocument,
  sampleReceiptDocument,
  textLines,
  type ReceiptFormatters,
} from './receipt-document.ts';

const format: ReceiptFormatters = {
  money: (amount) => amount.toFixed(2),
  quantity: (qty) => String(qty),
  dateTime: (iso) => `F(${iso})`,
  balance: (balance) => (balance === undefined ? 'Sin saldo' : `S(${String(balance)})`),
};
const noText = { header: '', footer: '' };

const sale: Sale = {
  id: 'sale-1',
  lines: [
    { kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 },
    { kind: 'freeform', description: 'Bolsa', qty: 1, unitPrice: 50 },
  ],
  payments: [
    { method: 'cash', amount: 200 },
    { method: 'debit', amount: 50 },
  ],
  total: 250,
  status: 'closed',
  createdAt: '2026-10-02T12:00:00.000Z',
  ticket: { date: '2026-10-02', number: 12 },
};

describe('textLines', () => {
  it('parte en renglones y saca los vacíos del principio y del final', () => {
    expect(textLines('\n Kiosco \n\nAv. 742\n\n')).toEqual(['Kiosco', '', 'Av. 742']);
    expect(textLines('   ')).toEqual([]);
  });
});

describe('saleReceiptDocument', () => {
  it('arma el comprobante de una venta como el de hoy', () => {
    const doc = saleReceiptDocument({
      sale,
      lineNames: ['Arroz 1kg', 'Bolsa'],
      copy: false,
      text: { header: 'Kiosco\nAv. 742', footer: 'Gracias' },
      format,
    });
    expect(doc.header).toEqual(['Kiosco', 'Av. 742']);
    expect(doc.title).toBe('Comprobante');
    expect(doc.marks).toEqual([]);
    expect(doc.meta).toEqual(['Ticket #12', 'F(2026-10-02T12:00:00.000Z)']);
    expect(doc.blocks).toEqual([
      { kind: 'divider' },
      { kind: 'row', left: '2 × Arroz 1kg', right: '200.00' },
      { kind: 'row', left: '1 × Bolsa', right: '50.00' },
      { kind: 'divider' },
      { kind: 'row', left: 'Total', right: '250.00', bold: true },
      { kind: 'row', left: 'Efectivo', right: '200.00' },
      { kind: 'row', left: 'Tarjeta de Débito', right: '50.00' },
    ]);
    expect(doc.footer).toEqual(['Gracias']);
  });

  it('con recargo global suma su fila antes del total', () => {
    const doc = saleReceiptDocument({
      sale: { ...sale, globalAdjustmentPercentage: 10, total: 275 },
      lineNames: ['Arroz 1kg', 'Bolsa'],
      copy: false,
      text: noText,
      format,
    });
    expect(doc.blocks).toContainEqual({
      kind: 'row',
      left: 'Recargo global (+10%)',
      right: '25.00',
    });
  });

  it('con descuento global dice "Descuento"', () => {
    const doc = saleReceiptDocument({
      sale: { ...sale, globalAdjustmentPercentage: -10, total: 225 },
      lineNames: ['Arroz 1kg', 'Bolsa'],
      copy: false,
      text: noText,
      format,
    });
    expect(doc.blocks).toContainEqual({
      kind: 'row',
      left: 'Descuento global (-10%)',
      right: '-25.00',
    });
  });

  it('un ticket negativo (anulación) sale con sus montos en negativo', () => {
    const doc = saleReceiptDocument({
      sale: {
        ...sale,
        lines: [{ kind: 'freeform', description: 'Bolsa', qty: -1, unitPrice: 50 }],
        payments: [{ method: 'cash', amount: -50 }],
        total: -50,
        voidsSaleId: 'sale-0',
        ticket: { date: '2026-10-02', number: 13 },
      },
      lineNames: ['Bolsa'],
      copy: false,
      text: noText,
      format,
    });
    expect(doc.meta[0]).toBe('Ticket #13');
    expect(doc.blocks).toContainEqual({ kind: 'row', left: '-1 × Bolsa', right: '-50.00' });
    expect(doc.blocks).toContainEqual({ kind: 'row', left: 'Total', right: '-50.00', bold: true });
  });

  it('una copia lleva la marca COPIA', () => {
    const doc = saleReceiptDocument({
      sale,
      lineNames: ['Arroz 1kg', 'Bolsa'],
      copy: true,
      text: noText,
      format,
    });
    expect(doc.marks).toEqual(['COPIA']);
  });

  it('una venta sin número dice "Ticket" a secas', () => {
    const { ticket: _ticket, ...unnumbered } = sale;
    const doc = saleReceiptDocument({
      sale: unnumbered,
      lineNames: ['Arroz 1kg', 'Bolsa'],
      copy: false,
      text: noText,
      format,
    });
    expect(doc.meta[0]).toBe('Ticket');
  });

  it('sin encabezado ni pie, las listas quedan vacías', () => {
    const doc = saleReceiptDocument({
      sale,
      lineNames: ['Arroz 1kg', 'Bolsa'],
      copy: false,
      text: { header: '  \n', footer: '' },
      format,
    });
    expect(doc.header).toEqual([]);
    expect(doc.footer).toEqual([]);
  });
});

describe('collectionReceiptDocument', () => {
  const payment: CustomerPayment = {
    id: 'pay-1',
    customerId: 'c1',
    payments: [{ method: 'cash', amount: 500 }],
    total: 500,
    createdAt: '2026-10-02T13:00:00.000Z',
    receipt: { date: '2026-10-02', number: 3 },
  };

  it('arma el recibo con los saldos de ese momento', () => {
    const doc = collectionReceiptDocument({
      payment,
      customerName: 'Ana',
      balances: { before: 0, after: -500 },
      copy: false,
      text: noText,
      format,
    });
    expect(doc.title).toBe('Recibo de cobranza');
    expect(doc.meta).toEqual(['Recibo #3', 'F(2026-10-02T13:00:00.000Z)', 'Ana']);
    expect(doc.blocks).toEqual([
      { kind: 'divider' },
      { kind: 'row', left: 'Efectivo', right: '500.00' },
      { kind: 'divider' },
      { kind: 'row', left: 'Total', right: '500.00', bold: true },
      { kind: 'text', text: 'Saldo anterior: S(0)' },
      { kind: 'text', text: 'Saldo nuevo: S(-500)', bold: true },
    ]);
  });

  it('una copia no lleva saldos (no están guardados)', () => {
    const doc = collectionReceiptDocument({
      payment,
      customerName: 'Ana',
      copy: true,
      text: noText,
      format,
    });
    expect(doc.marks).toEqual(['COPIA']);
    expect(doc.blocks.some((block) => block.kind === 'text')).toBe(false);
  });
});

describe('sampleReceiptDocument', () => {
  it('es un ticket de ejemplo con el encabezado y el pie dados', () => {
    const doc = sampleReceiptDocument({ header: 'Mi kiosco', footer: 'Chau' }, format);
    expect(doc.header).toEqual(['Mi kiosco']);
    expect(doc.footer).toEqual(['Chau']);
    expect(doc.marks).toEqual(['PRUEBA']);
  });
});
