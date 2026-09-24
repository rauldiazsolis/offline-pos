import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../storage/db.ts';
import { loadSyncConfig, saveSyncConfig } from '../../sync/config.ts';
import {
  enterConfigScreen,
  goToStep,
  jumpToStep,
  openRequiredWizard,
  setConfigField,
  setConfigType,
} from '../keyboard/config-controller.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { connectionStateSignal } from '../state/sync.ts';
import {
  configTerminalSignal,
  identityResetSignal,
  localChoiceSignal,
  wizardStepSignal,
} from '../state/sync-config.ts';
import { ConfigScreen } from './config-screen.tsx';

// El ciclo de sync en background que dispara la aplicación de la conexión
// seguiría corriendo cuando el test cierra la base; se neutraliza solo el ciclo.
vi.mock('../../sync/engine.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runPushThenPull: vi.fn(() => Promise.resolve()),
}));

const WEB_APP_URL = 'https://script.google.com/macros/s/abc/exec';

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) } as Response;
}

function stubRestBackend(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = new URL(url).pathname;
      const body =
        path === '/sync/pull'
          ? { products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }
          : {};
      return Promise.resolve(okResponse(body));
    }),
  );
}

/** Fetch colgado hasta que el test lo suelta (para no dejar el cerrojo de sync tomado). */
function stubHangingFetch(): () => void {
  let fail: (reason: Error) => void = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          fail = reject;
        }),
    ),
  );
  return () => {
    fail(new Error('fin del test'));
  };
}

