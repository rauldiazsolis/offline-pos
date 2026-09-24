import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openCashSessionAndPersist } from '../../storage/cash-session-repository.ts';
import { db } from '../../storage/db.ts';
import { closeSaleAndPersist, voidSaleAndPersist } from '../../storage/sale-repository.ts';
import type { Cart } from '../../domain/cart.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  voidConfirmingSignal,
  voidErrorSignal,
  voidSelectionIndexSignal,
  voidableSalesSignal,
} from '../state/void-sale.ts';
import {
  activateVoidRow,
  cancelVoidConfirmation,
  confirmVoid,
  exitVoidScreen,
  loadVoidableSales,
  moveVoidSelection,
  selectForVoid,
} from './void-controller.ts';

beforeEach(async () => {
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
  // Fase 6: closeSaleAndPersist exige un turno de caja abierto.
  await openCashSessionAndPersist({ openingAmount: 0 });

  voidableSalesSignal.value = [];
  voidSelectionIndexSignal.value = null;
  voidConfirmingSignal.value = false;
  voidErrorSignal.value = null;
});

afterEach(async () => {
  db.close();
  await db.delete();
});

const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };

describe('loadVoidableSales', () => {
  it('carga las ventas cerradas, más recientes primero', async () => {
    await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
    await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });

    await loadVoidableSales();

    expect(voidableSalesSignal.value).toHaveLength(2);
    expect(voidSelectionIndexSignal.value).toBe(0);
  });

  it('no selecciona nada si no hay ventas', async () => {
    await loadVoidableSales();

    expect(voidableSalesSignal.value).toEqual([]);
    expect(voidSelectionIndexSignal.value).toBeNull();
  });
});

describe('flujo de confirmación', () => {
  it('selectForVoid entra en modo confirmación', async () => {
    await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
    await loadVoidableSales();

    selectForVoid();

    expect(voidConfirmingSignal.value).toBe(true);
  });

  it('cancelVoidConfirmation vuelve a la lista sin anular nada', async () => {
    await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
    await loadVoidableSales();
    selectForVoid();

    cancelVoidConfirmation();

    expect(voidConfirmingSignal.value).toBe(false);
    await expect(db.sales.count()).resolves.toBe(1);
  });

  it('confirmVoid anula la venta seleccionada y sale de la pantalla', async () => {
    activeScreenSignal.value = 'void';
    const closed = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
    if (!closed.ok) throw new Error('setup falló');
    await loadVoidableSales();
    selectForVoid();

    await confirmVoid();

    // #99: la anulación es un ticket propio que apunta al original.
    await expect(db.sales.where('voidsSaleId').equals(closed.value.id).count()).resolves.toBe(1);
    expect(activeScreenSignal.value).toBe('sale');
  });
});

describe('exitVoidScreen', () => {
  it('limpia el estado y vuelve a la pantalla de venta', () => {
    activeScreenSignal.value = 'void';
    voidableSalesSignal.value = [
      {
        sale: {
          id: 's1',
          lines: [],
          payments: [],
          total: 0,
          status: 'closed',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        state: 'voidable',
      },
    ];

    exitVoidScreen();

    expect(activeScreenSignal.value).toBe('sale');
    expect(voidableSalesSignal.value).toEqual([]);
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
    await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
    await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
    await loadVoidableSales();

    activateVoidRow(1);

    expect(voidSelectionIndexSignal.value).toBe(1);
    expect(voidConfirmingSignal.value).toBe(true);
  });

  it('un índice fuera de la lista no hace nada', async () => {
    await loadVoidableSales();

    activateVoidRow(0);

    expect(voidConfirmingSignal.value).toBe(false);
  });
});

describe('marcas de anulado (#99)', () => {
  async function seedVoidedAndVoidable(): Promise<{ voidedId: string; voidableId: string }> {
    const first = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
    if (!first.ok) throw new Error('setup falló');
    const voided = await voidSaleAndPersist(first.value.id);
    if (!voided.ok) throw new Error('setup falló');
    const second = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
    if (!second.ok) throw new Error('setup falló');
    return { voidedId: first.value.id, voidableId: second.value.id };
  }

  it('preselecciona el primer anulable y ↑/↓ saltean las filas sin acción', async () => {
    const { voidableId } = await seedVoidedAndVoidable();

    await loadVoidableSales();

    const states = voidableSalesSignal.value.map((candidate) => candidate.state);
    expect(states).toEqual(['voidable', 'void-ticket', 'voided']);
    expect(voidSelectionIndexSignal.value).toBe(0);
    expect(voidableSalesSignal.value[0]?.sale.id).toBe(voidableId);
    moveVoidSelection(1);
    expect(voidSelectionIndexSignal.value).toBe(0);
  });

  it('activateVoidRow sobre una fila sin acción no hace nada', async () => {
    await seedVoidedAndVoidable();
    await loadVoidableSales();

    activateVoidRow(2);

    expect(voidSelectionIndexSignal.value).toBe(0);
    expect(voidConfirmingSignal.value).toBe(false);
  });

  it('sin ninguna fila anulable, la selección queda en null y no confirma', async () => {
    const closed = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
    if (!closed.ok) throw new Error('setup falló');
    await voidSaleAndPersist(closed.value.id);

    await loadVoidableSales();
    selectForVoid();

    expect(voidSelectionIndexSignal.value).toBeNull();
    expect(voidConfirmingSignal.value).toBe(false);
  });
});
