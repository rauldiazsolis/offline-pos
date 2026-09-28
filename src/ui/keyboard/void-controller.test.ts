import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart } from '../../domain/cart.ts';
import type { Customer } from '../../domain/customer.ts';
import {
  collectAndPersist,
  voidCollectionAndPersist,
} from '../../storage/customer-payment-repository.ts';
import { db } from '../../storage/db.ts';
import { closeSaleAndPersist, voidSaleAndPersist } from '../../storage/sale-repository.ts';
import { candidateId } from '../../storage/void-repository.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import { setCatalogRepository } from '../state/catalog.ts';
import { commandBarNoticeSignal } from '../state/command-bar.ts';
import { customerBalancesSignal } from '../state/customer-balance.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  filteredVoidCandidatesSignal,
  voidCandidatesSignal,
  voidConfirmingSignal,
  voidErrorSignal,
  voidFilterSignal,
  voidSelectionIndexSignal,
} from '../state/void.ts';
import {
  activateVoidRow,
  cancelVoidConfirmation,
  confirmVoid,
  escapeVoidScreen,
  exitVoidScreen,
  loadVoidCandidates,
  moveVoidSelection,
  selectForVoid,
  updateVoidFilter,
  voidBalancePreview,
  voidQuestion,
} from './void-controller.ts';

const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };

// Un segundo entre documento y documento: el orden de `/ANULAR` es por `createdAt` y dos
// documentos del mismo milisegundo empatan.
let clock = Date.parse('2026-09-28T12:00:00.000Z');
function tick(): void {
  clock += 1000;
  vi.setSystemTime(clock);
}

function useCustomers(customers: Customer[]): void {
  setCustomerRepository({
    search: () => [],
    listRecent: () => [],
    getCustomer: (customerId) => customers.find((customer) => customer.id === customerId),
    getCustomerAccount: () => Promise.resolve(undefined),
    getCustomerBalance: () => Promise.resolve(undefined),
  });
}

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  tick();
  saveSyncConfig({ type: 'rest', baseUrl: 'http://x', locale: 'es-AR' });
  await db.open();
  await db.products.add({
    id: 'p1',
    sku: 'SKU-1',
    barcodes: ['111'],
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
            barcodes: ['111'],
            name: 'Arroz 1kg',
            price: 100,
            taxRate: 0.21,
            category: 'almacen',
            tracksStock: true,
          }
        : undefined,
    getStock: () => Promise.resolve(undefined),
  });
  useCustomers([]);

  voidCandidatesSignal.value = [];
  voidFilterSignal.value = '';
  voidSelectionIndexSignal.value = null;
  voidConfirmingSignal.value = false;
  voidErrorSignal.value = null;
  commandBarNoticeSignal.value = null;
  customerBalancesSignal.value = new Map();
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

async function collect(total = 500) {
  tick();
  const result = await collectAndPersist({
    customerId: 'c1',
    payments: [{ method: 'cash', amount: total }],
  });
  if (!result.ok) throw new Error(result.error);
  return result.value.payment;
}

describe('loadVoidCandidates', () => {
  it('carga las ventas cerradas, más recientes primero', async () => {
    await sell();
    await sell();

    await loadVoidCandidates();

    expect(filteredVoidCandidatesSignal.value).toHaveLength(2);
    expect(voidSelectionIndexSignal.value).toBe(0);
  });

  it('no selecciona nada si no hay ventas', async () => {
    await loadVoidCandidates();

    expect(filteredVoidCandidatesSignal.value).toEqual([]);
    expect(voidSelectionIndexSignal.value).toBeNull();
  });
});

describe('flujo de confirmación', () => {
  it('selectForVoid abre la confirmación', async () => {
    await sell();
    await loadVoidCandidates();

    selectForVoid();

    expect(voidConfirmingSignal.value).toBe(true);
  });

  it('cancelVoidConfirmation vuelve a la lista sin anular nada, con la misma selección y filtro', async () => {
    await sell();
    await loadVoidCandidates();
    updateVoidFilter('arroz');
    selectForVoid();

    cancelVoidConfirmation();

    expect(voidConfirmingSignal.value).toBe(false);
    expect(voidFilterSignal.value).toBe('arroz');
    expect(voidSelectionIndexSignal.value).toBe(0);
    await expect(db.sales.count()).resolves.toBe(1);
  });

  it('confirmVoid anula la venta seleccionada y sale de la pantalla', async () => {
    const sale = await sell();
    await loadVoidCandidates();
    selectForVoid();

    await confirmVoid();

    // #99: la anulación es un ticket propio que apunta al original.
    await expect(db.sales.where('voidsSaleId').equals(sale.id).count()).resolves.toBe(1);
    expect(activeScreenSignal.value).toBe('sale');
  });
});

