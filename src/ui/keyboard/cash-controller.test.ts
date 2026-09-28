import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CashCount } from '../../domain/cash-count.ts';
import type { CashMovement } from '../../domain/cash-movement.ts';
import {
  getCashBalance,
  listConceptSuggestions,
  recordCashCount,
  recordCashMovement,
} from '../../storage/cash-repository.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import {
  cashBalanceSignal,
  cashErrorSignal,
  cashFieldsSignal,
  cashKindSignal,
  conceptSuggestionIndexSignal,
  conceptSuggestionsOpenSignal,
  conceptSuggestionsSignal,
  EMPTY_CASH_FIELDS,
  lastCashCountAtSignal,
} from '../state/cash.ts';
import { commandBarNoticeSignal } from '../state/command-bar.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  cancelCash,
  chooseConceptSuggestion,
  enterCashScreen,
  loadCashScreen,
  moveConceptSuggestion,
  submitCash,
  updateCashField,
} from './cash-controller.ts';

vi.mock('../../storage/cash-repository.ts', () => ({
  getCashBalance: vi.fn(),
  recordCashCount: vi.fn(),
  recordCashMovement: vi.fn(),
  listConceptSuggestions: vi.fn(),
}));

const count: CashCount = {
  id: 'c1',
  expected: 1000,
  counted: 1200,
  createdAt: '2026-09-24T12:00:00.000Z',
  adjustmentId: 'm1',
};
const movement: CashMovement = {
  id: 'm2',
  direction: 'out',
  amount: 50,
  concept: 'Flete',
  source: 'manual',
  createdAt: '2026-09-24T12:00:00.000Z',
};

beforeEach(() => {
  saveSyncConfig({ type: 'rest', baseUrl: 'http://x', locale: 'es-AR' });
  vi.mocked(listConceptSuggestions).mockResolvedValue([]);
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  activeScreenSignal.value = 'sale';
  commandBarNoticeSignal.value = null;
  lastCashCountAtSignal.value = undefined;
});

describe('cash-controller', () => {
  it('enterCashScreen abre el modal en el tipo pedido, con todo limpio', () => {
    cashFieldsSignal.value = { ...EMPTY_CASH_FIELDS, amount: '99' };
    cashErrorSignal.value = { field: 'amount', message: 'x' };

    enterCashScreen('out');

    expect(activeScreenSignal.value).toBe('cash');
    expect(cashKindSignal.value).toBe('out');
    expect(cashFieldsSignal.value).toEqual(EMPTY_CASH_FIELDS);
    expect(cashErrorSignal.value).toBeNull();
  });

  it('loadCashScreen carga el saldo', async () => {
    vi.mocked(getCashBalance).mockResolvedValue({ balance: 1500 });
    await loadCashScreen();
    expect(cashBalanceSignal.value).toEqual({ balance: 1500 });
  });

  it('un contado inválido marca el campo sin llamar al repositorio', async () => {
    enterCashScreen('count');
    updateCashField('counted', 'abc');
    await submitCash();

    expect(cashErrorSignal.value?.field).toBe('counted');
    expect(recordCashCount).not.toHaveBeenCalled();
  });

  it('un arqueo registrado vuelve a la venta con el aviso y actualiza el último arqueo', async () => {
    vi.mocked(recordCashCount).mockResolvedValue({ ok: true, value: { count } });
    enterCashScreen('count');
    updateCashField('counted', '1200');
    await submitCash();

    expect(recordCashCount).toHaveBeenCalledWith(1200);
    expect(activeScreenSignal.value).toBe('sale');
    expect(commandBarNoticeSignal.value).toBe('Arqueo registrado: sobran $200,00');
    expect(lastCashCountAtSignal.value).toBe(count.createdAt);
  });

  it('un egreso sin concepto marca Concepto; con monto inválido, Monto', async () => {
    enterCashScreen('out');
    vi.mocked(recordCashMovement).mockResolvedValueOnce({
      ok: false,
      error: 'cash/concept-required',
      meta: undefined,
    });
    await submitCash();
    expect(cashErrorSignal.value?.field).toBe('concept');
    expect(activeScreenSignal.value).toBe('cash');

    vi.mocked(recordCashMovement).mockResolvedValueOnce({
      ok: false,
      error: 'cash/invalid-amount',
      meta: { amount: Number.NaN },
    });
    await submitCash();
    expect(cashErrorSignal.value?.field).toBe('amount');
  });

  it('un egreso registrado vuelve a la venta con el aviso', async () => {
    vi.mocked(recordCashMovement).mockResolvedValue({ ok: true, value: movement });
    enterCashScreen('out');
    updateCashField('concept', 'Flete');
    updateCashField('description', '  ');
    updateCashField('amount', '50');
    await submitCash();

    expect(recordCashMovement).toHaveBeenCalledWith({
      direction: 'out',
      amount: 50,
      concept: 'Flete',
    });
    expect(commandBarNoticeSignal.value).toBe('Egreso registrado');
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('tipear el concepto abre y carga las sugerencias; una respuesta vieja no pisa a la nueva', async () => {
    let resolveOld: (value: string[]) => void = () => undefined;
    vi.mocked(listConceptSuggestions)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(['Proveedor']);
    enterCashScreen('out');

    updateCashField('concept', 'p');
    updateCashField('concept', 'prov');
    await vi.waitFor(() => {
      expect(conceptSuggestionsSignal.value).toEqual(['Proveedor']);
    });
    resolveOld(['Pan']);
    await Promise.resolve();

    expect(conceptSuggestionsOpenSignal.value).toBe(true);
    expect(conceptSuggestionsSignal.value).toEqual(['Proveedor']);
    expect(listConceptSuggestions).toHaveBeenLastCalledWith('out', 'prov', expect.any(String));
  });

  it('elegir una sugerencia completa el concepto y cierra el overlay', async () => {
    vi.mocked(listConceptSuggestions).mockResolvedValue(['Proveedor', 'Flete']);
    enterCashScreen('out');
    updateCashField('concept', '');
    await vi.waitFor(() => {
      expect(conceptSuggestionsSignal.value).toHaveLength(2);
    });

    moveConceptSuggestion(1);
    expect(conceptSuggestionIndexSignal.value).toBe(0);
    moveConceptSuggestion(1);
    expect(conceptSuggestionIndexSignal.value).toBe(1);
    chooseConceptSuggestion(1);

    expect(cashFieldsSignal.value.concept).toBe('Flete');
    expect(conceptSuggestionsOpenSignal.value).toBe(false);
  });

  it('cancelCash vuelve a la venta', () => {
    enterCashScreen('in');
    cancelCash();
    expect(activeScreenSignal.value).toBe('sale');
  });
});
