import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../storage/db.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  cashBufferSignal,
  cashErrorSignal,
  cashSessionSignal,
  cashStepSignal,
  cashSummarySignal,
} from '../state/cash-session.ts';
import {
  cancelCashStep,
  enterCashScreen,
  exitCashScreen,
  loadCashScreen,
  submitCashStep,
  updateCashBuffer,
} from './cash-session-controller.ts';

beforeEach(async () => {
  await db.open();
  activeScreenSignal.value = 'sale';
  cashBufferSignal.value = '';
  cashErrorSignal.value = null;
  cashSessionSignal.value = undefined;
  cashSummarySignal.value = undefined;
  cashStepSignal.value = 'opening';
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('enterCashScreen', () => {
  it('cambia a la pantalla de caja', () => {
    enterCashScreen();

    expect(activeScreenSignal.value).toBe('cash');
  });
});

describe('loadCashScreen', () => {
  it('sin turno abierto, arranca en el paso "opening"', async () => {
    await loadCashScreen();

    expect(cashStepSignal.value).toBe('opening');
    expect(cashSessionSignal.value).toBeUndefined();
  });

  it('con un turno abierto, arranca en "open" con el resumen cargado', async () => {
    updateCashBuffer('500');
    await submitCashStep(); // abre el turno

    expect(cashStepSignal.value).toBe('open');
    expect(cashSessionSignal.value?.openingAmount).toBe(500);
    expect(cashSummarySignal.value?.expectedCash).toBe(500);
  });
});

describe('flujo de apertura', () => {
  it('rechaza un monto inválido', async () => {
    updateCashBuffer('abc');

    await submitCashStep();

    expect(cashErrorSignal.value).not.toBeNull();
    expect(cashStepSignal.value).toBe('opening');
  });

  it('abre el turno con un monto válido', async () => {
    updateCashBuffer('300');

    await submitCashStep();

    expect(cashStepSignal.value).toBe('open');
    expect(cashSessionSignal.value?.openingAmount).toBe(300);
  });
});

describe('flujo de cierre', () => {
  beforeEach(async () => {
    updateCashBuffer('500');
    await submitCashStep(); // abre el turno, ahora en 'open'
  });

  it('con un monto contado válido, pasa a confirmar sin cerrar todavía', async () => {
    updateCashBuffer('500');

    await submitCashStep();

    expect(cashStepSignal.value).toBe('confirming-close');
    const session = await db.cashSessions.toArray();
    expect(session[0]?.closedAt).toBeUndefined();
  });

  it('Esc en la confirmación vuelve a "open" sin cerrar', async () => {
    updateCashBuffer('500');
    await submitCashStep(); // -> confirming-close

    cancelCashStep();

    expect(cashStepSignal.value).toBe('open');
    const session = await db.cashSessions.toArray();
    expect(session[0]?.closedAt).toBeUndefined();
  });

  it('Enter en la confirmación cierra el turno y muestra el resumen final', async () => {
    updateCashBuffer('490');
    await submitCashStep(); // -> confirming-close

    await submitCashStep(); // confirma el cierre

    expect(cashStepSignal.value).toBe('closed');
    expect(cashSummarySignal.value?.countedCash).toBe(490);
    expect(cashSummarySignal.value?.difference).toBe(-10);
  });

  it('Esc en cualquier otro paso sale a la pantalla de venta', () => {
    activeScreenSignal.value = 'cash';

    cancelCashStep();

    expect(activeScreenSignal.value).toBe('sale');
  });
});

describe('exitCashScreen', () => {
  it('limpia el estado y vuelve a la venta', () => {
    activeScreenSignal.value = 'cash';
    cashErrorSignal.value = 'algo';

    exitCashScreen();

    expect(activeScreenSignal.value).toBe('sale');
    expect(cashErrorSignal.value).toBeNull();
  });
});
