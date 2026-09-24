import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Cart } from '../domain/cart.ts';
import {
  closeCashSessionAndPersist,
  getCurrentOpenCashSession,
  openCashSessionAndPersist,
} from './cash-session-repository.ts';
import { saveSyncConfig } from '../sync/config.ts';
import { db } from './db.ts';
import type { Sale } from '../domain/sale.ts';
import { closeSaleAndPersist, listVoidCandidates, voidSaleAndPersist } from './sale-repository.ts';

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
  // Fase 6: closeSaleAndPersist exige un turno de caja abierto — se abre uno
  // acá para no repetirlo en cada test; el test de "sin turno abierto" lo
  // cierra explícitamente antes de ejercitar el caso que le interesa.
  await openCashSessionAndPersist({ openingAmount: 0 });
});

afterEach(async () => {
  db.close();
  await db.delete();
});

const cart: Cart = { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] };

describe('closeSaleAndPersist', () => {
  it('persiste la venta cerrada', async () => {
    const result = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const stored = await db.sales.get(result.value.id);
      expect(stored?.status).toBe('closed');
    }
  });

  it('descuenta el stock del producto vendido', async () => {
    await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });

    const stock = await db.stock.get('p1');
    expect(stock?.quantity).toBe(8);
  });

  it('registra un movimiento de stock con reason "sale"', async () => {
    const result = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });

    if (result.ok) {
      const movements = await db.stockMovements.where('saleId').equals(result.value.id).toArray();
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ productId: 'p1', delta: -2, reason: 'sale' });
    }
  });

  it('no persiste nada si el carrito está vacío', async () => {
    const result = await closeSaleAndPersist({ cart: { lines: [] }, payments: [] });

    expect(result.ok).toBe(false);
    await expect(db.sales.count()).resolves.toBe(0);
  });

  it('escribe un evento de outbox por la venta y uno por cada movimiento de stock', async () => {
    const result = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });
    if (!result.ok) throw new Error('setup falló');

    const events = await db.outbox.toArray();
    expect(events).toHaveLength(2);

    const saleEvent = events.find((event) => event.type === 'sale');
    expect(saleEvent?.id).toBe(result.value.id); // el id de la venta es la Idempotency-Key
    expect(saleEvent?.status).toBe('pending');

    const movementEvent = events.find((event) => event.type === 'stock-movement');
    expect(movementEvent?.status).toBe('pending');
  });

  it('estampa en cada evento la sucursal de la config actual (contrato v3)', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'http://x', branch: 'Centro' });
    try {
      await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });
      const events = await db.outbox.toArray();
      expect(events.map((event) => event.origin)).toEqual([
        { branch: 'Centro' },
        { branch: 'Centro' },
      ]);
    } finally {
      localStorage.clear();
    }
  });

  it('con un pago account, registra el movimiento y descuenta el balance cacheado', async () => {
    await db.customers.add({ id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' });
    await db.customerAccounts.add({
      customerId: 'c1',
      creditLimit: 1000,
      margin: 0,
      balance: 100,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await closeSaleAndPersist({
      cart,
      payments: [{ method: 'account', amount: 200, reference: 'hold-1' }],
      customerId: 'c1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const movements = await db.accountMovements.where('saleId').equals(result.value.id).toArray();
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ customerId: 'c1', amount: 200, holdId: 'hold-1' });

      const account = await db.customerAccounts.get('c1');
      expect(account?.balance).toBe(300);
    }
  });

  it('con un pago account sin CustomerAccount cacheada, no la inventa', async () => {
    await db.customers.add({ id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' });

    await closeSaleAndPersist({
      cart,
      payments: [{ method: 'account', amount: 200 }],
      customerId: 'c1',
    });

    expect(await db.customerAccounts.get('c1')).toBeUndefined();
  });

  it('con pendingHold, encola también un evento account-hold-confirm', async () => {
    await db.customers.add({ id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' });

    const result = await closeSaleAndPersist({
      cart,
      payments: [{ method: 'account', amount: 200, reference: 'hold-1' }],
      customerId: 'c1',
      pendingHold: { holdId: 'hold-1' },
    });
    if (!result.ok) throw new Error('setup falló');

    const confirmEvent = (await db.outbox.toArray()).find(
      (event) => event.type === 'account-hold-confirm',
    );
    expect(confirmEvent).toMatchObject({ holdId: 'hold-1', saleId: result.value.id });
  });

  it('rechaza cerrar la venta sin un turno de caja abierto', async () => {
    await closeCashSessionAndPersist({ closingAmount: 0 }); // cierra el turno que abrió el beforeEach

    const result = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });

    expect(result).toEqual({ ok: false, error: 'cash-session/none-open', meta: undefined });
  });

  it('agrega el id de la venta al turno de caja abierto', async () => {
    const result = await closeSaleAndPersist({ cart, payments: [{ method: 'cash', amount: 200 }] });
    if (!result.ok) throw new Error('setup falló');

    const session = await getCurrentOpenCashSession();
    expect(session?.sales).toContain(result.value.id);
  });

  it('no genera movimientos de stock para productos que no lo trackean', async () => {
    await db.products.add({
      id: 'p2',
      sku: 'SKU-2',
      barcodes: [],
      name: 'Servicio',
      price: 500,
      taxRate: 0,
      category: 'servicios',
      tracksStock: false,
    });
    const cartWithService: Cart = {
      lines: [{ kind: 'product', productId: 'p2', qty: 1, unitPrice: 500 }],
    };

    const result = await closeSaleAndPersist({
      cart: cartWithService,
      payments: [{ method: 'cash', amount: 500 }],
    });

    if (result.ok) {
      const movements = await db.stockMovements.where('saleId').equals(result.value.id).toArray();
      expect(movements).toEqual([]);
    }
  });
});

describe('voidSaleAndPersist (anulación como ticket propio, #99)', () => {
  async function closeOnAccount() {
    await db.customers.add({ id: 'c1', name: 'Ana', createdAt: '2026-01-01T00:00:00.000Z' });
    await db.customerAccounts.add({
      customerId: 'c1',
      creditLimit: 1000,
      margin: 0,
      balance: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const closed = await closeSaleAndPersist({
      cart: { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 125 }] },
      payments: [
        { method: 'account', amount: 150 },
        { method: 'cash', amount: 100 },
      ],
      customerId: 'c1',
    });
    if (!closed.ok) throw new Error('setup falló');
    return closed.value;
  }

  it('persiste un ticket negativo aparte y deja el original intacto', async () => {
    const original = await closeOnAccount();

    const result = await voidSaleAndPersist(original.id, { reason: 'error de cobro' });

    if (!result.ok) throw new Error('esperaba ok');
    const voidTicket = result.value;
    expect(voidTicket.voidsSaleId).toBe(original.id);
    expect(voidTicket.total).toBe(-original.total);
    expect(voidTicket.voidReason).toBe('error de cobro');
    expect(await db.sales.count()).toBe(2);
    expect(await db.sales.get(original.id)).toEqual(original);
  });

  it('repone el stock con un movimiento sale-void del ticket de anulación', async () => {
    const original = await closeOnAccount();

    const result = await voidSaleAndPersist(original.id);

    if (!result.ok) throw new Error('esperaba ok');
    expect((await db.stock.get('p1'))?.quantity).toBe(10);
    const movements = await db.stockMovements.where('saleId').equals(result.value.id).toArray();
    expect(movements).toMatchObject([{ reason: 'sale-void', delta: 2 }]);
  });

  it('acredita el saldo de cuenta corriente', async () => {
    const original = await closeOnAccount();
    expect((await db.customerAccounts.get('c1'))?.balance).toBe(150);

    const result = await voidSaleAndPersist(original.id);

    if (!result.ok) throw new Error('esperaba ok');
    expect((await db.customerAccounts.get('c1'))?.balance).toBe(0);
    const accountMovements = await db.accountMovements
      .where('saleId')
      .equals(result.value.id)
      .toArray();
    expect(accountMovements.map((movement) => movement.amount)).toEqual([-150]);
  });

  it('encola un evento sale con voidsSaleId y sus stock-movement', async () => {
    const original = await closeOnAccount();

    const result = await voidSaleAndPersist(original.id);

    if (!result.ok) throw new Error('esperaba ok');
    const events = await db.outbox.toArray();
    const voidEvent = events.find((event) => event.id === result.value.id);
    expect(voidEvent?.type === 'sale' && voidEvent.sale.voidsSaleId).toBe(original.id);
    const movementEvents = events.filter(
      (event) => event.type === 'stock-movement' && event.movement.saleId === result.value.id,
    );
    expect(movementEvents).toHaveLength(1);
  });

  it('con un turno abierto, lo registra en él', async () => {
    const original = await closeOnAccount();

    const result = await voidSaleAndPersist(original.id);

    if (!result.ok) throw new Error('esperaba ok');
    expect((await getCurrentOpenCashSession())?.sales).toContain(result.value.id);
  });

  it('sin turno abierto también anula', async () => {
    const original = await closeOnAccount();
    await closeCashSessionAndPersist({ closingAmount: 100 });

    const result = await voidSaleAndPersist(original.id);

    expect(result.ok).toBe(true);
  });

  it('rechaza anular una venta inexistente', async () => {
    const result = await voidSaleAndPersist('no-existe');

    expect(result).toMatchObject({ ok: false, error: 'sale/not-found' });
  });

  it('rechaza anular dos veces, y anular una anulación', async () => {
    const original = await closeOnAccount();
    const first = await voidSaleAndPersist(original.id);
    if (!first.ok) throw new Error('esperaba ok');

    expect(await voidSaleAndPersist(original.id)).toMatchObject({
      ok: false,
      error: 'sale/already-voided',
    });
    expect(await voidSaleAndPersist(first.value.id)).toMatchObject({
      ok: false,
      error: 'sale/cannot-void-a-void',
    });
  });
});

describe('listVoidCandidates (#99)', () => {
  const now = '2026-09-24T12:00:00.000Z';
  const sale = (id: string, createdAt: string, extra: Partial<Sale> = {}): Sale => ({
    id,
    lines: [],
    payments: [],
    total: 100,
    status: 'closed',
    createdAt,
    ...extra,
  });

  it('solo las últimas 24 h, más nuevo primero, con el estado de cada una', async () => {
    await db.sales.bulkAdd([
      sale('old', '2026-09-23T11:00:00.000Z'),
      sale('voided', '2026-09-24T09:00:00.000Z'),
      sale('void-of', '2026-09-24T10:00:00.000Z', { voidsSaleId: 'voided', total: -100 }),
      sale('common', '2026-09-24T11:00:00.000Z'),
      sale('legacy', '2026-09-24T08:00:00.000Z', { status: 'voided' }),
    ]);

    const candidates = await listVoidCandidates(now);

    expect(candidates.map((candidate) => [candidate.sale.id, candidate.state])).toEqual([
      ['common', 'voidable'],
      ['void-of', 'void-ticket'],
      ['voided', 'voided'],
      ['legacy', 'voided'],
    ]);
    expect(candidates[1]?.original?.id).toBe('voided');
  });

  it('tope de 20', async () => {
    await db.sales.bulkAdd(
      Array.from({ length: 25 }, (_, index) =>
        sale(
          `s${String(index).padStart(2, '0')}`,
          `2026-09-24T11:${String(index).padStart(2, '0')}:00.000Z`,
        ),
      ),
    );

    const candidates = await listVoidCandidates(now);

    expect(candidates).toHaveLength(20);
    expect(candidates[0]?.sale.id).toBe('s24');
  });
});
