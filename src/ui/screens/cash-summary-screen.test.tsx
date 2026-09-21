import 'fake-indexeddb/auto';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../storage/db.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import { setCatalogRepository } from '../state/catalog.ts';
import {
  cashSummaryContextSignal,
  cashSummaryTabSignal,
  paymentFilterSignal,
  productFilterSignal,
  selectedPaymentIndexSignal,
  selectedProductIndexSignal,
  selectedTicketIndexSignal,
  ticketFilterSignal,
} from '../state/cash-summary.ts';
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
        ? { id: 'p1', sku: 'SKU-1', barcodes: ['7791234567890'], name: 'Arroz 1kg', price: 100, taxRate: 0.21, category: 'almacen', tracksStock: true }
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
  selectedTicketIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
  selectedPaymentIndexSignal.value = null;
  // Signals a nivel de módulo — sin este reset, un test anterior que tipeó en el filtro (ej. "el
  // filtro de texto reduce la lista") lo deja contaminado para el siguiente test del archivo.
  ticketFilterSignal.value = '';
  productFilterSignal.value = '';
  paymentFilterSignal.value = '';
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

  it('no muestra el rótulo "Cliente:", solo el nombre', () => {
    render(<CashSummaryScreen />);

    expect(screen.queryByText(/Cliente:/)).toBeNull();
    expect(screen.getByText('Paula Torres')).not.toBeNull();
  });

  it('resalta la coincidencia del filtro en el nombre de la línea', () => {
    const { container } = render(<CashSummaryScreen />);

    fireEvent.input(screen.getByLabelText('Buscar'), { target: { value: 'Regalo' } });

    const marks = Array.from(container.querySelectorAll('mark')).map((m) => m.textContent);
    expect(marks).toContain('Regalo');
  });

  it('la búsqueda encuentra por SKU y por código de barras del producto', () => {
    render(<CashSummaryScreen />);

    fireEvent.input(screen.getByLabelText('Buscar'), { target: { value: 'SKU-1' } });
    expect(screen.getByText('200,00', { selector: '.ticket__total' })).not.toBeNull();

    fireEvent.input(screen.getByLabelText('Buscar'), { target: { value: '7791234567890' } });
    expect(screen.getByText('200,00', { selector: '.ticket__total' })).not.toBeNull();
  });

  it('click en un ticket lo selecciona y devuelve el foco al buscador', () => {
    render(<CashSummaryScreen />);
    const input = screen.getByLabelText('Buscar');
    input.blur();

    fireEvent.click(screen.getByText('Regalo'));

    expect(selectedTicketIndexSignal.value).toBe(1);
    expect(document.activeElement).toBe(input);
  });
});

describe('pestaña Productos', () => {
  it('cantidad total por producto, orden por cantidad descendente por defecto', () => {
    cashSummaryTabSignal.value = 'products';
    render(<CashSummaryScreen />);

    const rows = screen.getAllByTestId('product-row').map((el) => el.textContent);
    expect(rows[0]).toContain('2'); // p1 vendido 2 veces, único producto (freeform no cuenta)
  });

  it('la búsqueda de productos también encuentra por SKU', () => {
    cashSummaryTabSignal.value = 'products';
    render(<CashSummaryScreen />);

    fireEvent.input(screen.getByLabelText('Buscar'), { target: { value: 'SKU-1' } });

    expect(screen.getAllByTestId('product-row').length).toBe(1);
  });

  it('click en una fila la selecciona y devuelve el foco al buscador', () => {
    cashSummaryTabSignal.value = 'products';
    render(<CashSummaryScreen />);
    const input = screen.getByLabelText('Buscar');
    input.blur();

    fireEvent.click(screen.getAllByTestId('product-row')[0] as HTMLElement);

    expect(selectedProductIndexSignal.value).toBe(0);
    expect(document.activeElement).toBe(input);
  });
});

