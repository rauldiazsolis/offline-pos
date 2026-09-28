import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Payment } from '../domain/sale.ts';
import { localDateKey } from '../domain/ticket-number.ts';
import { saveSyncConfig } from '../sync/config.ts';
import { getReceiptCounter } from '../sync/receipt-counter.ts';
import { collectAndPersist } from './customer-payment-repository.ts';
import { db } from './db.ts';
import { closeSaleAndPersist } from './sale-repository.ts';

const cashAndTransfer: Payment[] = [
  { method: 'cash', amount: 500 },
  { method: 'transfer', amount: 200 },
];

beforeEach(async () => {
  localStorage.clear();
  await db.open();
});

afterEach(async () => {
  vi.useRealTimers();
  localStorage.clear();
  db.close();
  await db.delete();
});

async function collect(payments: Payment[] = cashAndTransfer, customerId = 'c1') {
  const result = await collectAndPersist({ customerId, payments });
  if (!result.ok) throw new Error(`esperaba ok: ${result.error}`);
  return result.value;
}

describe('collectAndPersist (#101)', () => {
  it('guarda la cobranza, su movimiento, el saldo y el evento en una transacción', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'http://x', branch: 'Centro', pointOfSale: 'Caja 1' });

    const record = await collect();

    const today = localDateKey(record.payment.createdAt);
    expect(record.payment.total).toBe(700);
    expect(record.payment.receipt).toEqual({ date: today, number: 1 });
    expect('balanceBefore' in record).toBe(false);
    expect(record.balanceAfter).toBe(-700);

    expect(await db.customerPayments.get(record.payment.id)).toEqual(record.payment);
    const movements = await db.accountMovements.toArray();
    expect(movements).toEqual([
      expect.objectContaining({
        customerId: 'c1',
        type: 'payment',
        amount: -700,
        paymentId: record.payment.id,
      }),
    ]);
    expect((await db.customerBalances.get('c1'))?.balance).toBe(-700);

    const events = await db.outbox.toArray();
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('customer-payment');
    expect(event?.status).toBe('pending');
    expect(event?.origin).toEqual({ branch: 'Centro', pointOfSale: 'Caja 1' });
    expect(event?.type === 'customer-payment' ? event.payment.receipt?.number : undefined).toBe(1);
  });

  it('con saldo previo informa el anterior y el nuevo', async () => {
    await db.customerBalances.put({ customerId: 'c1', balance: 1500, updatedAt: 'x' });

    const record = await collect();

    expect(record.balanceBefore).toBe(1500);
    expect(record.balanceAfter).toBe(800);
  });

  it('dos cobranzas el mismo día: recibos 1 y 2, y el contador guardado', async () => {
    const first = await collect();
    const second = await collect([{ method: 'cash', amount: 100 }]);

    expect(first.payment.receipt.number).toBe(1);
    expect(second.payment.receipt.number).toBe(2);
    expect(getReceiptCounter()).toEqual({ date: second.payment.receipt.date, last: 2 });
  });

  it('día siguiente: vuelve a arrancar en 1', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 27, 12));
    await collect();
    await collect();
    vi.setSystemTime(new Date(2026, 8, 28, 9));

    const next = await collect();

    expect(next.payment.receipt).toEqual({ date: '2026-09-28', number: 1 });
  });

  it('datos locales borrados: el contador evita repetir el número', async () => {
    await collect();
    await collect();
    await db.customerPayments.clear();

    const next = await collect();

    expect(next.payment.receipt.number).toBe(3);
  });

  it('numeración independiente de los tickets de venta', async () => {
    await db.products.add({
      id: 'p1',
      sku: 'S1',
      barcodes: [],
      name: 'Arroz',
      price: 100,
      taxRate: 0,
      category: 'x',
      tracksStock: false,
    });
    const sale = await closeSaleAndPersist({
      cart: { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] },
      payments: [{ method: 'cash', amount: 100 }],
    });
    expect(sale.ok && sale.value.ticket?.number).toBe(1);

    const record = await collect();

    expect(record.payment.receipt.number).toBe(1);
  });

  it('sin pagos es un error y no escribe nada', async () => {
    const result = await collectAndPersist({ customerId: 'c1', payments: [] });

    expect(result).toEqual({
      ok: false,
      error: 'customer-payment/invalid',
      meta: { reason: 'empty' },
    });
    expect(await db.customerPayments.count()).toBe(0);
    expect(await db.accountMovements.count()).toBe(0);
    expect(await db.customerBalances.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
