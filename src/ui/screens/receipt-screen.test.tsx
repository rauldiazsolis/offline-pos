import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptScreen } from './receipt-screen.tsx';
import { receiptCollectionSignal, receiptSaleSignal } from '../state/receipt.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { setCatalogRepository } from '../state/catalog.ts';

beforeEach(() => {
  receiptCollectionSignal.value = null;
  activeScreenSignal.value = 'receipt';
  receiptSaleSignal.value = {
    id: 'sale-1',
    lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }],
    payments: [{ method: 'cash', amount: 200 }],
    total: 200,
    status: 'closed',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
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

describe('ReceiptScreen', () => {
  it('muestra el número de ticket, no el id (#120)', () => {
    const sale = receiptSaleSignal.value;
    if (sale === null) throw new Error('setup');
    receiptSaleSignal.value = { ...sale, ticket: { date: '2026-01-01', number: 12 } };
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

  it('Enter dispara window.print()', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<ReceiptScreen />);

    fireEvent.keyDown(screen.getByText('Comprobante').closest('[tabindex]') ?? document.body, {
      key: 'Enter',
    });

    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('Escape vuelve a la pantalla de venta', () => {
    render(<ReceiptScreen />);

    fireEvent.keyDown(screen.getByText('Comprobante').closest('[tabindex]') ?? document.body, {
      key: 'Escape',
    });

    expect(activeScreenSignal.value).toBe('sale');
    expect(receiptSaleSignal.value).toBeNull();
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
  beforeEach(() => {
    saveSyncConfig({ type: 'rest', baseUrl: 'http://x', locale: 'es-AR' });
    receiptSaleSignal.value = null;
    receiptCollectionSignal.value = {
      payment: {
        id: 'cp1',
        customerId: 'c1',
        payments: [
          { method: 'cash', amount: 500 },
          { method: 'transfer', amount: 200 },
        ],
        total: 700,
        createdAt: '2026-09-27T12:00:00.000Z',
        receipt: { date: '2026-09-27', number: 3 },
      },
      balanceBefore: 1500,
      balanceAfter: 800,
      customerName: 'Ana',
    };
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
    localStorage.clear();
  });

  it('sin saldo previo dice "Sin saldo"', () => {
    const current = receiptCollectionSignal.value;
    if (current === null) throw new Error('setup');
    receiptCollectionSignal.value = {
      payment: current.payment,
      balanceAfter: -700,
      customerName: current.customerName,
    };
    render(<ReceiptScreen />);

    expect(screen.getByText('Saldo anterior: Sin saldo')).not.toBeNull();
    localStorage.clear();
  });

  it('Enter imprime y Esc vuelve a la venta limpiando el recibo', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<ReceiptScreen />);
    const container = screen.getByText('Recibo de cobranza').closest('[tabindex]');
    if (container === null) throw new Error('setup');

    fireEvent.keyDown(container, { key: 'Enter' });
    expect(print).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(container, { key: 'Escape' });
    expect(activeScreenSignal.value).toBe('sale');
    expect(receiptCollectionSignal.value).toBeNull();
    print.mockRestore();
    localStorage.clear();
  });
});
