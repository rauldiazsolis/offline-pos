import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../storage/db.ts';
import { commandBarErrorSignal } from '../state/command-bar.ts';
import {
  cashSummaryContextSignal,
  cashSummaryTabSignal,
  paymentFilterSignal,
  selectedPaymentIndexSignal,
  selectedTicketIndexSignal,
  ticketFilterSignal,
} from '../state/cash-summary.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  exitCashSummaryScreen,
  setCashSummaryTab,
  triggerCashSummary,
  updatePaymentFilter,
  updateTicketFilter,
} from './cash-summary-controller.ts';

beforeEach(async () => {
  await db.open();
  activeScreenSignal.value = 'sale';
  cashSummaryContextSignal.value = undefined;
  cashSummaryTabSignal.value = 'tickets';
  ticketFilterSignal.value = '';
  selectedTicketIndexSignal.value = 0;
  commandBarErrorSignal.value = null;
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('triggerCashSummary', () => {
  it('navega y carga el contexto de hoy', async () => {

    await triggerCashSummary();

    expect(activeScreenSignal.value).toBe('cash-summary');
    expect(cashSummaryContextSignal.value?.sales).toEqual([]);
  });
});

describe('exitCashSummaryScreen', () => {
  it('resetea el estado y vuelve a la venta', async () => {
    await triggerCashSummary();
    ticketFilterSignal.value = 'algo';

    exitCashSummaryScreen();

    expect(activeScreenSignal.value).toBe('sale');
    expect(cashSummaryContextSignal.value).toBeUndefined();
    expect(ticketFilterSignal.value).toBe('');
  });
});

describe('setCashSummaryTab', () => {
  it('cambia de pestaña y limpia el filtro de la que se abandona', () => {
    ticketFilterSignal.value = 'algo';

    setCashSummaryTab('products');

    expect(cashSummaryTabSignal.value).toBe('products');
    expect(ticketFilterSignal.value).toBe('');
  });

  it('también limpia el filtro y la selección de Medios de pago', () => {
    paymentFilterSignal.value = 'efec';
    selectedPaymentIndexSignal.value = 2;

    setCashSummaryTab('tickets');

    expect(paymentFilterSignal.value).toBe('');
    expect(selectedPaymentIndexSignal.value).toBeNull();
  });
});

describe('updateTicketFilter', () => {
  it('actualiza el signal de filtro de tickets', () => {
    updateTicketFilter('torres');

    expect(ticketFilterSignal.value).toBe('torres');
  });
});

describe('updatePaymentFilter', () => {
  it('actualiza el signal de filtro de medios de pago sin tocar la selección', () => {
    selectedPaymentIndexSignal.value = 1;

    updatePaymentFilter('efec');

    expect(paymentFilterSignal.value).toBe('efec');
    expect(selectedPaymentIndexSignal.value).toBe(1);
  });
});
