import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerAccount } from '../../domain/customer.ts';
import { db } from '../../storage/db.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import { cartSignal } from '../state/cart.ts';
import {
  checkoutBufferSignal,
  checkoutErrorSignal,
  checkoutPaymentsSignal,
  pendingHoldSignal,
} from '../state/checkout.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { receiptSaleSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  amountPaid,
  cancelCheckout,
  remainingToPay,
  submitCheckout,
} from './checkout-controller.ts';

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

function fakeCustomerRepository(account: CustomerAccount | undefined): void {
  setCustomerRepository({
    search: () => [],
    getCustomer: () => undefined,
    getCustomerAccount: () => Promise.resolve(account),
  });
}

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
  pendingHoldSignal.value = undefined;
  attachedCustomerSignal.value = undefined;
  receiptSaleSignal.value = null;
  activeScreenSignal.value = 'checkout';
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  setOnline(true);
  vi.unstubAllGlobals();
});

describe('submitCheckout', () => {
  it('agrega un pago parcial sin cerrar la venta', () => {
    checkoutBufferSignal.value = '100';
    void submitCheckout();

    expect(checkoutPaymentsSignal.value).toEqual([{ method: 'cash', amount: 100 }]);
    expect(amountPaid()).toBe(100);
    expect(remainingToPay()).toBe(100);
    expect(activeScreenSignal.value).toBe('checkout');
  });

  it('agrega un pago y cierra la venta en el mismo Enter si cubre el total', async () => {
    checkoutBufferSignal.value = '200';
    void submitCheckout();

    await vi.waitUntil(() => activeScreenSignal.value === 'receipt');

    expect(receiptSaleSignal.value?.status).toBe('closed');
    expect(cartSignal.value.lines).toEqual([]);
  });

  it('permite pagar en dos partes y cierra al completar el total', async () => {
    checkoutBufferSignal.value = '100';
    void submitCheckout();
    expect(activeScreenSignal.value).toBe('checkout');

    checkoutBufferSignal.value = '100';
    void submitCheckout();

    await vi.waitUntil(() => activeScreenSignal.value === 'receipt');
    expect(receiptSaleSignal.value?.payments).toHaveLength(2);
  });

  it('muestra un error con un monto inválido', () => {
    checkoutBufferSignal.value = 'abc';
    void submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(checkoutPaymentsSignal.value).toEqual([]);
  });
});

describe('/CUENTA', () => {
  const customer = { id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' };

  it('sin cliente adjunto, rechaza con account/no-customer-attached', async () => {
    checkoutBufferSignal.value = '/CUENTA';
    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(checkoutPaymentsSignal.value).toEqual([]);
  });

  it('con red y hold aprobado, cierra la venta a cuenta corriente', async () => {
    attachedCustomerSignal.value = customer;
    saveSyncConfig({ baseUrl: 'https://api.example.com' });
    setOnline(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ approved: true, holdId: 'hold-1' }),
      }),
    );

    checkoutBufferSignal.value = '/CUENTA';
    await submitCheckout();

    expect(receiptSaleSignal.value?.payments).toEqual([
      { method: 'account', amount: 200, reference: 'hold-1' },
    ]);
    expect(receiptSaleSignal.value?.customerId).toBe('c1');
  });

  it('con red y hold rechazado, muestra el error y no cierra la venta', async () => {
    attachedCustomerSignal.value = customer;
    saveSyncConfig({ baseUrl: 'https://api.example.com' });
    setOnline(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ approved: false, reasonCode: 'over-limit' }),
      }),
    );

    checkoutBufferSignal.value = '/CUENTA';
    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(activeScreenSignal.value).toBe('checkout');
  });

  it('sin red y dentro del margen, cierra la venta a cuenta corriente', async () => {
    attachedCustomerSignal.value = customer;
    setOnline(false);
    fakeCustomerRepository({
      customerId: 'c1',
      creditLimit: 1000,
      margin: 0,
      balance: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    checkoutBufferSignal.value = '/CUENTA';
    await submitCheckout();

    expect(receiptSaleSignal.value?.payments).toEqual([{ method: 'account', amount: 200 }]);
  });

  it('sin red y fuera del margen, rechaza con account/offline-limit-exceeded', async () => {
    attachedCustomerSignal.value = customer;
    setOnline(false);
    fakeCustomerRepository({
      customerId: 'c1',
      creditLimit: 100,
      margin: 0,
      balance: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    checkoutBufferSignal.value = '/CUENTA';
    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(activeScreenSignal.value).toBe('checkout');
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

  it('con un hold pendiente, lo libera (encola account-hold-release)', async () => {
    pendingHoldSignal.value = { holdId: 'hold-1', customerId: 'c1' };

    cancelCheckout();
    await vi.waitFor(async () => {
      expect(await db.outbox.count()).toBe(1);
    });

    const event = (await db.outbox.toArray())[0];
    expect(event).toMatchObject({ type: 'account-hold-release', holdId: 'hold-1' });
  });
});
