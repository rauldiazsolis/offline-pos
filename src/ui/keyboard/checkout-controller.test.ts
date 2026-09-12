import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../storage/db.ts';
import { cartSignal } from '../state/cart.ts';
import {
  checkoutBufferSignal,
  checkoutErrorSignal,
  checkoutPaymentsSignal,
} from '../state/checkout.ts';
import { receiptSaleSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  amountPaid,
  cancelCheckout,
  remainingToPay,
  submitCheckout,
} from './checkout-controller.ts';

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

  cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] };
  checkoutPaymentsSignal.value = [];
  checkoutBufferSignal.value = '';
  checkoutErrorSignal.value = null;
  receiptSaleSignal.value = null;
  activeScreenSignal.value = 'checkout';
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('submitCheckout', () => {
  it('agrega un pago parcial sin cerrar la venta', () => {
    checkoutBufferSignal.value = '100';
    submitCheckout();

    expect(checkoutPaymentsSignal.value).toEqual([{ method: 'cash', amount: 100 }]);
    expect(amountPaid()).toBe(100);
    expect(remainingToPay()).toBe(100);
    expect(activeScreenSignal.value).toBe('checkout');
  });

  it('agrega un pago y cierra la venta en el mismo Enter si cubre el total', async () => {
    checkoutBufferSignal.value = '200';
    submitCheckout();

    await vi.waitUntil(() => activeScreenSignal.value === 'receipt');

    expect(receiptSaleSignal.value?.status).toBe('closed');
    expect(cartSignal.value.lines).toEqual([]);
  });

  it('permite pagar en dos partes y cierra al completar el total', async () => {
    checkoutBufferSignal.value = '100';
    submitCheckout();
    expect(activeScreenSignal.value).toBe('checkout');

    checkoutBufferSignal.value = '100';
    submitCheckout();

    await vi.waitUntil(() => activeScreenSignal.value === 'receipt');
    expect(receiptSaleSignal.value?.payments).toHaveLength(2);
  });

  it('muestra un error con un monto inválido', () => {
    checkoutBufferSignal.value = 'abc';
    submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(checkoutPaymentsSignal.value).toEqual([]);
  });
});

describe('cancelCheckout', () => {
  it('vuelve a la pantalla de venta sin persistir nada', async () => {
    checkoutPaymentsSignal.value = [{ method: 'cash', amount: 50 }];

    cancelCheckout();

    expect(activeScreenSignal.value).toBe('sale');
    expect(checkoutPaymentsSignal.value).toEqual([]);
    await expect(db.sales.count()).resolves.toBe(0);
  });
});
