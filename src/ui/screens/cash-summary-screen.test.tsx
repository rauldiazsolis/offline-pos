import 'fake-indexeddb/auto';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../storage/db.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import { setCatalogRepository } from '../state/catalog.ts';
import { buildDayEntries } from '../../domain/day-summary.ts';
import type { Sale } from '../../domain/sale.ts';
import { localDateKey, shiftDateKey } from '../../domain/ticket-number.ts';
import type { DayView } from '../../storage/cash-summary-repository.ts';
import {
  cashSummaryTabSignal,
  dayViewSignal,
  movementFilterSignal,
  paymentFilterSignal,
  productFilterSignal,
  selectedEntryIndexSignal,
  selectedPaymentIndexSignal,
  selectedProductIndexSignal,
} from '../state/cash-summary.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { CashSummaryScreen } from './cash-summary-screen.tsx';

const today = localDateKey(new Date().toISOString());

function dayView(sales: Sale[], extra: Partial<DayView> = {}): DayView {
  return {
    date: today,
    isToday: true,
    oldestDate: today,
    sales,
    entries: buildDayEntries({ sales, movements: [], counts: [] }),
    summary: {
      totalSold: 350,
      ticketCount: 2,
      voidedCount: 0,
      adjustmentTotal: -10,
      totalsByMethod: { cash: 300, debit: 50, credit: 0, transfer: 0, qr: 0, account: 0 },
      otherPayments: 50,
      cash: { sales: 300, income: 0, expense: 0, countAdjustments: 0 },
    },
    voidedSaleIds: new Set(),
    voidOriginals: new Map(),
    ...extra,
  };
}

beforeEach(async () => {
  await db.open();
  saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', locale: 'es-AR' });
  setCatalogRepository({
    search: () => [],
    findByBarcodeOrSku: () => undefined,
    searchByCode: () => [],
    getProduct: (productId) =>
      productId === 'p1'
        ? {
            id: 'p1',
            sku: 'SKU-1',
            barcodes: ['7791234567890'],
            name: 'Arroz 1kg',
            price: 100,
            taxRate: 0.21,
            category: 'almacen',
            tracksStock: true,
          }
        : undefined,
    getStock: () => Promise.resolve(undefined),
  });
  setCustomerRepository({
    search: () => [],
    listRecent: () => [],
    getCustomer: (customerId) =>
      customerId === 'c1'
        ? { id: 'c1', name: 'Paula Torres', createdAt: '2026-01-01T00:00:00.000Z' }
        : undefined,
    getCustomerAccount: () => Promise.resolve(undefined),
  });
  activeScreenSignal.value = 'cash-summary';
  dayViewSignal.value = dayView([
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
  ]);
  cashSummaryTabSignal.value = 'movements';
  selectedEntryIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
  selectedPaymentIndexSignal.value = null;
  // Signals a nivel de módulo — sin este reset, un test anterior que tipeó en el filtro (ej. "el
  // filtro de texto reduce la lista") lo deja contaminado para el siguiente test del archivo.
  movementFilterSignal.value = '';
  productFilterSignal.value = '';
  paymentFilterSignal.value = '';
});

afterEach(async () => {
  localStorage.clear();
  db.close();
  await db.delete();
});

/** Texto completo de un elemento, aunque el resaltado del filtro lo parta en varios nodos. */
function hasText(text: string): boolean {
  return screen.queryAllByText((_, element) => element?.textContent === text).length > 0;
}