describe('exitVoidScreen', () => {
  it('limpia el estado y vuelve a la pantalla de venta', async () => {
    await sell();
    await loadVoidCandidates();
    updateVoidFilter('arroz');

    exitVoidScreen();

    expect(activeScreenSignal.value).toBe('sale');
    expect(voidCandidatesSignal.value).toEqual([]);
    expect(voidFilterSignal.value).toBe('');
    expect(voidSelectionIndexSignal.value).toBeNull();
  });
});

describe('moveVoidSelection', () => {
  it('no hace nada si no hay ventas', () => {
    moveVoidSelection(1);
    expect(voidSelectionIndexSignal.value).toBeNull();
  });
});

describe('activateVoidRow (click, Etapa 2 de #94)', () => {
  it('selecciona la fila clickeada y pide confirmación', async () => {
    await sell();
    await sell();
    await loadVoidCandidates();

    activateVoidRow(1);

    expect(voidSelectionIndexSignal.value).toBe(1);
    expect(voidConfirmingSignal.value).toBe(true);
  });

  it('un índice fuera de la lista no hace nada', async () => {
    await loadVoidCandidates();

    activateVoidRow(0);

    expect(voidConfirmingSignal.value).toBe(false);
  });
});

describe('marcas de anulado (#99)', () => {
  async function seedVoidedAndVoidable(): Promise<{ voidableId: string }> {
    const first = await sell();
    tick();
    const voided = await voidSaleAndPersist(first.id);
    if (!voided.ok) throw new Error('setup falló');
    const second = await sell();
    return { voidableId: second.id };
  }

  it('preselecciona el primer anulable y ↑/↓ saltean las filas sin acción', async () => {
    const { voidableId } = await seedVoidedAndVoidable();

    await loadVoidCandidates();

    const states = filteredVoidCandidatesSignal.value.map((candidate) => candidate.state);
    expect(states).toEqual(['voidable', 'void-document', 'voided']);
    expect(voidSelectionIndexSignal.value).toBe(0);
    const first = filteredVoidCandidatesSignal.value[0];
    expect(first !== undefined ? candidateId(first) : undefined).toBe(voidableId);
    moveVoidSelection(1);
    expect(voidSelectionIndexSignal.value).toBe(0);
  });

  it('activateVoidRow sobre una fila sin acción no hace nada', async () => {
    await seedVoidedAndVoidable();
    await loadVoidCandidates();

    activateVoidRow(2);

    expect(voidSelectionIndexSignal.value).toBe(0);
    expect(voidConfirmingSignal.value).toBe(false);
  });

  it('sin ninguna fila anulable, la selección queda en null y no confirma', async () => {
    const sale = await sell();
    tick();
    await voidSaleAndPersist(sale.id);

    await loadVoidCandidates();
    selectForVoid();

    expect(voidSelectionIndexSignal.value).toBeNull();
    expect(voidConfirmingSignal.value).toBe(false);
  });
});

