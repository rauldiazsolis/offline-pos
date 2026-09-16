import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptScreen } from './receipt-screen.tsx';
import { receiptSaleSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { setCatalogRepository } from '../state/catalog.ts';

beforeEach(() => {
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
