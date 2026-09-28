import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Sale } from '../domain/sale.ts';
import { saveSyncConfig } from '../sync/config.ts';
import {
  getCashBalance,
  listConceptSuggestions,
  recordCashCount,
  recordCashMovement,
} from './cash-repository.ts';
import { db } from './db.ts';

function cashSale(id: string, createdAt: string, amount: number): Sale {
  return {
    id,
    lines: [{ kind: 'freeform', description: 'x', qty: 1, unitPrice: amount }],
    payments: [{ method: 'cash', amount }],
    total: amount,
    status: 'closed',
    createdAt,
  };
}

beforeEach(async () => {
  localStorage.clear();
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('getCashBalance', () => {
  it('sin nada, saldo 0 y sin arqueo', async () => {
    await expect(getCashBalance()).resolves.toEqual({ balance: 0 });
  });
});

describe('recordCashCount', () => {
  it('con diferencia guarda el arqueo, el ajuste y su evento', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'http://x', branch: 'Centro', pointOfSale: 'Caja 1' });
    await db.sales.add(cashSale('s1', '2026-09-24T10:00:00.000Z', 500));

    const result = await recordCashCount(700);
    if (!result.ok) throw new Error('falló');
    const { count, adjustment } = result.value;

    expect(count).toMatchObject({ expected: 500, counted: 700 });
    expect(count.adjustmentId).toBe(adjustment?.id);
    await expect(db.cashCounts.toArray()).resolves.toHaveLength(1);
    await expect(db.cashMovements.get(adjustment?.id ?? '')).resolves.toMatchObject({
      source: 'count-adjustment',
      direction: 'in',
      amount: 200,
    });
    const event = await db.outbox.get(adjustment?.id ?? '');
    expect(event).toMatchObject({
      type: 'cash-movement',
      status: 'pending',
      origin: { branch: 'Centro', pointOfSale: 'Caja 1' },
    });
    await expect(getCashBalance()).resolves.toEqual({ balance: 700, lastCountAt: count.createdAt });
  });

  it('sin diferencia guarda el arqueo pero no un movimiento ni un evento', async () => {
    await recordCashCount(0);
    const result = await recordCashCount(0);

    expect(result.ok && result.value.adjustment).toBeUndefined();
    await expect(db.cashCounts.count()).resolves.toBe(2);
    await expect(db.cashMovements.count()).resolves.toBe(0);
    await expect(db.outbox.count()).resolves.toBe(0);
  });

  it('un monto inválido no guarda nada', async () => {
    const result = await recordCashCount(-1);

    expect(result).toMatchObject({ ok: false, error: 'cash/invalid-amount' });
    await expect(db.cashCounts.count()).resolves.toBe(0);
  });
});

describe('recordCashMovement', () => {
  it('guarda el movimiento, su evento y el concepto; el saldo baja', async () => {
    const result = await recordCashMovement({
      direction: 'out',
      amount: 150,
      concept: 'Proveedor',
      description: 'Pan',
    });
    if (!result.ok) throw new Error('falló');

    expect(result.value).toMatchObject({ source: 'manual', description: 'Pan' });
    await expect(db.outbox.get(result.value.id)).resolves.toMatchObject({ type: 'cash-movement' });
    await expect(db.cashConcepts.toArray()).resolves.toMatchObject([
      { direction: 'out', concept: 'Proveedor', uses: 1 },
    ]);
    await expect(getCashBalance()).resolves.toEqual({ balance: -150 });
  });

  it('el mismo concepto con otra grafía suma usos en una sola fila, por dirección', async () => {
    await recordCashMovement({ direction: 'out', amount: 10, concept: 'Proveedor' });
    await recordCashMovement({ direction: 'out', amount: 10, concept: 'proveedor ' });
    await recordCashMovement({ direction: 'in', amount: 10, concept: 'Proveedor' });

    const rows = await db.cashConcepts.toArray();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.direction === 'out')).toMatchObject({
      concept: 'Proveedor',
      uses: 2,
    });
  });

  it('sin concepto no guarda nada', async () => {
    const result = await recordCashMovement({ direction: 'in', amount: 10, concept: '  ' });

    expect(result).toMatchObject({ ok: false, error: 'cash/concept-required' });
    await expect(db.cashMovements.count()).resolves.toBe(0);
    await expect(db.cashConcepts.count()).resolves.toBe(0);
  });
});

describe('listConceptSuggestions', () => {
  it('ordena por uso, filtra por texto y separa por dirección', async () => {
    const now = new Date().toISOString();
    await recordCashMovement({ direction: 'out', amount: 1, concept: 'Flete' });
    await recordCashMovement({ direction: 'out', amount: 1, concept: 'Proveedor' });
    await recordCashMovement({ direction: 'out', amount: 1, concept: 'Proveedor' });
    await recordCashMovement({ direction: 'in', amount: 1, concept: 'Cambio inicial' });

    await expect(listConceptSuggestions('out', '', now)).resolves.toEqual(['Proveedor', 'Flete']);
    await expect(listConceptSuggestions('out', 'prov', now)).resolves.toEqual(['Proveedor']);
    await expect(listConceptSuggestions('out', 'camb', now)).resolves.toEqual([]);
  });
});

describe('migración a la versión 7', () => {
  it('una base en versión 6 conserva sus ventas y suma las tablas de caja vacías', async () => {
    db.close();
    await db.delete();
    const old = new Dexie('offline-pos');
    old.version(6).stores({
      products: 'id, sku, *barcodes, category',
      stock: 'productId',
      sales: 'id, status, createdAt, voidsSaleId',
      stockMovements: 'id, productId, saleId, createdAt',
      outbox: 'id, status, createdAt',
      customers: 'id, name',
      customerAccounts: 'customerId',
      accountMovements: 'id, customerId, saleId, createdAt',
      draftCart: 'id',
      cashSessions: 'id, openedAt',
    });
    await old.table('sales').add(cashSale('s1', '2026-09-24T10:00:00.000Z', 100));
    old.close();

    await db.open();
    await expect(db.sales.get('s1')).resolves.toMatchObject({ id: 's1' });
    await expect(db.cashCounts.count()).resolves.toBe(0);
    await expect(db.cashMovements.count()).resolves.toBe(0);
  });
});
