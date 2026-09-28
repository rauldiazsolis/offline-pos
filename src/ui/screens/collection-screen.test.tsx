import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSyncConfig } from '../../sync/config.ts';
import { collectionBuffersSignal, emptyCollectionBuffers } from '../state/collection.ts';
import { customerBalancesSignal } from '../state/customer-balance.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { CollectionScreen } from './collection-screen.tsx';

const submitCollection = vi.fn(() => Promise.resolve());

vi.mock('../keyboard/collection-controller.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  submitCollection: () => submitCollection(),
}));

function getInput(label: string): HTMLInputElement {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return screen.getByLabelText(label) as HTMLInputElement;
}

beforeEach(() => {
  saveSyncConfig({ type: 'rest', baseUrl: 'http://x', locale: 'es-AR' });
  attachedCustomerSignal.value = { id: 'c1', name: 'Ana', createdAt: '2026-01-01T00:00:00.000Z' };
  customerBalancesSignal.value = new Map([['c1', 1500]]);
  collectionBuffersSignal.value = emptyCollectionBuffers();
  activeScreenSignal.value = 'collection';
  submitCollection.mockClear();
});

afterEach(() => {
  localStorage.clear();
});

describe('CollectionScreen (#101)', () => {
  it('título con el cliente, cinco campos sin Cuenta corriente y el primero con foco', () => {
    render(<CollectionScreen />);

    expect(screen.getByRole('heading', { name: 'Cobranza a Ana' })).not.toBeNull();
    for (const label of [
      'Efectivo',
      'Tarjeta de Débito',
      'Tarjeta de Crédito',
      'Transferencia',
      'Código QR',
    ]) {
      expect(getInput(label)).not.toBeNull();
    }
    expect(screen.queryByLabelText('Cuenta corriente')).toBeNull();
    expect(document.activeElement).toBe(getInput('Efectivo'));
  });

  it('muestra el total y el saldo en vivo', () => {
    render(<CollectionScreen />);
    expect(screen.getByText('Saldo actual: Debe $1.500,00')).not.toBeNull();

    fireEvent.input(getInput('Efectivo'), { target: { value: '1000' } });

    expect(screen.getByTestId('collection-total').textContent).toBe('1.000,00');
    expect(screen.getByText('Después: Debe $500,00')).not.toBeNull();
  });

  it('un cliente bloqueado se advierte sin bloquear', () => {
    attachedCustomerSignal.value = {
      id: 'c1',
      name: 'Ana',
      createdAt: '2026-01-01T00:00:00.000Z',
      blocked: { reason: 'Deuda vencida' },
    };
    render(<CollectionScreen />);

    expect(screen.getByText('⚠ Bloqueado: Deuda vencida')).not.toBeNull();
  });

  it('Enter y ↓ pasan al campo siguiente, ↑ al anterior', () => {
    render(<CollectionScreen />);

    fireEvent.keyDown(getInput('Efectivo'), { key: 'Enter' });
    expect(document.activeElement).toBe(getInput('Tarjeta de Débito'));
    fireEvent.keyDown(getInput('Tarjeta de Débito'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getInput('Tarjeta de Crédito'));
    fireEvent.keyDown(getInput('Tarjeta de Crédito'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(getInput('Tarjeta de Débito'));
  });

  it('Ctrl+Enter confirma y Esc cancela', () => {
    render(<CollectionScreen />);

    fireEvent.keyDown(getInput('Efectivo'), { key: 'Enter', ctrlKey: true });
    expect(submitCollection).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(getInput('Efectivo'), { key: 'Escape' });
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('los botones hacen lo mismo que sus teclas', () => {
    render(<CollectionScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobranza (Ctrl+Enter)' }));
    expect(submitCollection).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar (Esc)' }));
    expect(activeScreenSignal.value).toBe('sale');
  });
});
