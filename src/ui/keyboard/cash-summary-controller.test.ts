import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openCashSessionAndPersist } from '../../storage/cash-session-repository.ts';
import { db } from '../../storage/db.ts';
import { commandBarErrorSignal } from '../state/command-bar.ts';
import {
  cashSummaryContextSignal,
  cashSummaryTabSignal,
  selectedTicketIndexSignal,
  ticketFilterSignal,
} from '../state/cash-summary.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  exitCashSummaryScreen,
  setCashSummaryTab,
  triggerCashSummary,
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
  it('sin ningún turno, error en la barra de comandos y no navega', async () => {
    await triggerCashSummary();

    expect(activeScreenSignal.value).toBe('sale');
    expect(commandBarErrorSignal.value).toBe('No hay ningún turno de caja para consultar.');
  });

  it('con un turno abierto, navega y carga el contexto', async () => {
    await openCashSessionAndPersist({ openingAmount: 100 });

    await triggerCashSummary();

    expect(activeScreenSignal.value).toBe('cash-summary');
    expect(cashSummaryContextSignal.value?.isClosed).toBe(false);
  });
});

describe('exitCashSummaryScreen', () => {
  it('resetea el estado y vuelve a la venta', async () => {
    await openCashSessionAndPersist({ openingAmount: 100 });
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
});

describe('updateTicketFilter', () => {
  it('actualiza el signal de filtro de tickets', () => {
    updateTicketFilter('torres');

    expect(ticketFilterSignal.value).toBe('torres');
  });
});
