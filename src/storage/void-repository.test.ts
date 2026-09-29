import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart } from '../domain/cart.ts';
import type { Sale } from '../domain/sale.ts';
import { collectAndPersist, voidCollectionAndPersist } from './customer-payment-repository.ts';
import { db } from './db.ts';
import { closeSaleAndPersist, voidSaleAndPersist } from './sale-repository.ts';
import { listVoidCandidates } from './void-repository.ts';

const cart: Cart = { lines: [{ kind: 'freeform', description: 'x', qty: 1, unitPrice: 100 }] };

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  await db.open();
});

afterEach(async () => {
  vi.useRealTimers();
  localStorage.clear();
  db.close();
  await db.delete();
});

async function saleAt(iso: string) {
  vi.setSystemTime(new Date(iso));
  const result = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 100 }] });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

async function collectionAt(iso: string) {
  vi.setSystemTime(new Date(iso));
  const result = await collectAndPersist({
    customerId: 'c1',
    payments: [{ method: 'cash', amount: 50 }],
  });
  if (!result.ok) throw new Error(result.error);
  return result.value.payment;
}

describe('listVoidCandidates (#125)', () => {
  it('mezcla ventas y cobranzas de las últimas 24 h, lo más nuevo primero, sin tope', async () => {
    await saleAt('2026-09-27T08:00:00.000Z'); // fuera de la ventana
    const sales = [];
    for (let i = 0; i < 21; i++) {
      sales.push(await saleAt(`2026-09-28T09:${String(i).padStart(2, '0')}:00.000Z`));
    }
    const payment = await collectionAt('2026-09-28T09:30:00.000Z');

    const candidates = await listVoidCandidates('2026-09-28T10:00:00.000Z');

    expect(candidates).toHaveLength(22);
    expect(candidates[0]).toMatchObject({
      kind: 'collection',
      payment: { id: payment.id },
      state: 'voidable',
    });
    expect(candidates[1]).toMatchObject({
      kind: 'sale',
      sale: { id: sales[20]?.id },
      state: 'voidable',
    });
  });

  it('marca la original anulada y la anulación, con su original', async () => {
    const sale = await saleAt('2026-09-28T09:00:00.000Z');
    const payment = await collectionAt('2026-09-28T09:10:00.000Z');
    vi.setSystemTime(new Date('2026-09-28T09:20:00.000Z'));
    await voidSaleAndPersist(sale.id);
    vi.setSystemTime(new Date('2026-09-28T09:25:00.000Z'));
    await voidCollectionAndPersist(payment.id);

    const candidates = await listVoidCandidates('2026-09-28T10:00:00.000Z');

    expect(candidates.map((c) => [c.kind, c.state])).toEqual([
      ['collection', 'void-document'],
      ['sale', 'void-document'],
      ['collection', 'voided'],
      ['sale', 'voided'],
    ]);
    expect(candidates[0]).toMatchObject({ original: { id: payment.id } });
    expect(candidates[1]).toMatchObject({ original: { id: sale.id } });
  });

  it('una anulación cuya original quedó fuera de la ventana trae la original igual', async () => {
    const payment = await collectionAt('2026-09-27T09:00:00.000Z');
    vi.setSystemTime(new Date('2026-09-28T08:59:00.000Z'));
    await voidCollectionAndPersist(payment.id);

    const candidates = await listVoidCandidates('2026-09-28T10:00:00.000Z');

    expect(candidates).toEqual([
      expect.objectContaining({ kind: 'collection', state: 'void-document', original: payment }),
    ]);
  });

  it('una venta con el status legado (antes de #99) cuenta como anulada', async () => {
    const legacy: Sale = {
      id: 'legacy',
      lines: [],
      payments: [],
      total: 100,
      status: 'voided',
      createdAt: '2026-09-28T08:00:00.000Z',
    };
    await db.sales.add(legacy);

    const candidates = await listVoidCandidates('2026-09-28T10:00:00.000Z');

    expect(candidates).toEqual([{ kind: 'sale', sale: legacy, state: 'voided' }]);
  });
});
