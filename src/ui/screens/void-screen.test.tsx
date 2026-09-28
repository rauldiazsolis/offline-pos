import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart } from '../../domain/cart.ts';
import {
  collectAndPersist,
  voidCollectionAndPersist,
} from '../../storage/customer-payment-repository.ts';
import { db } from '../../storage/db.ts';
import { closeSaleAndPersist, voidSaleAndPersist } from '../../storage/sale-repository.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import { setCatalogRepository } from '../state/catalog.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  voidCandidatesSignal,
  voidConfirmingSignal,
  voidFilterSignal,
  voidSelectionIndexSignal,
} from '../state/void.ts';
import { VoidScreen } from './void-screen.tsx';

const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
const EMPTY = 'No hay ventas ni cobranzas de las últimas 24 horas para anular.';

// Un segundo entre documento y documento: el orden de `/ANULAR` es por `createdAt`.
let clock = Date.parse('2026-09-28T12:00:00.000Z');
function tick(): void {
  clock += 1000;
  vi.setSystemTime(clock);
}

beforeEach(async () => {
  // Los contadores de tickets y recibos viven en localStorage: sin esto, la numeración sigue.
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  tick();
  saveSyncConfig({ type: 'rest', baseUrl: 'http://x', locale: 'es-AR' });
  await db.open();
  await db.products.add({
    id: 'p1',
    sku: 'SKU-1',
    barcodes: [],
    name: 'Arroz 1kg',
    price: 100,
    taxRate: 0.21,
    category: 'almacen',
    tracksStock: true,
  });
  await db.stock.add({ productId: 'p1', quantity: 10, updatedAt: '2026-01-01T00:00:00.000Z' });
  setCatalogRepository({
    search: () => [],
    findByBarcodeOrSku: () => undefined,
    searchByCode: () => [],
    getProduct: (productId) =>
      productId === 'p1'
        ? {
            id: 'p1',
            sku: 'SKU-1',
            barcodes: [],
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
        ? { id: 'c1', name: 'Ana Gómez', createdAt: '2026-01-01T00:00:00.000Z' }
        : undefined,
    getCustomerAccount: () => Promise.resolve(undefined),
    getCustomerBalance: () => Promise.resolve(undefined),
  });
  voidCandidatesSignal.value = [];
  voidFilterSignal.value = '';
  voidSelectionIndexSignal.value = 0;
  voidConfirmingSignal.value = false;
  activeScreenSignal.value = 'void';
});

afterEach(async () => {
  vi.useRealTimers();
  localStorage.clear();
  db.close();
  await db.delete();
});

async function sell() {
  tick();
  const result = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

async function collect() {
  tick();
  const result = await collectAndPersist({
    customerId: 'c1',
    payments: [{ method: 'cash', amount: 500 }],
  });
  if (!result.ok) throw new Error(result.error);
  return result.value.payment;
}

function search(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>('Buscar');
}

describe('VoidScreen', () => {
  it('sin nada para anular muestra el vacío', async () => {
    render(<VoidScreen />);

    expect(await screen.findByText(EMPTY)).not.toBeNull();
  });

  it('Esc sin filtro vuelve a la pantalla de venta', async () => {
    render(<VoidScreen />);
    await screen.findByText(EMPTY);

    fireEvent.keyDown(search(), { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('Enter abre la confirmación, Enter de nuevo anula', async () => {
    const sale = await sell();

    render(<VoidScreen />);
    await screen.findByTestId('void-row');

    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(screen.getByRole('dialog').textContent).toContain('¿Anular el Ticket #1?');

    tick();
    fireEvent.keyDown(search(), { key: 'Enter' });

    await vi.waitUntil(
      async () => (await db.sales.where('voidsSaleId').equals(sale.id).count()) === 1,
    );
  });

  it('Esc en el modal vuelve a la lista sin anular', async () => {
    await sell();

    render(<VoidScreen />);
    await screen.findByTestId('void-row');
    fireEvent.keyDown(search(), { key: 'Enter' });
    fireEvent.keyDown(search(), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(activeScreenSignal.value).toBe('void');
    await expect(db.sales.count()).resolves.toBe(1);
  });

  it('el buscador es el único input, está enfocado y filtra la lista', async () => {
    await sell();
    await collect();

    render(<VoidScreen />);
    await screen.findAllByTestId('void-row');

    expect(document.activeElement).toBe(search());
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    fireEvent.input(search(), { target: { value: 'arroz' } });
    const rows = screen.getAllByTestId('void-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Arroz 1kg');

    fireEvent.input(search(), { target: { value: 'zzz' } });
    expect(screen.getByText('Ningún documento coincide con la búsqueda.')).not.toBeNull();
  });

  it('Esc con texto en el buscador lo limpia sin salir', async () => {
    await sell();

    render(<VoidScreen />);
    await screen.findByTestId('void-row');
    fireEvent.input(search(), { target: { value: 'zzz' } });
    fireEvent.keyDown(search(), { key: 'Escape' });

    expect(voidFilterSignal.value).toBe('');
    expect(activeScreenSignal.value).toBe('void');
  });

  it('el modal de una cobranza muestra la pregunta, el total y los dos botones, sobre la lista', async () => {
    await collect();

    render(<VoidScreen />);
    await screen.findByTestId('void-row');
    fireEvent.keyDown(search(), { key: 'Enter' });

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('¿Anular el Recibo #1 de Ana Gómez?');
    expect(dialog.textContent).toContain('Total 500,00');
    expect(screen.getByRole('button', { name: 'Volver (Esc)' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Anular (Enter)' })).not.toBeNull();
    expect(screen.getAllByTestId('void-row')).toHaveLength(1); // la lista sigue detrás
  });

  it('con el modal abierto, el buscador no recibe texto', async () => {
    await sell();

    render(<VoidScreen />);
    await screen.findByTestId('void-row');
    fireEvent.keyDown(search(), { key: 'Enter' });

    // `fireEvent` devuelve false si el handler canceló el evento.
    expect(fireEvent.keyDown(search(), { key: 'a' })).toBe(false);
    expect(search().value).toBe('');
  });

  it('una cobranza anulada y su anulación se ven con su marca, atenuadas, y con el vacío arriba', async () => {
    const payment = await collect();
    tick();
    await voidCollectionAndPersist(payment.id);

    render(<VoidScreen />);
    const rows = await screen.findAllByTestId('void-row');

    expect(rows[0]?.textContent).toContain('Anulación del #1');
    expect(rows[1]?.textContent).toContain('Anulada');
    expect(rows.every((row) => row.style.opacity === '0.5')).toBe(true);
    expect(screen.getByText(EMPTY)).not.toBeNull();
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(
      'El Recibo #2 es la anulación del Recibo #1: no se puede anular.',
    );
  });

  it('↓ llega a la original anulada; Enter dice con qué se anuló y la próxima tecla lo borra', async () => {
    const payment = await collect();
    tick();
    await voidCollectionAndPersist(payment.id);

    render(<VoidScreen />);
    await screen.findAllByTestId('void-row');
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    expect(voidSelectionIndexSignal.value).toBe(1);
    fireEvent.keyDown(search(), { key: 'Enter' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(
      'El Recibo #1 ya está anulado (con el Recibo #2).',
    );
    fireEvent.keyDown(search(), { key: 'ArrowUp' });
    expect(screen.getByRole('status').textContent).toBe('');
    expect(voidSelectionIndexSignal.value).toBe(0);
  });

  it('las ventas llevan su número y la marca de anulada o anulación', async () => {
    const sale = await sell();
    tick();
    await voidSaleAndPersist(sale.id);
    await sell();

    render(<VoidScreen />);
    const rows = await screen.findAllByTestId('void-row');

    expect(rows.map((row) => row.style.opacity)).toEqual(['', '0.5', '0.5']);
    expect(rows[0]?.textContent).toContain('Ticket #3');
    expect(rows[1]?.textContent).toContain('Ticket #2');
    expect(rows[1]?.textContent).toContain('Anulación del #1');
    expect(rows[2]?.textContent).toContain('Ticket #1');
    expect(rows[2]?.textContent).toContain('Anulada');
  });
});

function leftMouseDown(target: Element): MouseEvent {
  const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('VoidScreen — mouse (Etapa 2 de #94)', () => {
  it('click en una fila, después "Anular (Enter)"', async () => {
    const sale = await sell();

    render(<VoidScreen />);
    fireEvent.click(await screen.findByTestId('void-row'));
    expect(screen.getByRole('dialog')).not.toBeNull();
    tick();
    fireEvent.click(screen.getByRole('button', { name: 'Anular (Enter)' }));

    await vi.waitUntil(
      async () => (await db.sales.where('voidsSaleId').equals(sale.id).count()) === 1,
    );
  });

  it('click en una fila sin acción la selecciona y dice por qué no se anula', async () => {
    const sale = await sell();
    tick();
    await voidSaleAndPersist(sale.id);

    render(<VoidScreen />);
    const rows = await screen.findAllByTestId('void-row');
    fireEvent.click(rows[1] as HTMLElement);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(voidSelectionIndexSignal.value).toBe(1);
    expect(screen.getByRole('status').textContent).toBe(
      'El Ticket #1 ya está anulado (con el Ticket #2).',
    );
  });

  it('"Volver (Esc)" en el modal vuelve a la lista sin anular', async () => {
    const sale = await sell();

    render(<VoidScreen />);
    fireEvent.click(await screen.findByTestId('void-row'));
    fireEvent.click(screen.getByRole('button', { name: 'Volver (Esc)' }));

    expect(voidConfirmingSignal.value).toBe(false);
    await expect(db.sales.where('voidsSaleId').equals(sale.id).count()).resolves.toBe(0);
  });

  it('Enter con "Volver (Esc)" enfocado vuelve, no anula', async () => {
    const sale = await sell();

    render(<VoidScreen />);
    fireEvent.click(await screen.findByTestId('void-row'));
    const back = screen.getByRole('button', { name: 'Volver (Esc)' });
    back.focus();
    fireEvent.keyDown(back, { key: 'Enter' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(db.sales.where('voidsSaleId').equals(sale.id).count()).resolves.toBe(0);
  });

  it('"Volver a la venta (Esc)" sale', async () => {
    render(<VoidScreen />);
    await screen.findByText(EMPTY);
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la venta (Esc)' }));
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('un mousedown sobre el título no le saca el foco al buscador', async () => {
    render(<VoidScreen />);
    await screen.findByText(EMPTY);
    expect(leftMouseDown(screen.getByRole('heading', { name: 'Anular' })).defaultPrevented).toBe(
      true,
    );
  });
});
