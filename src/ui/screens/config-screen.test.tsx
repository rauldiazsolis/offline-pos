import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../storage/db.ts';
import { loadSyncConfig, saveSyncConfig } from '../../sync/config.ts';
import { enterConfigScreen } from '../keyboard/config-controller.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { connectionStateSignal } from '../state/sync.ts';
import { ConfigScreen } from './config-screen.tsx';

// El ciclo de sync en background que dispara la aplicación de la conexión
// seguiría corriendo cuando el test cierra la base; se neutraliza solo el ciclo.
vi.mock('../../sync/engine.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runSyncCycle: vi.fn(() => Promise.resolve()),
}));

const WEB_APP_URL = 'https://script.google.com/macros/s/abc/exec';
const CTRL_ENTER = { key: 'Enter', ctrlKey: true };

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) } as Response;
}

function stubRestBackend(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = new URL(url).pathname;
      return Promise.resolve(okResponse(path === '/stock' ? [] : { items: [] }));
    }),
  );
}

beforeEach(async () => {
  await db.open();
  connectionStateSignal.value = 'active';
  enterConfigScreen();
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function typeSelect(): HTMLSelectElement {
  return screen.getByLabelText<HTMLSelectElement>('Tipo de conexión');
}

function chooseRest(): void {
  fireEvent.change(typeSelect(), { target: { value: 'rest' } });
}

describe('ConfigScreen — formulario', () => {
  it('arranca sin tipo elegido y sin ningún campo, solo el selector', () => {
    render(<ConfigScreen />);

    expect(typeSelect().value).toBe('');
    expect(screen.queryByLabelText(/URL del sistema externo/)).toBeNull();
    expect(screen.queryByLabelText(/Locale/)).toBeNull();
  });

  it('el foco arranca en el selector de tipo', () => {
    render(<ConfigScreen />);

    expect(document.activeElement).toBe(typeSelect());
  });

  it('elegir REST muestra sus campos más el locale, sin valores por omisión y con placeholders', () => {
    render(<ConfigScreen />);

    chooseRest();

    const url = screen.getByLabelText<HTMLInputElement>(/URL del sistema externo/);
    expect(url.value).toBe('');
    expect(url.placeholder).toBe('https://api.miempresa.com');
    expect(screen.getByLabelText(/API key/)).not.toBeNull();
    expect(screen.getByLabelText(/Locale/)).not.toBeNull();
  });

  it('cambiar a Google Sheets intercambia los campos sin ocultar el selector', () => {
    render(<ConfigScreen />);
    chooseRest();

    fireEvent.change(typeSelect(), { target: { value: 'google-sheets' } });

    expect(screen.queryByLabelText(/URL del sistema externo/)).toBeNull();
    expect(screen.getByLabelText(/URL del Web App/)).not.toBeNull();
    expect(screen.getByLabelText(/Secreto compartido/)).not.toBeNull();
    expect(typeSelect().value).toBe('google-sheets');
  });

  it('marca como opcionales los campos opcionales', () => {
    render(<ConfigScreen />);
    chooseRest();

    expect(screen.getByLabelText(/API key.*opcional/)).not.toBeNull();
    expect(screen.queryByLabelText(/URL del sistema externo.*opcional/)).toBeNull();
  });

  it('valida solo al confirmar: sin error mientras se tipea, alerta al Ctrl+Enter', () => {
    render(<ConfigScreen />);
    chooseRest();
    const url = screen.getByLabelText(/URL del sistema externo/);

    fireEvent.input(url, { target: { value: 'no-es-una-url' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.keyDown(url, CTRL_ENTER);

    expect(screen.getByRole('alert').textContent).toContain('URL del sistema externo');
    expect(activeScreenSignal.value).toBe('config');
  });

  it('tras un error de validación, el campo queda enfocado y con todo su texto seleccionado', () => {
    render(<ConfigScreen />);
    chooseRest();
    const url = screen.getByLabelText<HTMLInputElement>(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'no-es-una-url' } });

    fireEvent.keyDown(url, CTRL_ENTER);

    expect(document.activeElement).toBe(url);
    expect(url.selectionStart).toBe(0);
    expect(url.selectionEnd).toBe('no-es-una-url'.length);
  });

  it('Enter solo no prueba ni guarda nada', () => {
    stubRestBackend();
    render(<ConfigScreen />);
    chooseRest();
    const url = screen.getByLabelText(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'https://api.example.com' } });

    fireEvent.keyDown(url, { key: 'Enter' });

    expect(loadSyncConfig().ok).toBe(false);
    expect(screen.queryByText(/Probando conexión/)).toBeNull();
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

describe('ConfigScreen — probar y guardar', () => {
  it('Ctrl+Enter prueba, guarda con verifiedAt y vuelve a la venta', async () => {
    stubRestBackend();
    render(<ConfigScreen />);
    chooseRest();
    const url = screen.getByLabelText(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'https://api.example.com' } });

    fireEvent.keyDown(url, CTRL_ENTER);

    await waitFor(() => {
      expect(activeScreenSignal.value).toBe('sale');
    });
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value.verifiedAt).toBeTruthy();
  });

  it('muestra "Probando conexión…" mientras espera', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    render(<ConfigScreen />);
    chooseRest();
    const url = screen.getByLabelText(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'https://api.example.com' } });

    fireEvent.keyDown(url, CTRL_ENTER);

    await waitFor(() => {
      expect(screen.getByText('Probando conexión…')).not.toBeNull();
    });
  });

  it('si la prueba falla, muestra el motivo y el formulario queda editable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    render(<ConfigScreen />);
    chooseRest();
    const url = screen.getByLabelText(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'https://api.example.com' } });

    fireEvent.keyDown(url, CTRL_ENTER);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'No se pudo conectar con el servidor',
      );
    });
    expect(activeScreenSignal.value).toBe('config');
    expect(loadSyncConfig().ok).toBe(false);
  });
});

