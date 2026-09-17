import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../storage/db.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import { cashSummaryContextSignal, cashSummaryTabSignal } from '../state/cash-summary.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { CashSummaryScreen } from './cash-summary-screen.tsx';

beforeEach(async () => {
  await db.open();
  saveSyncConfig({ baseUrl: 'https://api.example.com', locale: 'es-AR' });
  activeScreenSignal.value = 'cash-summary';
  cashSummaryContextSignal.value = {
    session: { id: 'cs1', openedAt: '2026-01-01T09:00:00.000Z', openingAmount: 100, sales: [] },
    summary: {
      salesCount: 2,
      totalsByMethod: { cash: 300, debit: 50, credit: 0, transfer: 0, qr: 0, account: 0 },
      totalCollected: 350,
      adjustmentTotal: -10,
      expectedCash: 400,
    },
    sales: [],
    isClosed: false,
  };
  cashSummaryTabSignal.value = 'tickets';
});

afterEach(async () => {
  localStorage.clear();
  db.close();
  await db.delete();
});

describe('CashSummaryScreen', () => {
  it('muestra los 5 valores del panel lateral', () => {
    render(<CashSummaryScreen />);

    expect(screen.getByText('350,00')).not.toBeNull(); // Total recaudado
    expect(screen.getByText('2')).not.toBeNull(); // Tickets emitidos
    expect(screen.getByText('300,00')).not.toBeNull(); // Efectivo
    expect(screen.getByText('50,00')).not.toBeNull(); // Otros pagos (debit)
  });

  it('Tab cambia de pestaña', () => {
    render(<CashSummaryScreen />);

    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'Tab' });

    expect(cashSummaryTabSignal.value).toBe('products');
  });

  it('Esc vuelve a la venta', () => {
    render(<CashSummaryScreen />);

    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });
});
