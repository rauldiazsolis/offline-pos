import 'fake-indexeddb/auto';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../storage/db.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import { setCatalogRepository } from '../state/catalog.ts';
import { cashSummaryContextSignal, cashSummaryTabSignal } from '../state/cash-summary.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { CashSummaryScreen } from './cash-summary-screen.tsx';

beforeEach(async () => {
  await db.open();
  saveSyncConfig({ baseUrl: 'https://api.example.com', locale: 'es-AR' });
  setCatalogRepository({
    search: () => [],
    findByBarcodeOrSku: () => undefined,
    getProduct: (productId) =>
      productId === 'p1'
        ? { id: 'p1', sku: 'SKU-1', barcodes: [], name: 'Arroz 1kg', price: 100, taxRate: 0.21, category: 'almacen', tracksStock: true }
        : undefined,
    getStock: () => Promise.resolve(undefined),
  });
  setCustomerRepository({
    search: () => [],
    listRecent: () => [],
    getCustomer: (customerId) =>
      customerId === 'c1' ? { id: 'c1', name: 'Paula Torres', createdAt: '2026-01-01T00:00:00.000Z' } : undefined,
    getCustomerAccount: () => Promise.resolve(undefined),
  });
  activeScreenSignal.value = 'cash-summary';
  cashSummaryContextSignal.value = {
    session: { id: 'cs1', openedAt: '2026-01-01T09:00:00.000Z', openingAmount: 100, sales: [] },
    summary: {
      salesCount: 2,
      totalsByMethod: { cash: 300, debit: 50, credit: 0, transfer: 0, qr: 0, account: 0 },
      totalCollected: 350,
      adjustmentTotal: -10,
      expectedCash: 400,
    },
    sales: [
      {
        id: 's1',
        lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }],
        payments: [{ method: 'cash', amount: 200 }],
        total: 200,
        status: 'closed',
        createdAt: '2026-01-01T10:00:00.000Z',
        customerId: 'c1',
      },
      {
        id: 's2',
        lines: [{ kind: 'freeform', description: 'Regalo', qty: 1, unitPrice: 50 }],
        payments: [{ method: 'debit', amount: 50 }],
        total: 50,
        status: 'closed',
        createdAt: '2026-01-01T11:00:00.000Z',
      },
    ],
    isClosed: false,
  };
  cashSummaryTabSignal.value = 'tickets';
});

afterEach(async () => {
  localStorage.clear();
  db.close();
  await db.delete();
});

describe('CashSummaryScreen', () => {
  it('muestra los 5 valores del panel lateral', () => {
    render(<CashSummaryScreen />);
    const sidebar = within(screen.getByTestId('cash-summary-sidebar'));

    expect(sidebar.getByText('350,00')).not.toBeNull(); // Total recaudado
    expect(sidebar.getByText('2')).not.toBeNull(); // Tickets emitidos
    expect(sidebar.getByText('300,00')).not.toBeNull(); // Efectivo
    expect(sidebar.getByText('50,00')).not.toBeNull(); // Otros pagos (debit)
  });

  it('Tab cambia de pestaña', () => {
    render(<CashSummaryScreen />);

    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'Tab' });

    expect(cashSummaryTabSignal.value).toBe('products');
  });

  it('Esc vuelve a la venta', () => {
    render(<CashSummaryScreen />);

    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });
});

describe('pestaña Tickets', () => {
  it('muestra cada ticket con su detalle', () => {
    render(<CashSummaryScreen />);

    expect(screen.getByText('200,00', { selector: '.ticket__total' })).not.toBeNull();
    expect(screen.getByText('Regalo')).not.toBeNull(); // línea libre
    expect(screen.getByText('Arroz 1kg')).not.toBeNull();
    expect(screen.getByText(/Paula Torres/)).not.toBeNull();
  });

  it('el filtro de texto reduce la lista', () => {
    render(<CashSummaryScreen />);

    fireEvent.input(screen.getByLabelText('Buscar'), { target: { value: 'Regalo' } });

    expect(screen.queryByText('200,00', { selector: '.ticket__total' })).toBeNull();
    expect(screen.getByText('Regalo')).not.toBeNull();
  });
});
