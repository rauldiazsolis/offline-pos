import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCashBalance,
  listConceptSuggestions,
  recordCashMovement,
} from '../../storage/cash-repository.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import { enterCashScreen } from '../keyboard/cash-controller.ts';
import { cashBalanceSignal, cashErrorSignal, cashKindSignal } from '../state/cash.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { CashScreen } from './cash-screen.tsx';

vi.mock('../../storage/cash-repository.ts', () => ({
  getCashBalance: vi.fn(),
  recordCashCount: vi.fn(),
  recordCashMovement: vi.fn(),
  listConceptSuggestions: vi.fn(),
}));

function getInput(label: string): HTMLInputElement {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return screen.getByLabelText(label) as HTMLInputElement;
}

async function renderCash(kind: 'count' | 'in' | 'out' = 'count'): Promise<void> {
  enterCashScreen(kind);
  render(<CashScreen />);
  await vi.waitFor(() => {
    expect(cashBalanceSignal.value).toBeDefined();
  });
}

beforeEach(() => {
  saveSyncConfig({ type: 'rest', baseUrl: 'http://x', locale: 'es-AR' });
  vi.mocked(getCashBalance).mockResolvedValue({ balance: 500 });
  vi.mocked(listConceptSuggestions).mockResolvedValue([]);
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  activeScreenSignal.value = 'sale';
});

describe('CashScreen', () => {
  it('Arqueo: foco en Contado, esperado, último arqueo y diferencia en vivo', async () => {
    await renderCash('count');

    expect(document.activeElement).toBe(getInput('Contado'));
    expect(screen.getByText('$500,00')).not.toBeNull();
    expect(screen.getByText(/Sin arqueo previo/)).not.toBeNull();

    fireEvent.input(getInput('Contado'), { target: { value: '600' } });
    expect(screen.getByText('Sobran $100,00')).not.toBeNull();
  });

  it('el selector es un radio: Alt+2 cambia a Ingreso y enfoca Concepto; ↓ en el selector avanza', async () => {
    await renderCash('count');

    fireEvent.keyDown(getInput('Contado'), { key: '2', altKey: true });
    expect(cashKindSignal.value).toBe('in');
    expect(document.activeElement).toBe(getInput('Concepto'));

    const ingreso = screen.getByRole('radio', { name: /Ingreso/ });
    expect(ingreso.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radiogroup')).not.toBeNull();

    fireEvent.keyDown(ingreso, { key: 'ArrowDown' });
    expect(cashKindSignal.value).toBe('out');
  });

  it('Ingreso: Enter y ↓ avanzan, ↑ retrocede', async () => {
    await renderCash('in');

    fireEvent.keyDown(getInput('Concepto'), { key: 'Enter' });
    expect(document.activeElement).toBe(getInput('Descripción'));
    fireEvent.keyDown(getInput('Descripción'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getInput('Monto'));
    fireEvent.keyDown(getInput('Monto'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(getInput('Descripción'));
  });

  it('con sugerencias abiertas, ↓ las recorre, Enter elige y Esc cierra sin salir', async () => {
    vi.mocked(listConceptSuggestions).mockResolvedValue(['Cambio inicial', 'Pago']);
    await renderCash('in');
    fireEvent.focus(getInput('Concepto'));
    await screen.findByText('Cambio inicial');

    fireEvent.keyDown(getInput('Concepto'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getInput('Concepto'));
    fireEvent.keyDown(getInput('Concepto'), { key: 'Enter' });
    expect(getInput('Concepto').value).toBe('Cambio inicial');
    expect(document.activeElement).toBe(getInput('Descripción'));

    fireEvent.focus(getInput('Concepto'));
    await screen.findByText('Pago');
    fireEvent.keyDown(getInput('Concepto'), { key: 'Escape' });
    expect(screen.queryByText('Pago')).toBeNull();
    expect(activeScreenSignal.value).toBe('cash');

    fireEvent.keyDown(getInput('Concepto'), { key: 'Escape' });
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('un egreso mayor que el saldo se advierte sin bloquear', async () => {
    await renderCash('out');
    fireEvent.input(getInput('Monto'), { target: { value: '600' } });
    expect(screen.getByText('El egreso supera el saldo esperado ($500,00)')).not.toBeNull();
  });

  it('Ctrl+Enter confirma y un error selecciona su campo', async () => {
    vi.mocked(recordCashMovement).mockResolvedValue({
      ok: false,
      error: 'cash/concept-required',
      meta: undefined,
    });
    await renderCash('out');
    fireEvent.keyDown(getInput('Monto'), { key: 'Enter', ctrlKey: true });

    await vi.waitFor(() => {
      expect(cashErrorSignal.value?.field).toBe('concept');
    });
    expect(screen.getByRole('alert').textContent).toBe('Falta el concepto.');
    expect(document.activeElement).toBe(getInput('Concepto'));
  });

  it('botones con su atajo', async () => {
    await renderCash('count');
    const cancel = screen.getByRole('button', { name: 'Cancelar (Esc)' });
    const confirm = screen.getByRole('button', { name: 'Confirmar (Ctrl+Enter)' });
    expect(confirm.className).toContain('btn-primary');

    fireEvent.click(cancel);
    expect(activeScreenSignal.value).toBe('sale');
  });
});
