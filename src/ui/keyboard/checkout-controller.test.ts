import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerAccount } from '../../domain/customer.ts';
import { openCashSessionAndPersist } from '../../storage/cash-session-repository.ts';
import { db } from '../../storage/db.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import { cartSignal } from '../state/cart.ts';
import {
  checkoutBuffersSignal,
  checkoutErrorSignal,
  pendingHoldSignal,
} from '../state/checkout.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { receiptSaleSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  amountTendered,
  cancelCheckout,
  enterCheckout,
  moveCheckoutField,
  submitCheckout,
} from './checkout-controller.ts';

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

function fakeCustomerRepository(account: CustomerAccount | undefined): void {
  setCustomerRepository({
    search: () => [],
    listRecent: () => [],
    getCustomer: () => undefined,
    getCustomerAccount: () => Promise.resolve(account),
  });
}

function emptyBuffers() {
  return { cash: '', debit: '', credit: '', transfer: '', qr: '', account: '' };
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
  // Fase 6: closeSaleAndPersist exige un turno de caja abierto.
  await openCashSessionAndPersist({ openingAmount: 0 });

  cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] };
  checkoutBuffersSignal.value = emptyBuffers();
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

describe('amountTendered', () => {
  it('suma lo tipeado en todos los campos, tratando texto inválido como 0', () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '100', debit: 'abc', credit: '50' };

    expect(amountTendered()).toBe(150);
  });
});

describe('submitCheckout', () => {
  it('con el total exacto en efectivo, cierra la venta sin vuelto', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '200' };

    await submitCheckout();

    expect(receiptSaleSignal.value?.status).toBe('closed');
    expect(receiptSaleSignal.value?.payments).toEqual([{ method: 'cash', amount: 200 }]);
    expect(cartSignal.value.lines).toEqual([]);
    expect(activeScreenSignal.value).toBe('receipt');
  });

  it('con efectivo de más, guarda el neto en vez del monto tendido (resuelve el bug #48)', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '300' };

    await submitCheckout();

    expect(receiptSaleSignal.value?.payments).toEqual([{ method: 'cash', amount: 200 }]);
  });

  it('combina débito y efectivo', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), debit: '150', cash: '50' };

    await submitCheckout();

    expect(receiptSaleSignal.value?.payments).toEqual([
      { method: 'debit', amount: 150 },
      { method: 'cash', amount: 50 },
    ]);
  });

  it('no cubre el total: muestra error y no cierra la venta', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '100' };

    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(activeScreenSignal.value).toBe('checkout');
    expect(receiptSaleSignal.value).toBeNull();
  });

  it('un medio no-efectivo que supera el total: muestra error y no cierra', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), debit: '300' };

    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(activeScreenSignal.value).toBe('checkout');
  });

  it('un campo con texto inválido: muestra error', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: 'abc' };

    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
  });
});

describe('cuenta corriente', () => {
  const customer = { id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' };

  it('sin cliente adjunto, rechaza con account/no-customer-attached', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), account: '200' };

    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(receiptSaleSignal.value).toBeNull();
  });

  it('con red y hold aprobado, cierra la venta a cuenta corriente', async () => {
    attachedCustomerSignal.value = customer;
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });
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

    checkoutBuffersSignal.value = { ...emptyBuffers(), account: '200' };
    await submitCheckout();

    expect(receiptSaleSignal.value?.payments).toEqual([
      { method: 'account', amount: 200, reference: 'hold-1' },
    ]);
    expect(receiptSaleSignal.value?.customerId).toBe('c1');
  });

  it('con red y hold rechazado, muestra el error y no cierra la venta', async () => {
    attachedCustomerSignal.value = customer;
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });
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

    checkoutBuffersSignal.value = { ...emptyBuffers(), account: '200' };
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

    checkoutBuffersSignal.value = { ...emptyBuffers(), account: '200' };
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

    checkoutBuffersSignal.value = { ...emptyBuffers(), account: '200' };
    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(activeScreenSignal.value).toBe('checkout');
  });
});

describe('cancelCheckout', () => {
  it('vuelve a la pantalla de venta sin persistir nada', () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '50' };

    cancelCheckout();

    expect(activeScreenSignal.value).toBe('sale');
    expect(checkoutBuffersSignal.value).toEqual(emptyBuffers());
  });

  it('con un hold pendiente, lo libera (encola account-hold-release)', async () => {
    pendingHoldSignal.value = { holdId: 'hold-1', customerId: 'c1', amount: 200 };

    cancelCheckout();
    await vi.waitFor(async () => {
      expect(await db.outbox.count()).toBe(1);
    });

    const event = (await db.outbox.toArray())[0];
    expect(event).toMatchObject({ type: 'account-hold-release', holdId: 'hold-1' });
  });
});

describe('enterCheckout (#99)', () => {
  it('precarga Efectivo con el total, con el separador del locale', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', locale: 'es-AR' });
    cartSignal.value = {
      lines: [{ kind: 'freeform', description: 'x', qty: 1, unitPrice: 1234.5 }],
    };

    enterCheckout();

    expect(checkoutBuffersSignal.value.cash).toBe('1234,5');
  });

  it('con total negativo precarga el valor absoluto', () => {
    cartSignal.value = { lines: [{ kind: 'freeform', description: 'x', qty: -1, unitPrice: 500 }] };

    enterCheckout();

    expect(checkoutBuffersSignal.value.cash).toBe('500');
  });

  it('con total 0 no precarga nada', () => {
    cartSignal.value = {
      lines: [
        { kind: 'freeform', description: 'a', qty: 1, unitPrice: 100 },
        { kind: 'freeform', description: 'b', qty: -1, unitPrice: 100 },
      ],
    };

    enterCheckout();

    expect(checkoutBuffersSignal.value.cash).toBe('');
  });
});

describe('moveCheckoutField (#99)', () => {
  it('avanza, retrocede y no cicla', () => {
    expect(moveCheckoutField('cash', 1)).toBe('debit');
    expect(moveCheckoutField('debit', -1)).toBe('cash');
    expect(moveCheckoutField('cash', -1)).toBeUndefined();
  });

  it('saltea Cuenta corriente sin cliente adjunto', () => {
    expect(moveCheckoutField('qr', 1)).toBeUndefined();
    attachedCustomerSignal.value = { id: 'c1', name: 'Ana', createdAt: '2026-01-01T00:00:00.000Z' };
    expect(moveCheckoutField('qr', 1)).toBe('account');
    expect(moveCheckoutField('account', 1)).toBeUndefined();
  });
});

describe('modo devolución (#99)', () => {
  it('con cuenta corriente acredita sin pedir hold y cierra con pagos negativos', async () => {
    attachedCustomerSignal.value = { id: 'c1', name: 'Ana', createdAt: '2026-01-01T00:00:00.000Z' };
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });
    setOnline(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    cartSignal.value = {
      lines: [{ kind: 'freeform', description: 'dev', qty: -1, unitPrice: 500 }],
    };
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '300', account: '200' };

    await submitCheckout();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(receiptSaleSignal.value?.total).toBe(-500);
    expect(receiptSaleSignal.value?.payments).toEqual([
      { method: 'account', amount: -200 },
      { method: 'cash', amount: -300 },
    ]);
  });

  it('acreditar a cuenta corriente sin cliente adjunto es un error', async () => {
    cartSignal.value = {
      lines: [{ kind: 'freeform', description: 'dev', qty: -1, unitPrice: 500 }],
    };
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '300', account: '200' };

    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(receiptSaleSignal.value).toBeNull();
  });
});
