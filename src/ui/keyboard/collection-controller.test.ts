import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../storage/db.ts';
import { DEFAULT_PRINTER_CONFIG } from '../../storage/printer-config.ts';
import { cartSignal } from '../state/cart.ts';
import {
  collectionBuffersSignal,
  collectionErrorSignal,
  emptyCollectionBuffers,
} from '../state/collection.ts';
import { customerBalancesSignal } from '../state/customer-balance.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { printerConfigSignal, setReceiptPrinter } from '../state/printer.ts';
import { receiptSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  cancelCollection,
  collectionBalancePreview,
  collectionTotalPreview,
  enterCollection,
  moveCollectionField,
  submitCollection,
} from './collection-controller.ts';

const ana = { id: 'c1', name: 'Ana', createdAt: '2026-01-01T00:00:00.000Z' };

beforeEach(async () => {
  localStorage.clear();
  await db.open();
  cartSignal.value = { lines: [] };
  attachedCustomerSignal.value = ana;
  customerBalancesSignal.value = new Map();
  receiptSignal.value = null;
  activeScreenSignal.value = 'collection';
  enterCollection();
});

afterEach(async () => {
  localStorage.clear();
  db.close();
  await db.delete();
});

describe('collection-controller (#101)', () => {
  it('enterCollection deja los cinco campos vacíos y sin error', () => {
    collectionBuffersSignal.value = { ...emptyCollectionBuffers(), cash: '10' };
    collectionErrorSignal.value = 'x';

    enterCollection();

    expect(collectionBuffersSignal.value).toEqual({
      cash: '',
      debit: '',
      credit: '',
      transfer: '',
      qr: '',
    });
    expect(collectionErrorSignal.value).toBeNull();
  });

  it('moveCollectionField avanza y retrocede sin ciclar', () => {
    expect(moveCollectionField('cash', 1)).toBe('debit');
    expect(moveCollectionField('qr', 1)).toBeUndefined();
    expect(moveCollectionField('cash', -1)).toBeUndefined();
  });

  it('el total suma lo válido y el saldo se ve en vivo', () => {
    customerBalancesSignal.value = new Map([['c1', 1500]]);
    collectionBuffersSignal.value = {
      ...emptyCollectionBuffers(),
      cash: '600',
      debit: '400',
      qr: 'abc',
    };

    expect(collectionTotalPreview()).toBe(1000);
    expect(collectionBalancePreview()).toEqual({ before: 1500, after: 500 });
  });

  it('sin montos avisa y no escribe nada', async () => {
    await submitCollection();

    expect(collectionErrorSignal.value).toBe('Ingresá al menos un monto.');
    expect(await db.customerPayments.count()).toBe(0);
    expect(activeScreenSignal.value).toBe('collection');
  });

  it('con un monto inválido avisa y no escribe nada', async () => {
    collectionBuffersSignal.value = { ...emptyCollectionBuffers(), debit: 'abc' };

    await submitCollection();

    expect(collectionErrorSignal.value).toBe('Uno de los pagos tiene un monto inválido.');
    expect(await db.customerPayments.count()).toBe(0);
  });

  it('confirma: comprobante, cliente desadjuntado, saldo en memoria y campos vacíos', async () => {
    collectionBuffersSignal.value = { ...emptyCollectionBuffers(), cash: '500' };

    await submitCollection();

    expect(activeScreenSignal.value).toBe('receipt');
    const source = receiptSignal.value?.source;
    const receipt = source?.kind === 'collection' ? source : null;
    expect(receipt?.payment.receipt?.number).toBe(1);
    expect(receipt?.customerName).toBe('Ana');
    expect(receipt?.balances?.after).toBe(-500);
    expect(attachedCustomerSignal.value).toBeUndefined();
    expect(customerBalancesSignal.value.get('c1')).toBe(-500);
    expect(collectionBuffersSignal.value).toEqual(emptyCollectionBuffers());
  });

  it('con "Al cobrar: Imprimir", registra, imprime el recibo con sus saldos y vuelve a la venta (#174)', async () => {
    const printed: string[] = [];
    setReceiptPrinter({
      print: (document, format) => {
        printed.push(
          `${format}:${document.title}:${String(document.blocks.filter((b) => b.kind === 'text').length)}`,
        );
        return Promise.resolve();
      },
    });
    printerConfigSignal.value = { ...DEFAULT_PRINTER_CONFIG, format: '80mm', onCheckout: 'print' };
    collectionBuffersSignal.value = { ...emptyCollectionBuffers(), cash: '500' };

    await submitCollection();

    expect(activeScreenSignal.value).toBe('sale');
    expect(receiptSignal.value).toBeNull();
    expect(printed).toEqual(['80mm:Recibo de cobranza:2']);
    expect(await db.customerPayments.count()).toBe(1);
    printerConfigSignal.value = DEFAULT_PRINTER_CONFIG;
  });

  it('cancelar vuelve a la venta sin escribir nada y con el cliente adjunto', async () => {
    collectionBuffersSignal.value = { ...emptyCollectionBuffers(), cash: '500' };

    cancelCollection();

    expect(activeScreenSignal.value).toBe('sale');
    expect(attachedCustomerSignal.value).toEqual(ana);
    expect(collectionBuffersSignal.value).toEqual(emptyCollectionBuffers());
    expect(await db.customerPayments.count()).toBe(0);
  });
});
