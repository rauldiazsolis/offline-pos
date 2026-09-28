import { describe, expect, it } from 'vitest';
import { planLocalCleanup, type CleanupInput } from './local-cleanup.ts';
import type { OutboxEvent } from './outbox.ts';

const now = '2026-09-24T12:00:00.000Z';
const old = '2026-09-10T12:00:00.000Z'; // 14 días
const recent = '2026-09-20T12:00:00.000Z'; // 4 días
const twelveDays = '2026-09-12T12:00:00.000Z';
const nineDays = '2026-09-15T12:00:00.000Z';
const eightDays = '2026-09-16T12:00:00.000Z';

function input(overrides: Partial<CleanupInput> = {}): CleanupInput {
  return {
    now,
    pendingEvents: [],
    protectedEventIds: new Set(),
    sales: [],
    stockMovements: [],
    accountMovements: [],
    syncedEvents: [],
    cashMovements: [],
    cashCounts: [],
    // Por defecto hay un arqueo reciente: lo anterior sigue la regla de edad.
    lastCount: { id: 'c-anchor', createdAt: recent },
    ...overrides,
  };
}

describe('planLocalCleanup', () => {
  it('borra ventas viejas sincronizadas con sus movimientos, y conserva las recientes', () => {
    const plan = planLocalCleanup(
      input({
        sales: [
          { id: 's-old', createdAt: old },
          { id: 's-new', createdAt: recent },
        ],
        stockMovements: [
          { id: 'm-old', saleId: 's-old', createdAt: old },
          { id: 'm-new', saleId: 's-new', createdAt: recent },
        ],
        accountMovements: [
          { id: 'a-old', saleId: 's-old', createdAt: old },
          { id: 'a-free', createdAt: old },
        ],
      }),
    );
    expect(plan.sales).toEqual(['s-old']);
    expect(plan.stockMovements).toEqual(['m-old']);
    expect(plan.accountMovements).toEqual(['a-old']);
  });

  it('nunca borra una venta con su evento pendiente', () => {
    const pendingEvents = [
      { id: 's1', type: 'sale', status: 'pending', createdAt: old },
    ] as OutboxEvent[];
    const plan = planLocalCleanup(input({ pendingEvents, sales: [{ id: 's1', createdAt: old }] }));
    expect(plan.sales).toEqual([]);
  });

  it('cada venta por su propia edad: una vieja cuya anulación está pendiente sí se borra (#99)', () => {
    const pendingEvents = [
      { id: 'v2', type: 'sale', status: 'pending', createdAt: old },
    ] as OutboxEvent[];
    const plan = planLocalCleanup(
      input({
        pendingEvents,
        sales: [
          { id: 's2', createdAt: old },
          { id: 'v2', createdAt: old },
        ],
      }),
    );
    expect(plan.sales).toEqual(['s2']);
  });

  it('borra eventos synced viejos salvo los protegidos (lotes en espera o en curso)', () => {
    const plan = planLocalCleanup(
      input({
        protectedEventIds: new Set(['e-lot']),
        syncedEvents: [
          { id: 'e-old', createdAt: old },
          { id: 'e-lot', createdAt: old },
          { id: 'e-new', createdAt: recent },
        ],
      }),
    );
    expect(plan.outbox).toEqual(['e-old']);
  });

  it('sin ningún arqueo no se borran ventas ni movimientos de caja (base 0 del saldo)', () => {
    const plan = planLocalCleanup(
      input({
        lastCount: undefined,
        sales: [{ id: 's-old', createdAt: old }],
        cashMovements: [{ id: 'cm-old', createdAt: old }],
        stockMovements: [{ id: 'm-old', createdAt: old }],
      }),
    );
    expect(plan.sales).toEqual([]);
    expect(plan.cashMovements).toEqual([]);
    expect(plan.stockMovements).toEqual(['m-old']);
    expect(plan.anchorAt).toBeUndefined();
  });

  it('el último arqueo es el ancla: lo posterior se conserva aunque tenga más de 7 días', () => {
    const plan = planLocalCleanup(
      input({
        lastCount: { id: 'c-9', createdAt: nineDays },
        sales: [
          { id: 's-10', createdAt: old },
          { id: 's-8', createdAt: eightDays },
        ],
        stockMovements: [
          { id: 'm-10', createdAt: old },
          { id: 'm-8', createdAt: eightDays },
        ],
        cashMovements: [
          { id: 'cm-10', createdAt: old },
          { id: 'cm-8', createdAt: eightDays },
        ],
        cashCounts: [
          { id: 'c-12', createdAt: twelveDays },
          { id: 'c-9', createdAt: nineDays },
        ],
      }),
    );
    expect(plan.anchorAt).toBe(nineDays);
    expect(plan.sales).toEqual(['s-10']);
    expect(plan.stockMovements).toEqual(['m-10']);
    expect(plan.cashMovements).toEqual(['cm-10']);
    expect(plan.cashCounts).toEqual(['c-12']);
  });

  it('un movimiento de caja con su evento pendiente no se borra', () => {
    const pendingEvents = [
      { id: 'cm1', type: 'cash-movement', status: 'pending', createdAt: old },
    ] as OutboxEvent[];
    const plan = planLocalCleanup(
      input({ pendingEvents, cashMovements: [{ id: 'cm1', createdAt: old }] }),
    );
    expect(plan.cashMovements).toEqual([]);
  });

  it('un arqueo viejo espera a que el evento de su ajuste no esté pendiente', () => {
    const pendingEvents = [
      { id: 'adj1', type: 'cash-movement', status: 'pending', createdAt: old },
    ] as OutboxEvent[];
    const plan = planLocalCleanup(
      input({
        pendingEvents,
        cashCounts: [
          { id: 'c-a', createdAt: old, adjustmentId: 'adj1' },
          { id: 'c-b', createdAt: old, adjustmentId: 'adj2' },
          { id: 'c-c', createdAt: old },
        ],
      }),
    );
    expect(plan.cashCounts).toEqual(['c-b', 'c-c']);
  });

  it('un movimiento pendiente nunca se borra', () => {
    const pendingEvents = [
      { id: 'm1', type: 'stock-movement', status: 'pending', createdAt: old },
    ] as OutboxEvent[];
    const plan = planLocalCleanup(
      input({ pendingEvents, stockMovements: [{ id: 'm1', createdAt: old }] }),
    );
    expect(plan.stockMovements).toEqual([]);
  });

  it('un movimiento es independiente de su venta: se borra por su edad aunque la venta ya no exista', () => {
    // Anulación reciente de una venta vieja: la venta se borró en una limpieza anterior y el
    // movimiento `sale-void` quedó con un `saleId` que ya no apunta a nada (solo auditoría).
    const plan = planLocalCleanup(
      input({
        stockMovements: [{ id: 'm-void', saleId: 's-gone', createdAt: old }],
        accountMovements: [{ id: 'a-void', saleId: 's-gone', createdAt: old }],
      }),
    );
    expect(plan.stockMovements).toEqual(['m-void']);
    expect(plan.accountMovements).toEqual(['a-void']);
  });

  it('un movimiento reciente se conserva aunque su venta vieja se borre', () => {
    const plan = planLocalCleanup(
      input({
        sales: [{ id: 's-old', createdAt: old }],
        stockMovements: [{ id: 'm-void', saleId: 's-old', createdAt: recent }],
      }),
    );
    expect(plan.sales).toEqual(['s-old']);
    expect(plan.stockMovements).toEqual([]);
  });

  it('un movimiento de cuenta viaja en el evento de su venta: se conserva mientras esté pendiente', () => {
    const pendingEvents = [
      { id: 's1', type: 'sale', status: 'pending', createdAt: old },
    ] as OutboxEvent[];
    const plan = planLocalCleanup(
      input({ pendingEvents, accountMovements: [{ id: 'a1', saleId: 's1', createdAt: old }] }),
    );
    expect(plan.accountMovements).toEqual([]);
  });
});
