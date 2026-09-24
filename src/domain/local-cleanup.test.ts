import { describe, expect, it } from 'vitest';
import type { CashSession } from './cash-session.ts';
import { planLocalCleanup, type CleanupInput } from './local-cleanup.ts';
import type { OutboxEvent } from './outbox.ts';

const now = '2026-09-24T12:00:00.000Z';
const old = '2026-09-10T12:00:00.000Z'; // 14 días
const recent = '2026-09-20T12:00:00.000Z'; // 4 días

function input(overrides: Partial<CleanupInput> = {}): CleanupInput {
  return {
    now,
    pendingEvents: [],
    protectedEventIds: new Set(),
    sales: [],
    stockMovements: [],
    accountMovements: [],
    syncedEvents: [],
    cashSessions: [],
    ...overrides,
  };
}

function session(id: string, sales: string[], closedAt?: string): CashSession {
  return {
    id,
    openedAt: old,
    openingAmount: 0,
    sales,
    ...(closedAt !== undefined ? { closedAt } : {}),
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

  it('nunca borra una venta con su evento o su anulación pendientes', () => {
    const pendingEvents = [
      { id: 's1', type: 'sale', status: 'pending', createdAt: old },
      {
        id: 'v2',
        type: 'sale-void',
        saleId: 's2',
        voidedAt: old,
        status: 'pending',
        createdAt: old,
      },
    ] as OutboxEvent[];
    const plan = planLocalCleanup(
      input({
        pendingEvents,
        sales: [
          { id: 's1', createdAt: old },
          { id: 's2', createdAt: old },
        ],
      }),
    );
    expect(plan.sales).toEqual([]);
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

  it('el último turno cerrado y el abierto son el ancla: se conservan con sus ventas', () => {
    const plan = planLocalCleanup(
      input({
        sales: [
          { id: 's-a', createdAt: old },
          { id: 's-b', createdAt: old },
          { id: 's-c', createdAt: old },
        ],
        cashSessions: [
          session('t1', ['s-a'], '2026-09-05T12:00:00.000Z'),
          session('t2', ['s-b'], '2026-09-11T12:00:00.000Z'),
          session('t3', ['s-c']),
        ],
      }),
    );
    expect(plan.anchor?.id).toBe('t2');
    expect(plan.cashSessions).toEqual(['t1']);
    expect(plan.sales).toEqual(['s-a']);
  });

  it('un turno cerrado hace menos de 7 días no se borra aunque no sea el ancla', () => {
    const plan = planLocalCleanup(
      input({
        cashSessions: [
          session('t1', [], '2026-09-19T12:00:00.000Z'),
          session('t2', [], '2026-09-21T12:00:00.000Z'),
        ],
      }),
    );
    expect(plan.cashSessions).toEqual([]);
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

  it('los movimientos de las ventas del ancla se conservan con ellas', () => {
    const plan = planLocalCleanup(
      input({
        sales: [{ id: 's-a', createdAt: old }],
        stockMovements: [{ id: 'm-a', saleId: 's-a', createdAt: old }],
        accountMovements: [{ id: 'a-a', saleId: 's-a', createdAt: old }],
        cashSessions: [session('t1', ['s-a'], old)],
      }),
    );
    expect(plan.stockMovements).toEqual([]);
    expect(plan.accountMovements).toEqual([]);
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