describe('ConfigScreen — confirmación del borrado', () => {
  async function openConfirmation(): Promise<void> {
    stubRestBackend();
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'https://viejo.example.com',
      verifiedAt: '2025-12-01T00:00:00.000Z',
    });
    await db.sales.put({
      id: 's1',
      lines: [],
      payments: [],
      total: 0,
      status: 'closed',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    enterConfigScreen();
    render(<ConfigScreen />);
    const url = screen.getByLabelText(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'https://nuevo.example.com' } });
    fireEvent.keyDown(url, CTRL_ENTER);
    await waitFor(() => {
      expect(screen.getByText(/Cambiar de conexión borra/)).not.toBeNull();
    });
  }

  it('muestra qué se pierde, con los conteos', async () => {
    await openConfirmation();

    expect(screen.getByText(/1 venta/)).not.toBeNull();
    expect(screen.getByText(/Enter borra y cambia de conexión/)).not.toBeNull();
  });

  it('Enter confirma: aplica la conexión nueva y vuelve a la venta', async () => {
    await openConfirmation();

    fireEvent.keyDown(screen.getByText(/Cambiar de conexión borra/), { key: 'Enter' });

    await waitFor(() => {
      expect(activeScreenSignal.value).toBe('sale');
    });
    await expect(db.sales.count()).resolves.toBe(0);
  });

  it('Esc vuelve a editar sin borrar nada', async () => {
    await openConfirmation();

    fireEvent.keyDown(screen.getByText(/Cambiar de conexión borra/), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText(/Cambiar de conexión borra/)).toBeNull();
    });
    await expect(db.sales.count()).resolves.toBe(1);
    expect(activeScreenSignal.value).toBe('config');
  });
});

describe('ConfigScreen — modo normal vs. requerido', () => {
  it('con la conexión activa: hay botón Cancelar y Esc sale', () => {
    connectionStateSignal.value = 'active';
    render(<ConfigScreen />);

    expect(screen.getByRole('button', { name: 'Cancelar' })).not.toBeNull();
    fireEvent.keyDown(typeSelect(), { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('modo requerido: sin Cancelar, con el texto de bienvenida, y Esc no sale', () => {
    connectionStateSignal.value = 'unconfigured';
    render(<ConfigScreen />);

    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    expect(screen.getByText('Configurá y probá la conexión para empezar.')).not.toBeNull();
    fireEvent.keyDown(typeSelect(), { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('config');
  });
});
