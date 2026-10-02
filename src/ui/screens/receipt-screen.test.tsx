import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CustomerPayment } from '../../domain/customer-payment.ts';
import type { Sale } from '../../domain/sale.ts';
import { DEFAULT_PRINTER_CONFIG } from '../../storage/printer-config.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import type { ReceiptDocument } from '../print/receipt-document.ts';
import { ReceiptScreen } from './receipt-screen.tsx';
import { setCatalogRepository } from '../state/catalog.ts';
import { printerConfigSignal, setReceiptPrinter } from '../state/printer.ts';
import { receiptSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';

const SALE: Sale = {
  id: 'sale-1',
  lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }],
  payments: [{ method: 'cash', amount: 200 }],
  total: 200,
  status: 'closed',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const printed: { document: ReceiptDocument; format: string }[] = [];

/** El contenedor de la pantalla, que escucha las teclas (los keyDown burbujean hasta él). */
function receiptContainer(): Element {
  const element = screen.getByRole('heading').closest('[tabindex="-1"]');
  if (element === null) throw new Error('setup');
  return element;
}

beforeEach(() => {
  printed.length = 0;
  activeScreenSignal.value = 'receipt';
  receiptSignal.value = { source: { kind: 'sale', sale: SALE, copy: false }, returnTo: 'sale' };
  printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
  setReceiptPrinter({
    print: (document, format) => {
      printed.push({ document, format });
      return Promise.resolve();
    },
  });
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

afterEach(() => {
  printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
});

describe('ReceiptScreen', () => {
  it('muestra el número de ticket, no el id (#120)', () => {
    receiptSignal.value = {
      source: {
        kind: 'sale',
        sale: { ...SALE, ticket: { date: '2026-01-01', number: 12 } },
        copy: false,
      },
      returnTo: 'sale',
    };
    render(<ReceiptScreen />);

    expect(screen.getByText('Ticket #12')).not.toBeNull();
    expect(screen.queryByText(/sale-1/)).toBeNull();
  });

  it('muestra las líneas, el total y el medio de pago sin la palabra "Pago" ni paréntesis', () => {
    render(<ReceiptScreen />);

    expect(screen.getByText(/Arroz 1kg/)).not.toBeNull();
    expect(screen.getByText('Total')).not.toBeNull();
    expect(screen.getByText('Efectivo')).not.toBeNull();
    expect(screen.queryByText(/Pago/)).toBeNull();
    expect(screen.queryByText('Vuelto')).toBeNull();
  });

  it('se dibuja en el formato configurado', () => {
    printerConfigSignal.value = { ...DEFAULT_PRINTER_CONFIG, format: '58mm' };
    const { container } = render(<ReceiptScreen />);
    expect(container.querySelector('.receipt--58mm')).not.toBeNull();
  });

  it('Enter imprime con la impresora configurada, en su formato', () => {
    printerConfigSignal.value = { ...DEFAULT_PRINTER_CONFIG, format: '80mm' };
    render(<ReceiptScreen />);
    fireEvent.keyDown(receiptContainer(), { key: 'Enter' });
    expect(printed.map((p) => p.format)).toEqual(['80mm']);
    expect(printed[0]?.document.marks).toEqual([]);
  });

  it('el botón Imprimir hace lo mismo que Enter', () => {
    render(<ReceiptScreen />);
    fireEvent.click(screen.getByText('Imprimir (Enter)'));
    expect(printed.map((p) => p.format)).toEqual(['a6']);
  });

  it('con "No imprimir" no hay botón Imprimir y Enter no hace nada', () => {
    printerConfigSignal.value = { ...DEFAULT_PRINTER_CONFIG, format: 'none' };
    render(<ReceiptScreen />);
    expect(screen.queryByText('Imprimir (Enter)')).toBeNull();
    fireEvent.keyDown(receiptContainer(), { key: 'Enter' });
    expect(printed).toEqual([]);
  });

  it('Escape vuelve a la pantalla de venta', () => {
    render(<ReceiptScreen />);

    fireEvent.keyDown(receiptContainer(), { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
    expect(receiptSignal.value).toBeNull();
  });

  it('Esc vuelve a /RESUMEN si se abrió desde ahí', () => {
    receiptSignal.value = {
      source: { kind: 'sale', sale: SALE, copy: true },
      returnTo: 'cash-summary',
    };
    render(<ReceiptScreen />);
    expect(screen.getByText('COPIA')).not.toBeNull();

    fireEvent.keyDown(receiptContainer(), { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('cash-summary');
    expect(receiptSignal.value).toBeNull();
  });
});

function leftMouseDown(target: Element): MouseEvent {
  const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('ReceiptScreen — mouse (Etapa 2 de #94)', () => {
  it('un mousedown sobre el título no le saca el foco a la pantalla', () => {
    render(<ReceiptScreen />);
    expect(leftMouseDown(screen.getByText('Comprobante')).defaultPrevented).toBe(true);
  });
});

describe('ReceiptScreen — cobranza (#101)', () => {
  const payment: CustomerPayment = {
    id: 'cp1',
    customerId: 'c1',
    payments: [
      { method: 'cash', amount: 500 },
      { method: 'transfer', amount: 200 },
    ],
    total: 700,
    createdAt: '2026-09-27T12:00:00.000Z',
    receipt: { date: '2026-09-27', number: 3 },
  };

  function showCollection(balances: { before: number | undefined; after: number }): void {
    receiptSignal.value = {
      source: { kind: 'collection', payment, customerName: 'Ana', balances, copy: false },
      returnTo: 'sale',
    };
  }

  beforeEach(() => {
    saveSyncConfig({ type: 'rest', baseUrl: 'http://x', locale: 'es-AR' });
    showCollection({ before: 1500, after: 800 });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('muestra el recibo, el cliente, los medios, el total y el saldo anterior y nuevo', () => {
    render(<ReceiptScreen />);

    expect(screen.getByText('Recibo de cobranza')).not.toBeNull();
    expect(screen.getByText('Recibo #3')).not.toBeNull();
    expect(screen.getByText('Ana')).not.toBeNull();
    expect(screen.getByText('Efectivo')).not.toBeNull();
    expect(screen.getByText('500,00')).not.toBeNull();
    expect(screen.getByText('Transferencia')).not.toBeNull();
    expect(screen.getByText('700,00')).not.toBeNull();
    expect(screen.getByText('Saldo anterior: Debe $1.500,00')).not.toBeNull();
    expect(screen.getByText('Saldo nuevo: Debe $800,00')).not.toBeNull();
  });

  it('sin saldo previo dice "Sin saldo"', () => {
    showCollection({ before: undefined, after: -700 });
    render(<ReceiptScreen />);

    expect(screen.getByText('Saldo anterior: Sin saldo')).not.toBeNull();
  });

  it('Enter imprime y Esc vuelve a la venta limpiando el recibo', () => {
    render(<ReceiptScreen />);

    fireEvent.keyDown(receiptContainer(), { key: 'Enter' });
    expect(printed).toHaveLength(1);
    expect(printed[0]?.document.title).toBe('Recibo de cobranza');

    fireEvent.keyDown(receiptContainer(), { key: 'Escape' });
    expect(activeScreenSignal.value).toBe('sale');
    expect(receiptSignal.value).toBeNull();
  });
});