describe('pestaña Medios de pago', () => {
  it('desglosa los 6 medios, sin agrupar', () => {
    cashSummaryTabSignal.value = 'payments';
    render(<CashSummaryScreen />);
    const tabContent = within(screen.getByTestId('cash-summary-tab-content'));

    expect(tabContent.getByText('Efectivo')).not.toBeNull();
    expect(tabContent.getByText('Tarjeta de Débito')).not.toBeNull();
    expect(tabContent.getByText('Tarjeta de Crédito')).not.toBeNull();
  });

  it('tiene su propio filtro, que resalta sin ocultar ninguna fila', () => {
    cashSummaryTabSignal.value = 'payments';
    const { container } = render(<CashSummaryScreen />);

    fireEvent.input(screen.getByLabelText('Buscar'), { target: { value: 'efe' } });

    const tabContent = within(screen.getByTestId('cash-summary-tab-content'));
    expect(tabContent.getByText('Tarjeta de Débito')).not.toBeNull(); // sigue visible, no se oculta
    const marks = Array.from(container.querySelectorAll('mark')).map((m) => m.textContent);
    expect(marks).toContain('Efe');
  });

  it('click en una fila la selecciona y devuelve el foco al buscador', () => {
    cashSummaryTabSignal.value = 'payments';
    render(<CashSummaryScreen />);
    const input = screen.getByLabelText('Buscar');
    input.blur();

    fireEvent.click(screen.getByText('Tarjeta de Débito'));

    expect(selectedPaymentIndexSignal.value).toBe(1); // 'debit' es el índice 1 de ALL_METHODS
    expect(document.activeElement).toBe(input);
  });
});

describe('atajos de teclado nuevos (post-PR #65)', () => {
  it('Alt+2 cambia a Productos sin importar dónde esté el foco', () => {
    render(<CashSummaryScreen />);
    const ticketsButton = screen.getByRole('button', { name: /Tickets/ });
    ticketsButton.focus();

    fireEvent.keyDown(ticketsButton, { key: '2', altKey: true });

    expect(cashSummaryTabSignal.value).toBe('products');
  });

  it('"[Esc] Cerrar" es un botón clickeable', () => {
    render(<CashSummaryScreen />);

    fireEvent.click(screen.getByRole('button', { name: /Cerrar/ }));

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('tipear una letra con el foco en un botón vuelve al buscador y continúa lo ya tipeado', () => {
    render(<CashSummaryScreen />);
    const input = screen.getByLabelText('Buscar');
    fireEvent.input(input, { target: { value: 'Re' } });
    const productsButton = screen.getByRole('button', { name: /Productos/ });
    productsButton.focus();

    fireEvent.keyDown(productsButton, { key: 'g' });

    expect(ticketFilterSignal.value).toBe('Reg');
    expect(document.activeElement).toBe(input);
  });

  it('mousedown sobre algo no enfocable (el título) se cancela para no sacarle el foco al buscador', () => {
    render(<CashSummaryScreen />);

    const notCancelled = fireEvent.mouseDown(screen.getByText('Resumen del turno'));

    expect(notCancelled).toBe(false);
  });

  it('mousedown sobre el propio buscador no se cancela (deja reubicar el cursor)', () => {
    render(<CashSummaryScreen />);

    const notCancelled = fireEvent.mouseDown(screen.getByLabelText('Buscar'));

    expect(notCancelled).toBe(true);
  });

  it('Espacio con el foco en un botón no se redirige (deja que el botón se active)', () => {
    render(<CashSummaryScreen />);
    const productsButton = screen.getByRole('button', { name: /Productos/ });
    productsButton.focus();

    fireEvent.keyDown(productsButton, { key: ' ' });

    expect(ticketFilterSignal.value).toBe('');
  });
});

describe('navegación de teclado conectada a la pantalla real (regresión)', () => {
  // Bug real encontrado en revisión de código: el hook de navegación se testeaba aislado (Task 8)
  // y funcionaba perfecto ahí, pero `nav.handleKeyDown` nunca se llamaba desde el único
  // `onKeyDown` real de la pantalla (el input de filtro) — las flechas no hacían nada en la app de
  // verdad. Estos tests presionan las teclas sobre el input real, no sobre un harness aislado.
  it('PageDown en Tickets mueve selectedTicketIndexSignal', () => {
    render(<CashSummaryScreen />);
    expect(selectedTicketIndexSignal.value).toBe(0);

    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'PageDown' });

    expect(selectedTicketIndexSignal.value).toBe(1);
  });

  it('ArrowDown en Productos mueve selectedProductIndexSignal', () => {
    cashSummaryTabSignal.value = 'products';
    render(<CashSummaryScreen />);
    expect(selectedProductIndexSignal.value).toBeNull();

    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'ArrowDown' });

    expect(selectedProductIndexSignal.value).toBe(0);
  });

  it('tipear en el filtro de Tickets no deja un índice de selección fuera de rango', () => {
    render(<CashSummaryScreen />);
    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'PageDown' }); // selecciona el ticket 1 (de 2)
    expect(selectedTicketIndexSignal.value).toBe(1);

    fireEvent.input(screen.getByLabelText('Buscar'), { target: { value: 'Regalo' } }); // filtra a 1 solo ticket

    expect(selectedTicketIndexSignal.value).toBe(0);
  });
});