beforeEach(async () => {
  await db.open();
  activeScreenSignal.value = 'config';
  identityResetSignal.value = false;
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('ConfigScreen — wizard', () => {
  beforeEach(async () => {
    connectionStateSignal.value = 'unconfigured';
    await openRequiredWizard();
  });

  it('muestra los seis pasos y arranca en Terminal con el foco en Sucursal', () => {
    render(<ConfigScreen />);
    for (const title of [
      'Terminal',
      'Tipo de conexión',
      'Datos del conector',
      'Probar',
      'Datos locales',
      'Revisar',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(`Paso \\d: ${title}`) })).not.toBeNull();
    }
    expect(
      screen.getByRole('button', { name: 'Paso 1: Terminal' }).getAttribute('aria-current'),
    ).toBe('step');
    expect(document.activeElement).toBe(screen.getByLabelText('Sucursal'));
  });

  it('Enter sin sucursal muestra el error y selecciona el campo', () => {
    render(<ConfigScreen />);
    fireEvent.keyDown(screen.getByLabelText('Sucursal'), { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toContain('Sucursal');
    expect(document.activeElement).toBe(screen.getByLabelText('Sucursal'));
  });

  it('muestra el aviso de identidad perdida en Terminal', async () => {
    identityResetSignal.value = true;
    await openRequiredWizard();
    render(<ConfigScreen />);
    expect(screen.getByText(/Esta terminal no tenía identidad/)).not.toBeNull();
  });

  it('con el mouse: completar terminal, elegir tipo con click, avanzar con el botón', async () => {
    stubRestBackend();
    render(<ConfigScreen />);
    fireEvent.input(screen.getByLabelText('Sucursal'), { target: { value: 'Centro' } });
    fireEvent.input(screen.getByLabelText('Punto de venta'), { target: { value: 'Caja 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente (Enter)' }));
    fireEvent.click(screen.getByRole('button', { name: /^REST genérico/ }));
    fireEvent.input(screen.getByLabelText('URL del sistema externo'), {
      target: { value: 'http://a.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente (Enter)' }));
    await waitFor(() => {
      expect(screen.getByText(/Conexión OK/)).not.toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente (Enter)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar (Enter)' }));
    await waitFor(() => {
      expect(activeScreenSignal.value).toBe('sale');
    });
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value).toMatchObject({ branch: 'Centro', pointOfSale: 'Caja 1' });
  });

  it('↓ y Enter en Tipo de conexión eligen y avanzan, con las instrucciones del tipo', async () => {
    configTerminalSignal.value = { branch: 'Centro', pointOfSale: 'Caja 1', locale: '' };
    render(<ConfigScreen />);
    await act(() => {
      jumpToStep('type');
    });
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    expect(
      screen.getByRole('button', { name: /^Google Sheets/ }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(wizardStepSignal.value).toBe('connector');
    expect(screen.getByText(/termina en \/exec/)).not.toBeNull();
    fireEvent.input(screen.getByLabelText('URL del Web App de Google Apps Script'), {
      target: { value: 'no-es-url' },
    });
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toContain('no es válido');
  });

  it('mientras prueba muestra spinner, qué espera y los segundos', async () => {
    const releaseFetch = stubHangingFetch();
    configTerminalSignal.value = { branch: 'Centro', pointOfSale: 'Caja 1', locale: '' };
    setConfigType('rest');
    setConfigField('baseUrl', 'http://a.test');
    render(<ConfigScreen />);
    jumpToStep('probe');
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(
        /Pidiendo productos, stock y clientes a a\.test/,
      );
    });
    expect(document.querySelector('.spinner')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/máx\. 20 s/);
    expect(screen.getByRole('button', { name: 'Cancelar prueba (Esc)' })).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByText('Prueba cancelada.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Reintentar (Enter)' })).not.toBeNull();
    releaseFetch();
  });

  it('una prueba fallida ofrece corregir los datos', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    configTerminalSignal.value = { branch: 'Centro', pointOfSale: 'Caja 1', locale: '' };
    setConfigType('google-sheets');
    setConfigField('webAppUrl', WEB_APP_URL);
    render(<ConfigScreen />);
    jumpToStep('probe');
    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Corregir datos (Alt+3)' }));
    expect(wizardStepSignal.value).toBe('connector');
  });

  it('Alt+1 vuelve a Terminal desde otro paso', () => {
    configTerminalSignal.value = { branch: 'Centro', pointOfSale: 'Caja 1', locale: '' };
    render(<ConfigScreen />);
    jumpToStep('type');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: '1', altKey: true });
    expect(wizardStepSignal.value).toBe('terminal');
  });

  it('Alt+← vuelve al paso anterior; un paso no alcanzable está deshabilitado', () => {
    configTerminalSignal.value = { branch: 'Centro', pointOfSale: 'Caja 1', locale: '' };
    render(<ConfigScreen />);
    jumpToStep('type');
    expect(screen.getByRole('button', { name: 'Paso 6: Revisar' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft', altKey: true });
    expect(wizardStepSignal.value).toBe('terminal');
  });

  it('en modo requerido no hay botón Cancelar y Esc no sale', () => {
    render(<ConfigScreen />);
    expect(screen.queryByRole('button', { name: 'Cancelar (Esc)' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(activeScreenSignal.value).toBe('config');
  });

  it('un mousedown fuera de los campos no le saca el foco al campo', () => {
    render(<ConfigScreen />);
    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    screen.getByRole('heading', { name: 'Configurar conexión' }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('ConfigScreen — terminal activa', () => {
  beforeEach(() => {
    saveSyncConfig({
      type: 'google-sheets',
      webAppUrl: WEB_APP_URL,
      sharedSecret: 'shh',
      branch: 'Centro',
      pointOfSale: 'Caja 1',
      verifiedAt: '2026-09-23T14:02:00.000Z',
    });
    connectionStateSignal.value = 'active';
    enterConfigScreen();
  });

  it('abre en Revisar con el resumen, el secreto oculto y Cancelar', () => {
    render(<ConfigScreen />);
    expect(screen.getByRole('button', { name: 'Aplicar (Enter)' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Cancelar (Esc)' })).not.toBeNull();
    expect(screen.getAllByText(/Centro · Caja 1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Secreto compartido: •••/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/shh/)).toBeNull();
    expect(
      screen.getByText('Se guarda la sucursal, el punto de venta y el locale.'),
    ).not.toBeNull();
  });

  it('Esc sale', () => {
    render(<ConfigScreen />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('"Cancelar (Esc)" sale', () => {
    render(<ConfigScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar (Esc)' }));
    expect(activeScreenSignal.value).toBe('sale');
  });
});

describe('ConfigScreen — correcciones de la prueba manual', () => {
  beforeEach(async () => {
    connectionStateSignal.value = 'unconfigured';
    await openRequiredWizard();
  });

  it('Tipo de conexión: el foco va a una opción y sigue a ↑/↓', async () => {
    configTerminalSignal.value = { branch: 'Centro', pointOfSale: 'Caja 1', locale: '' };
    render(<ConfigScreen />);
    await act(() => {
      jumpToStep('type');
    });
    // Sin tipo elegido, el foco está en la primera opción (nunca en un contenedor invisible).
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^REST genérico/ }));
    await act(() => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' });
    });
    await act(() => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' });
    });
    const demo = screen.getByRole('button', { name: /^REST \(minibackend de demo\)/ });
    expect(demo.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(demo);
  });

  it('Ctrl+Enter con el foco en una opción también avanza', async () => {
    configTerminalSignal.value = { branch: 'Centro', pointOfSale: 'Caja 1', locale: '' };
    setConfigType('rest');
    render(<ConfigScreen />);
    await act(() => {
      jumpToStep('type');
    });
    const rest = screen.getByRole('button', { name: /^REST genérico/ });
    expect(document.activeElement).toBe(rest);
    await act(() => {
      fireEvent.keyDown(rest, { key: 'Enter', ctrlKey: true });
    });
    // Sin URL, Ctrl+Enter se frena en "Datos del conector" con el error.
    expect(wizardStepSignal.value).toBe('connector');
  });

  it('los ejemplos de los campos dicen "ej. …"', () => {
    render(<ConfigScreen />);
    expect(screen.getByLabelText('Sucursal').getAttribute('placeholder')).toBe('ej. Casa central');
    expect(screen.getByLabelText('Punto de venta').getAttribute('placeholder')).toBe('ej. Caja 1');
  });

  it('la acción principal se ve como tal', () => {
    render(<ConfigScreen />);
    expect(screen.getByRole('button', { name: 'Siguiente (Enter)' }).className).toContain(
      'btn-primary',
    );
    expect(screen.getByRole('button', { name: 'Atrás (Alt+←)' }).className).not.toContain(
      'btn-primary',
    );
  });
});

describe('ConfigScreen — pasos salteados y Datos locales', () => {
  beforeEach(() => {
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'http://a.test',
      branch: 'Centro',
      pointOfSale: 'Caja 1',
      verifiedAt: '2026-09-23T14:02:00.000Z',
    });
    connectionStateSignal.value = 'active';
  });

  it('un paso salteado explica por qué no hace falta', async () => {
    enterConfigScreen();
    render(<ConfigScreen />);
    await waitFor(() => {
      expect(
        screen.getAllByText(/No hace falta: la conexión no cambió \(probada el/).length,
      ).toBeGreaterThan(0);
    });
  });

  it('Datos locales: el foco está en la opción elegida y Enter sobre ella avanza a Revisar', async () => {
    stubRestBackend();
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
    await act(() => {
      goToStep('connector');
      setConfigField('baseUrl', 'http://b.test');
      goToStep('probe');
    });
    await waitFor(() => {
      expect(screen.getByText(/Conexión OK/)).not.toBeNull();
    });
    await act(() => {
      goToStep('local-data');
    });
    const keep = await screen.findByRole('button', { name: 'Mantener los datos locales' });
    expect(document.activeElement).toBe(keep);
    await act(() => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' });
    });
    const wipe = screen.getByRole('button', { name: 'Borrar los datos locales' });
    expect(localChoiceSignal.value).toBe('wipe');
    expect(document.activeElement).toBe(wipe);
    await act(() => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowUp' });
    });
    await act(() => {
      fireEvent.keyDown(keep, { key: 'Enter' });
    });
    expect(wizardStepSignal.value).toBe('review');
  });
});
