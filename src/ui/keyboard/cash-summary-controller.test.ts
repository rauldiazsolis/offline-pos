import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CustomerPayment } from '../../domain/customer-payment.ts';
import type { DayEntry } from '../../domain/day-summary.ts';
import type { Sale } from '../../domain/sale.ts';
import { localDateKey, shiftDateKey } from '../../domain/ticket-number.ts';
import { db } from '../../storage/db.ts';
import {
  cashSummaryTabSignal,
  dayViewSignal,
  movementFilterSignal,
  paymentFilterSignal,
  selectedEntryIndexSignal,
  selectedPaymentIndexSignal,
} from '../state/cash-summary.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  exitCashSummaryScreen,
  setCashSummaryTab,
  showNextDay,
  showPreviousDay,
  triggerCashSummary,
  updateMovementFilter,
  reprintSourceFor,
  updatePaymentFilter,
} from './cash-summary-controller.ts';

const today = localDateKey(new Date().toISOString());
const yesterday = shiftDateKey(today, -1);

beforeEach(async () => {
  await db.open();
  activeScreenSignal.value = 'sale';
  dayViewSignal.value = undefined;
});

afterEach(async () => {
  db.close();
  await db.delete();
});

async function seedYesterday(): Promise<void> {
  const createdAt = new Date(
    Number(yesterday.slice(0, 4)),
    Number(yesterday.slice(5, 7)) - 1,
    Number(yesterday.slice(8, 10)),
    12,
  ).toISOString();
  await db.sales.add({
    id: 's1',
    lines: [],
    payments: [],
    total: 0,
    status: 'closed',
    createdAt,
  });
}

describe('triggerCashSummary', () => {
  it('abre en hoy, en Movimientos, aunque no haya datos', async () => {
    await triggerCashSummary();

    expect(activeScreenSignal.value).toBe('cash-summary');
    expect(cashSummaryTabSignal.value).toBe('movements');
    expect(dayViewSignal.value?.date).toBe(today);
    expect(dayViewSignal.value?.isToday).toBe(true);
  });
});

describe('navegación por días', () => {
  it('hacia atrás conserva pestaña y filtros, y vuelve la selección al principio', async () => {
    await seedYesterday();
    await triggerCashSummary();
    cashSummaryTabSignal.value = 'products';
    movementFilterSignal.value = 'algo';
    selectedEntryIndexSignal.value = 3;

    await showPreviousDay();

    expect(dayViewSignal.value?.date).toBe(yesterday);
    expect(cashSummaryTabSignal.value).toBe('products');
    expect(movementFilterSignal.value).toBe('algo');
    expect(selectedEntryIndexSignal.value).toBe(0);
  });

  it('no pasa del día más viejo ni de hoy', async () => {
    await seedYesterday();
    await triggerCashSummary();

    await showNextDay();
    expect(dayViewSignal.value?.date).toBe(today);

    await showPreviousDay();
    await showPreviousDay();
    expect(dayViewSignal.value?.date).toBe(yesterday);

    await showNextDay();
    expect(dayViewSignal.value?.date).toBe(today);
  });
});

describe('exitCashSummaryScreen', () => {
  it('resetea el estado y vuelve a la venta', async () => {
    await triggerCashSummary();
    movementFilterSignal.value = 'algo';

    exitCashSummaryScreen();

    expect(activeScreenSignal.value).toBe('sale');
    expect(dayViewSignal.value).toBeUndefined();
    expect(movementFilterSignal.value).toBe('');
  });
});

describe('setCashSummaryTab', () => {
  it('cambia de pestaña y limpia el filtro de la que se abandona', () => {
    movementFilterSignal.value = 'algo';

    setCashSummaryTab('products');

    expect(cashSummaryTabSignal.value).toBe('products');
    expect(movementFilterSignal.value).toBe('');
  });

  it('también limpia el filtro y la selección de Medios de pago', () => {
    paymentFilterSignal.value = 'efec';
    selectedPaymentIndexSignal.value = 2;

    setCashSummaryTab('movements');

    expect(paymentFilterSignal.value).toBe('');
    expect(selectedPaymentIndexSignal.value).toBeNull();
  });
});

describe('filtros', () => {
  it('updateMovementFilter actualiza el filtro de movimientos', () => {
    updateMovementFilter('torres');
    expect(movementFilterSignal.value).toBe('torres');
  });

  it('updatePaymentFilter no toca la selección', () => {
    selectedPaymentIndexSignal.value = 1;
    updatePaymentFilter('efec');
    expect(paymentFilterSignal.value).toBe('efec');
    expect(selectedPaymentIndexSignal.value).toBe(1);
  });
});

describe('reprintSourceFor (#174)', () => {
  const sale: Sale = {
    id: 's1',
    lines: [],
    payments: [{ method: 'cash', amount: 10 }],
    total: 10,
    status: 'closed',
    createdAt: '2026-10-02T12:00:00.000Z',
  };

  it('una venta se reimprime como copia', () => {
    expect(reprintSourceFor({ kind: 'sale', at: sale.createdAt, sale }, new Map())).toEqual({
      kind: 'sale',
      sale,
      copy: true,
    });
  });

  it('una cobranza se reimprime con el nombre del cliente y sin saldos', () => {
    const payment: CustomerPayment = {
      id: 'p1',
      customerId: 'c1',
      payments: [{ method: 'cash', amount: 500 }],
      total: 500,
      createdAt: '2026-10-02T13:00:00.000Z',
    };
    expect(
      reprintSourceFor(
        { kind: 'collection', at: payment.createdAt, payment },
        new Map([['c1', 'Ana']]),
      ),
    ).toEqual({ kind: 'collection', payment, customerName: 'Ana', copy: true });
  });

  it('sin el cliente en la base usa su id', () => {
    const payment: CustomerPayment = {
      id: 'p1',
      customerId: 'c9',
      payments: [],
      total: 0,
      createdAt: '2026-10-02T13:00:00.000Z',
    };
    const source = reprintSourceFor(
      { kind: 'collection', at: payment.createdAt, payment },
      new Map(),
    );
    expect(source?.kind === 'collection' ? source.customerName : null).toBe('c9');
  });

  it('un movimiento de caja o un arqueo no se reimprimen', () => {
    const count: DayEntry = {
      kind: 'count',
      at: '2026-10-02T09:00:00.000Z',
      count: { id: 'k1', expected: 100, counted: 100, createdAt: '2026-10-02T09:00:00.000Z' },
    };
    const movement: DayEntry = {
      kind: 'movement',
      at: '2026-10-02T09:30:00.000Z',
      movement: {
        id: 'm1',
        direction: 'in',
        amount: 50,
        concept: 'Cambio',
        source: 'manual',
        createdAt: '2026-10-02T09:30:00.000Z',
      },
    };
    expect(reprintSourceFor(count, new Map())).toBeUndefined();
    expect(reprintSourceFor(movement, new Map())).toBeUndefined();
  });
});
