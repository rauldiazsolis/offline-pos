import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSyncConfig } from '../../sync/config.ts';
import { enterConfigScreen } from '../keyboard/config-controller.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { syncConfiguredSignal } from '../state/sync.ts';
import { ConfigScreen } from './config-screen.tsx';

beforeEach(() => {
  syncConfiguredSignal.value = false;
  enterConfigScreen();
});

afterEach(() => {
  localStorage.clear();
});

describe('ConfigScreen', () => {
  it('arranca pidiendo la URL', () => {
    render(<ConfigScreen />);
    expect(screen.getByText(/URL del sistema externo/)).not.toBeNull();
  });

  it('avanza a apiKey y luego a locale con una URL válida, y completa el flujo', () => {
    render(<ConfigScreen />);
    const input = screen.getByLabelText(/URL del sistema externo/);

    fireEvent.input(input, { target: { value: 'https://api.example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText(/API key/)).not.toBeNull();

    const apiKeyInput = screen.getByLabelText(/API key/);
    fireEvent.input(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.keyDown(apiKeyInput, { key: 'Enter' });

    expect(screen.getByText(/Locale/)).not.toBeNull();

    const localeInput = screen.getByLabelText(/Locale/);
    fireEvent.input(localeInput, { target: { value: 'en-US' } });
    fireEvent.keyDown(localeInput, { key: 'Enter' });

    expect(activeScreenSignal.value).toBe('sale');
    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: {
        type: 'rest',
        baseUrl: 'https://api.example.com',
        apiKey: 'secret',
        locale: 'en-US',
      },
    });
  });

  it('muestra un error con una URL inválida', () => {
    render(<ConfigScreen />);
    const input = screen.getByLabelText(/URL del sistema externo/);

    fireEvent.input(input, { target: { value: 'no-es-una-url' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByRole('alert')).not.toBeNull();
  });

  it('Escape cancela y vuelve a la venta', () => {
    render(<ConfigScreen />);
    const input = screen.getByLabelText(/URL del sistema externo/);

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });
});
