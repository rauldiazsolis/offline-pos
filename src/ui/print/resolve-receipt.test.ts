import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_CONFIG } from '../../storage/printer-config.ts';
import { setCatalogRepository } from '../state/catalog.ts';
import { receiptDocumentFor, sampleDocumentFor } from './resolve-receipt.ts';

beforeEach(() => {
  setCatalogRepository({
    search: () => [],
    findByBarcodeOrSku: () => undefined,
    searchByCode: () => [],
    getProduct: () => ({
      id: 'p1',
      sku: 'SKU-1',
      barcodes: [],
      name: 'Arroz 1kg',
      price: 100,
      taxRate: 0.21,
      category: 'almacen',
      tracksStock: true,
    }),
    getStock: () => Promise.resolve(undefined),
  });
});

describe('receiptDocumentFor', () => {
  it('resuelve el nombre del producto y usa el encabezado de la config', () => {
    const doc = receiptDocumentFor(
      {
        kind: 'sale',
        copy: false,
        sale: {
          id: 's1',
          lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }],
          payments: [{ method: 'cash', amount: 200 }],
          total: 200,
          status: 'closed',
          createdAt: '2026-10-02T12:00:00.000Z',
        },
      },
      { ...DEFAULT_PRINTER_CONFIG, header: 'Kiosco' },
    );
    expect(doc.header).toEqual(['Kiosco']);
    expect(doc.blocks.some((b) => b.kind === 'row' && b.left.endsWith('Arroz 1kg'))).toBe(true);
  });

  it('una cobranza con saldos los muestra', () => {
    const doc = receiptDocumentFor(
      {
        kind: 'collection',
        copy: false,
        customerName: 'Ana',
        balances: { before: 0, after: -500 },
        payment: {
          id: 'pay-1',
          customerId: 'c1',
          payments: [{ method: 'cash', amount: 500 }],
          total: 500,
          createdAt: '2026-10-02T13:00:00.000Z',
        },
      },
      DEFAULT_PRINTER_CONFIG,
    );
    expect(doc.meta).toContain('Ana');
    expect(doc.blocks.filter((b) => b.kind === 'text')).toHaveLength(2);
  });

  it('una cobranza copia no lleva saldos aunque vengan', () => {
    const doc = receiptDocumentFor(
      {
        kind: 'collection',
        copy: true,
        customerName: 'Ana',
        balances: { before: 0, after: -500 },
        payment: {
          id: 'pay-1',
          customerId: 'c1',
          payments: [{ method: 'cash', amount: 500 }],
          total: 500,
          createdAt: '2026-10-02T13:00:00.000Z',
        },
      },
      DEFAULT_PRINTER_CONFIG,
    );
    expect(doc.marks).toEqual(['COPIA']);
    expect(doc.blocks.some((b) => b.kind === 'text')).toBe(false);
  });
});

describe('sampleDocumentFor', () => {
  it('usa el encabezado y el pie de la config dada', () => {
    const doc = sampleDocumentFor({
      ...DEFAULT_PRINTER_CONFIG,
      header: 'Mi kiosco',
      footer: 'Chau',
    });
    expect(doc.header).toEqual(['Mi kiosco']);
    expect(doc.footer).toEqual(['Chau']);
  });
});
