import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSyncConfig, saveSyncConfig } from '../../sync/config.ts';
import { enterConfigScreen } from '../keyboard/config-controller.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { syncConfiguredSignal } from '../state/sync.ts';
import { ConfigScreen } from './config-screen.tsx';

const WEB_APP_URL = 'https://script.google.com/macros/s/abc/exec';
const CTRL_ENTER = { key: 'Enter', ctrlKey: true };

beforeEach(() => {
  syncConfiguredSignal.value = false;
  enterConfigScreen();
});

afterEach(() => {
  localStorage.clear();
});

function typeSelect(): HTMLSelectElement {
  return screen.getByLabelText<HTMLSelectElement>('Tipo de conexión');
}

describe('ConfigScreen', () => {
  it('muestra el selector de tipo con REST elegido y los campos de REST más el locale', () => {
    render(<ConfigScreen />);

    expect(typeSelect().value).toBe('rest');
    expect(screen.getByLabelText(/URL del sistema externo/)).not.toBeNull();
    expect(screen.getByLabelText(/API key/)).not.toBeNull();
    expect(screen.getByLabelText(/Locale/)).not.toBeNull();
  });

  it('el foco arranca en el selector de tipo', () => {
    render(<ConfigScreen />);

    expect(document.activeElement).toBe(typeSelect());
  });

  it('cambiar el tipo a Google Sheets intercambia los campos sin ocultar el selector', () => {
    render(<ConfigScreen />);

    fireEvent.change(typeSelect(), { target: { value: 'google-sheets' } });

    expect(screen.queryByLabelText(/URL del sistema externo/)).toBeNull();
    expect(screen.queryByLabelText(/API key/)).toBeNull();
    expect(screen.getByLabelText(/URL del Web App/)).not.toBeNull();
    expect(screen.getByLabelText(/Secreto compartido/)).not.toBeNull();
    expect(screen.getByLabelText(/Locale/)).not.toBeNull();
    expect(typeSelect().value).toBe('google-sheets');
  });

  it('marca como opcionales los campos opcionales', () => {
    render(<ConfigScreen />);

    expect(screen.getByLabelText(/API key.*opcional/)).not.toBeNull();
    expect(screen.queryByLabelText(/URL del sistema externo.*opcional/)).toBeNull();
  });

  it('Ctrl+Enter guarda todos los campos de REST juntos y vuelve a la venta', () => {
    render(<ConfigScreen />);
    const url = screen.getByLabelText(/URL del sistema externo/);
    const apiKey = screen.getByLabelText(/API key/);
    const locale = screen.getByLabelText(/Locale/);

    fireEvent.input(url, { target: { value: 'https://api.example.com' } });
    fireEvent.input(apiKey, { target: { value: 'secret' } });
    fireEvent.input(locale, { target: { value: 'en-US' } });
    fireEvent.keyDown(locale, CTRL_ENTER);

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

  it('Ctrl+Enter guarda una config de Google Sheets', () => {
    render(<ConfigScreen />);
    fireEvent.change(typeSelect(), { target: { value: 'google-sheets' } });
    const webApp = screen.getByLabelText(/URL del Web App/);

    fireEvent.input(webApp, { target: { value: WEB_APP_URL } });
    fireEvent.keyDown(webApp, CTRL_ENTER);

    expect(activeScreenSignal.value).toBe('sale');
    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { type: 'google-sheets', webAppUrl: WEB_APP_URL },
    });
  });

  it('Enter solo no guarda ni avanza (a diferencia del wizard anterior)', () => {
    render(<ConfigScreen />);
    const url = screen.getByLabelText(/URL del sistema externo/);

    fireEvent.input(url, { target: { value: 'https://api.example.com' } });
    fireEvent.keyDown(url, { key: 'Enter' });

    expect(activeScreenSignal.value).toBe('config');
    expect(loadSyncConfig().ok).toBe(false);
  });

  it('valida solo al confirmar: sin error mientras se tipea, alerta al Ctrl+Enter', () => {
    render(<ConfigScreen />);
    const url = screen.getByLabelText(/URL del sistema externo/);

    fireEvent.input(url, { target: { value: 'no-es-una-url' } });
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.keyDown(url, CTRL_ENTER);

    expect(screen.getByRole('alert').textContent).toContain('URL del sistema externo');
    expect(activeScreenSignal.value).toBe('config');
  });

  it('Escape cancela sin guardar y vuelve a la venta', () => {
    render(<ConfigScreen />);
    const url = screen.getByLabelText(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'https://api.example.com' } });

    fireEvent.keyDown(url, { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
    expect(loadSyncConfig().ok).toBe(false);
  });

  it('Escape también cancela con el foco en el selector de tipo', () => {
    render(<ConfigScreen />);

    fireEvent.keyDown(typeSelect(), { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('precarga la config guardada al abrirse', () => {
    saveSyncConfig({ type: 'google-sheets', webAppUrl: WEB_APP_URL, locale: 'es-AR' });
    enterConfigScreen();

    render(<ConfigScreen />);

    expect(typeSelect().value).toBe('google-sheets');
    expect(screen.getByLabelText<HTMLInputElement>(/URL del Web App/).value).toBe(WEB_APP_URL);
    expect(screen.getByLabelText<HTMLInputElement>(/Locale/).value).toBe('es-AR');
  });
});
