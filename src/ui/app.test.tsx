import { render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTrainingModeForTests } from '../storage/training-mode.ts';
import type { PendingExportFile } from '../sync/pending-export.ts';
import { App } from './app.tsx';
import { setCatalogRepository } from './state/catalog.ts';
import { cartSignal } from './state/cart.ts';
import { setCustomerRepository } from './state/customer-repository.ts';
import { activeScreenSignal } from './state/screen.ts';
import { connectionStateSignal, deviceRevokedSignal } from './state/sync.ts';
import { viewportWidthSignal } from './state/viewport.ts';

// La pantalla de la caja vinculada en otro dispositivo cuenta lo pendiente al montarse.
vi.mock(import('../sync/pending-export.ts'), () => ({
  buildPendingExportFile: vi.fn(() => new Promise<PendingExportFile>(() => {})),
}));

beforeEach(() => {
  // La conexión activa es lo normal: sin ella `App` solo muestra `/CONFIG` (Etapa 2b).
  connectionStateSignal.value = 'active';
  activeScreenSignal.value = 'sale';
  viewportWidthSignal.value = 1024;
  cartSignal.value = { lines: [] };
  setCatalogRepository({
    search: () => [],
    findByBarcodeOrSku: () => undefined,
    searchByCode: () => [],
    getProduct: () => undefined,
    getStock: () => Promise.resolve(undefined),
  });
  setCustomerRepository({
    search: () => [],
    listRecent: () => [],
    getCustomer: () => undefined,
    getCustomerAccount: () => Promise.resolve(undefined),
    getCustomerBalance: () => Promise.resolve(undefined),
  });
});

afterEach(() => {
  viewportWidthSignal.value = 1024;
  deviceRevokedSignal.value = undefined;
  setTrainingModeForTests(null);
});

describe('App (Ciclo 8: ancho mínimo soportado)', () => {
  it('con ancho suficiente, renderiza la pantalla activa dentro de ".app-zoom-wrapper"', () => {
    const { container } = render(<App />);

    expect(container.querySelector('.app-zoom-wrapper')).not.toBeNull();
    expect(screen.queryByText('Pantalla no compatible')).toBeNull();
  });

  it('por debajo del ancho mínimo, muestra la pantalla de "no compatible" en vez de la app', () => {
    viewportWidthSignal.value = 500;

    const { container } = render(<App />);

    expect(screen.getByText('Pantalla no compatible')).not.toBeNull();
    expect(container.querySelector('.app-zoom-wrapper')).toBeNull();
  });
});

describe('App (Etapa 2b: bloqueo de arranque)', () => {
  it.each(['unconfigured', 'unverified', 'incomplete'] as const)(
    'con la conexión %s muestra solo la configuración: no hay pantalla de venta ni barra de comandos',
    (state) => {
      connectionStateSignal.value = state;

      render(<App />);

      expect(screen.getByRole('heading', { name: 'Configurar conexión' })).not.toBeNull();
      expect(screen.queryByLabelText('Barra de comandos')).toBeNull();
    },
  );

  it('con la conexión activa muestra la pantalla de venta', () => {
    connectionStateSignal.value = 'active';

    render(<App />);

    expect(screen.getByLabelText('Barra de comandos')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Configurar conexión' })).toBeNull();
  });
});

describe('App (4.7.0, #230: caja vinculada en otro dispositivo)', () => {
  const REVOKED_HEADING = 'Esta caja fue vinculada en otro dispositivo';

  it('con la marca, solo la pantalla bloqueante: ni venta ni barra de comandos', () => {
    deviceRevokedSignal.value = { at: '2026-11-19T10:00:00.000Z' };
    activeScreenSignal.value = 'cash-summary';
    render(<App />);
    expect(screen.getByRole('heading', { name: REVOKED_HEADING })).not.toBeNull();
    expect(screen.queryByLabelText('Barra de comandos')).toBeNull();
  });

  it('sin conexión activa gana /CONFIG requerido', () => {
    deviceRevokedSignal.value = { at: '2026-11-19T10:00:00.000Z' };
    connectionStateSignal.value = 'unconfigured';
    render(<App />);
    expect(screen.queryByRole('heading', { name: REVOKED_HEADING })).toBeNull();
  });

  it('en entrenamiento no bloquea: se sigue practicando', () => {
    deviceRevokedSignal.value = { at: '2026-11-19T10:00:00.000Z' };
    setTrainingModeForTests({ startedAt: '2026-11-19T09:00:00.000Z' });
    render(<App />);
    expect(screen.queryByRole('heading', { name: REVOKED_HEADING })).toBeNull();
    expect(screen.getByLabelText('Barra de comandos')).not.toBeNull();
  });
});
