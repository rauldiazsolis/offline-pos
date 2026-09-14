import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openCashSessionAndPersist } from '../../storage/cash-session-repository.ts';
import { db } from '../../storage/db.ts';
import { closeSaleAndPersist } from '../../storage/sale-repository.ts';
import type { Cart } from '../../domain/cart.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  voidConfirmingSignal,
  voidSelectionIndexSignal,
  voidableSalesSignal,
} from '../state/void-sale.ts';
import { VoidSaleScreen } from './void-sale-screen.tsx';

const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };

beforeEach(async () => {
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
  // Fase 6: closeSaleAndPersist exige un turno de caja abierto.
  await openCashSessionAndPersist({ openingAmount: 0 });
  voidableSalesSignal.value = [];
  voidSelectionIndexSignal.value = null;
  voidConfirmingSignal.value = false;
  activeScreenSignal.value = 'void';
});

afterEach(async () => {
  db.close();
  await db.delete();
});

function getContainer(): HTMLElement {
  return screen.getByText('Anular venta').closest('[tabindex]') as HTMLElement;
}

describe('VoidSaleScreen', () => {
  it('muestra "no hay ventas" cuando no hay nada para anular', async () => {
    render(<VoidSaleScreen />);

    expect(await screen.findByText('No hay ventas cerradas para anular.')).not.toBeNull();
  });

  it('Escape en la lista vuelve a la pantalla de venta', async () => {
    render(<VoidSaleScreen />);
    await screen.findByText('No hay ventas cerradas para anular.');

    fireEvent.keyDown(getContainer(), { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('Enter sobre una venta pide confirmación, Enter de nuevo la anula', async () => {
    const closed = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
    if (!closed.ok) throw new Error('setup falló');

    render(<VoidSaleScreen />);
    await screen.findByRole('listitem');

    fireEvent.keyDown(getContainer(), { key: 'Enter' });
    expect(screen.getByText(/¿Anular esta venta\?/)).not.toBeNull();

    fireEvent.keyDown(getContainer(), { key: 'Enter' });

    await vi.waitUntil(async () => (await db.sales.get(closed.value.id))?.status === 'voided');
  });
});