describe('/ANULAR con cobranzas (#125)', () => {
  it('lista ventas y cobranzas, preselecciona la más nueva anulable', async () => {
    await sell();
    const payment = await collect();

    await loadVoidCandidates();

    expect(filteredVoidCandidatesSignal.value.map((c) => c.kind)).toEqual(['collection', 'sale']);
    expect(voidSelectionIndexSignal.value).toBe(0);
    const first = filteredVoidCandidatesSignal.value[0];
    expect(first !== undefined ? candidateId(first) : undefined).toBe(payment.id);
  });

  it('el filtro reinicia la selección en la primera anulable del resultado', async () => {
    await sell();
    await collect();
    await loadVoidCandidates();
    moveVoidSelection(1);

    updateVoidFilter('arroz');

    expect(filteredVoidCandidatesSignal.value.map((c) => c.kind)).toEqual(['sale']);
    expect(voidSelectionIndexSignal.value).toBe(0);
  });

  it('un filtro sin coincidencias deja la selección en null', async () => {
    await sell();
    await loadVoidCandidates();

    updateVoidFilter('zzz');

    expect(filteredVoidCandidatesSignal.value).toEqual([]);
    expect(voidSelectionIndexSignal.value).toBeNull();
  });

  it('Esc con filtro lo limpia; sin filtro sale a la venta', async () => {
    await loadVoidCandidates();
    updateVoidFilter('x');

    escapeVoidScreen();
    expect(voidFilterSignal.value).toBe('');
    expect(activeScreenSignal.value).toBe('void');

    escapeVoidScreen();
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('confirmar una cobranza la anula, devuelve el saldo y avisa en la barra', async () => {
    const payment = await collect();
    await loadVoidCandidates();
    selectForVoid();

    tick();
    await confirmVoid();

    const voids = await db.customerPayments.where('voidsPaymentId').equals(payment.id).toArray();
    expect(voids).toHaveLength(1);
    expect((await db.customerBalances.get('c1'))?.balance).toBe(0);
    expect(customerBalancesSignal.value.get('c1')).toBe(0);
    expect(commandBarNoticeSignal.value).toBe('Anulado el Recibo #1 con el Recibo #2');
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('confirmar una venta avisa con los dos números de ticket', async () => {
    await sell();
    await loadVoidCandidates();
    selectForVoid();

    tick();
    await confirmVoid();

    expect(commandBarNoticeSignal.value).toBe('Anulado el Ticket #1 con el Ticket #2');
  });

  it('un error de negocio queda en el modal, sin salir', async () => {
    const payment = await collect();
    await loadVoidCandidates();
    tick();
    await voidCollectionAndPersist(payment.id); // otra pestaña la anuló mientras tanto
    selectForVoid();

    await confirmVoid();

    expect(voidErrorSignal.value).toBe('Esa cobranza ya estaba anulada.');
    expect(voidConfirmingSignal.value).toBe(true);
    expect(activeScreenSignal.value).toBe('void');
  });

  it('la pregunta nombra el documento y, en una cobranza, el saldo después de anular', async () => {
    const payment = await collect();
    customerBalancesSignal.value = new Map([['c1', -500]]);
    await loadVoidCandidates();
    const candidate = filteredVoidCandidatesSignal.value[0];
    if (candidate === undefined) throw new Error('setup falló');

    expect(payment.receipt.number).toBe(1);
    expect(voidQuestion(candidate)).toBe('¿Anular el Recibo #1?'); // sin cliente en el repositorio
    expect(voidBalancePreview(candidate)).toBe('Saldo del cliente: A favor $500,00 → Sin saldo');
  });

  it('con el cliente cargado, la pregunta y el saldo lo nombran', async () => {
    useCustomers([{ id: 'c1', name: 'Ana Gómez', createdAt: '2026-01-01T00:00:00.000Z' }]);
    await collect();
    customerBalancesSignal.value = new Map([['c1', -500]]);
    await loadVoidCandidates();
    const candidate = filteredVoidCandidatesSignal.value[0];
    if (candidate === undefined) throw new Error('setup falló');

    expect(voidQuestion(candidate)).toBe('¿Anular el Recibo #1 de Ana Gómez?');
    expect(voidBalancePreview(candidate)).toBe('Saldo de Ana Gómez: A favor $500,00 → Sin saldo');
  });

  it('una venta no tiene vista previa de saldo; sin saldo conocido, una cobranza tampoco', async () => {
    await sell();
    await collect();
    await loadVoidCandidates();
    const [collection, sale] = filteredVoidCandidatesSignal.value;
    if (collection === undefined || sale === undefined) throw new Error('setup falló');

    expect(voidQuestion(sale)).toBe('¿Anular el Ticket #1?');
    expect(voidBalancePreview(sale)).toBeUndefined();
    expect(voidBalancePreview(collection)).toBeUndefined();
  });
});