describe('CashSummaryScreen', () => {
  it('muestra los valores del panel lateral', () => {
    render(<CashSummaryScreen />);
    const sidebar = within(screen.getByTestId('cash-summary-sidebar'));

    expect(sidebar.getByText('350,00')).not.toBeNull(); // Total vendido
    expect(sidebar.getByText('2')).not.toBeNull(); // Tickets emitidos
    expect(sidebar.getAllByText('300,00')).not.toHaveLength(0); // Cobros en efectivo
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

describe('pestaña Movimientos', () => {
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

    expect(selectedEntryIndexSignal.value).toBe(1);
    expect(document.activeElement).toBe(input);
  });
});

describe('pestaña Movimientos — marcas de anulado y números (#99, #120)', () => {
  it('"Ticket #N", "Anulada" y "Anulación del #N"', () => {
    const view = dayViewSignal.value;
    if (view === undefined) throw new Error('setup falló');
    const original = view.sales[0];
    if (original === undefined) throw new Error('setup falló');
    const numbered = { ...original, ticket: { date: today, number: 12 } };
    const voidTicket: Sale = {
      ...original,
      id: 'v1',
      total: -200,
      createdAt: '2026-01-01T12:00:00.000Z',
      voidsSaleId: 's1',
      ticket: { date: today, number: 13 },
    };
    dayViewSignal.value = dayView([numbered, ...view.sales.slice(1), voidTicket], {
      voidedSaleIds: new Set(['s1']),
      voidOriginals: new Map([['s1', numbered]]),
    });

    render(<CashSummaryScreen />);

    expect(screen.getByText('· Anulada')).not.toBeNull();
    expect(screen.getByText('· Anulación del #12')).not.toBeNull();
    expect(screen.getByText('Ticket #13')).not.toBeNull();
  });

  it('buscar "12" o "#12" encuentra el ticket 12', () => {
    const view = dayViewSignal.value;
    if (view === undefined) throw new Error('setup falló');
    const [first, second] = view.sales;
    if (first === undefined || second === undefined) throw new Error('setup falló');
    dayViewSignal.value = dayView([
      { ...first, ticket: { date: today, number: 12 } },
      { ...second, ticket: { date: today, number: 3 } },
    ]);
    render(<CashSummaryScreen />);

    fireEvent.input(screen.getByLabelText('Buscar'), { target: { value: '#12' } });
    expect(hasText('Ticket #12')).toBe(true);
    expect(hasText('Ticket #3')).toBe(false);

    fireEvent.input(screen.getByLabelText('Buscar'), { target: { value: '12' } });
    expect(hasText('Ticket #12')).toBe(true);
  });
});

describe('movimientos de caja y arqueos (#100)', () => {
  it('ingreso, egreso y arqueo en la lista; el buscador encuentra el concepto', () => {
    const view = dayViewSignal.value;
    if (view === undefined) throw new Error('setup falló');
    dayViewSignal.value = {
      ...view,
      entries: buildDayEntries({
        sales: view.sales,
        movements: [
          {
            id: 'm1',
            direction: 'in',
            amount: 500,
            concept: 'Cambio inicial',
            description: 'Del banco',
            source: 'manual',
            createdAt: '2026-01-01T08:00:00.000Z',
          },
          {
            id: 'm2',
            direction: 'out',
            amount: 200,
            concept: 'Proveedor',
            source: 'manual',
            createdAt: '2026-01-01T09:00:00.000Z',
          },
        ],
        counts: [
          { id: 'c1', expected: 1000, counted: 1200, createdAt: '2026-01-01T07:00:00.000Z' },
        ],
      }),
    };
    render(<CashSummaryScreen />);

    expect(screen.getByText('Ingreso · Cambio inicial')).not.toBeNull();
    expect(screen.getByText('Del banco')).not.toBeNull();
    expect(screen.getByText('+500,00')).not.toBeNull();
    expect(screen.getByText('−200,00')).not.toBeNull();
    expect(
      screen.getByText('Arqueo · contado $1.200,00 · esperado $1.000,00 · sobran $200,00'),
    ).not.toBeNull();

    fireEvent.input(screen.getByLabelText('Buscar'), { target: { value: 'provee' } });
    expect(hasText('Egreso · Proveedor')).toBe(true);
    expect(hasText('Ingreso · Cambio inicial')).toBe(false);
  });
});

describe('navegación por días (#100)', () => {
  it('encabezado con el día y botones deshabilitados en los extremos', () => {
    render(<CashSummaryScreen />);

    expect(screen.getByTestId('day-heading').textContent).toMatch(/^Hoy · /);
    expect(
      screen.getByRole('button', { name: '‹ Anterior (Alt+←)' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Siguiente (Alt+→) ›' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('un día vacío lo dice; en el día más viejo avisa de la limpieza', () => {
    const yesterday = shiftDateKey(today, -1);
    dayViewSignal.value = dayView([], { date: yesterday, isToday: false, oldestDate: yesterday });
    render(<CashSummaryScreen />);

    expect(screen.getByText('Sin movimientos este día')).not.toBeNull();
    expect(
      screen.getByText('Los datos de más de 7 días se limpian de esta terminal'),
    ).not.toBeNull();
    expect(screen.getByTestId('day-heading').textContent).toMatch(/^Ayer · /);
  });

  it('el saldo de efectivo actual solo aparece en hoy', () => {
    const view = dayViewSignal.value;
    if (view === undefined) throw new Error('setup falló');
    dayViewSignal.value = { ...view, balance: { balance: 1500 } };
    render(<CashSummaryScreen />);

    expect(screen.getByText('Saldo de efectivo actual')).not.toBeNull();
    expect(screen.getByText('sin arqueo previo')).not.toBeNull();
  });

  it('muestra cuántas anuladas hay entre los tickets emitidos', () => {
    const view = dayViewSignal.value;
    if (view === undefined) throw new Error('setup falló');
    dayViewSignal.value = { ...view, summary: { ...view.summary, voidedCount: 1 } };
    render(<CashSummaryScreen />);

    expect(screen.getByText('(1 anuladas)')).not.toBeNull();
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
    const movementsButton = screen.getByRole('button', { name: /Movimientos/ });
    movementsButton.focus();

    fireEvent.keyDown(movementsButton, { key: '2', altKey: true });

    expect(cashSummaryTabSignal.value).toBe('products');
  });

  it('"Cerrar (Esc)" es un botón clickeable', () => {
    render(<CashSummaryScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar (Esc)' }));

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('tipear una letra con el foco en un botón vuelve al buscador y continúa lo ya tipeado', () => {
    render(<CashSummaryScreen />);
    const input = screen.getByLabelText('Buscar');
    fireEvent.input(input, { target: { value: 'Re' } });
    const productsButton = screen.getByRole('button', { name: /Productos/ });
    productsButton.focus();

    fireEvent.keyDown(productsButton, { key: 'g' });

    expect(movementFilterSignal.value).toBe('Reg');
    expect(document.activeElement).toBe(input);
  });

  it('mousedown sobre algo no enfocable (el título) se cancela para no sacarle el foco al buscador', () => {
    render(<CashSummaryScreen />);

    const notCancelled = fireEvent.mouseDown(screen.getByText('Resumen del día'));

    expect(notCancelled).toBe(false);
  });

  it('el botón del medio no se cancela (autoscroll)', () => {
    render(<CashSummaryScreen />);

    const notCancelled = fireEvent.mouseDown(screen.getByText('Resumen del día'), { button: 1 });

    expect(notCancelled).toBe(true);
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

    expect(movementFilterSignal.value).toBe('');
  });
});

describe('navegación de teclado conectada a la pantalla real (regresión)', () => {
  // Bug real encontrado en revisión de código: el hook de navegación se testeaba aislado (Task 8)
  // y funcionaba perfecto ahí, pero `nav.handleKeyDown` nunca se llamaba desde el único
  // `onKeyDown` real de la pantalla (el input de filtro) — las flechas no hacían nada en la app de
  // verdad. Estos tests presionan las teclas sobre el input real, no sobre un harness aislado.
  it('PageDown en Movimientos mueve selectedEntryIndexSignal', () => {
    render(<CashSummaryScreen />);
    expect(selectedEntryIndexSignal.value).toBe(0);

    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'PageDown' });

    expect(selectedEntryIndexSignal.value).toBe(1);
  });

  it('ArrowDown en Productos mueve selectedProductIndexSignal', () => {
    cashSummaryTabSignal.value = 'products';
    render(<CashSummaryScreen />);
    expect(selectedProductIndexSignal.value).toBeNull();

    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'ArrowDown' });

    expect(selectedProductIndexSignal.value).toBe(0);
  });

  it('tipear en el filtro de Movimientos no deja un índice de selección fuera de rango', () => {
    render(<CashSummaryScreen />);
    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'PageDown' }); // selecciona el ticket 1 (de 2)
    expect(selectedEntryIndexSignal.value).toBe(1);

    fireEvent.input(screen.getByLabelText('Buscar'), { target: { value: 'Regalo' } }); // filtra a 1 solo ticket

    expect(selectedEntryIndexSignal.value).toBe(0);
  });
});
