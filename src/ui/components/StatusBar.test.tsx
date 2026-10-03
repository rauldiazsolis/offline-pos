import { fireEvent, render, screen } from '@testing-library/preact';
import { activeScreenSignal } from '../state/screen.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from './StatusBar.tsx';
import { cashKindSignal, lastCashCountAtSignal, nowMinuteSignal } from '../state/cash.ts';
import { startNewDemo, startOnboarding } from '../keyboard/onboarding-controller.ts';
import {
  backendCompanySignal,
  backendNoticesSignal,
  backendStatusSignal,
  demoRevokedSignal,
  lastPullApplicationSignal,
  lastSyncFailureSignal,
  lastSyncedAtSignal,
  localCatalogCountsSignal,
  pendingOutboxCountSignal,
  setDemoSession,
  setTerminalIdentity,
  syncConfiguredSignal,
  syncStatusSignal,
} from '../state/sync.ts';

vi.mock('../keyboard/onboarding-controller.ts', () => ({
  startOnboarding: vi.fn(),
  startNewDemo: vi.fn(),
}));

const demo = {
  template: 'kiosco',
  onboarding: { url: 'https://b.x/alta', label: 'Crear mi comercio' },
  startedAt: '2026-09-28T12:00:00.000Z',
};

beforeEach(() => {
  syncStatusSignal.value = 'offline';
  pendingOutboxCountSignal.value = 0;
  lastSyncedAtSignal.value = null;
  lastSyncFailureSignal.value = null;
  localCatalogCountsSignal.value = null;
  syncConfiguredSignal.value = true;
  lastPullApplicationSignal.value = null;
  backendNoticesSignal.value = [];
  setTerminalIdentity(null);
  backendCompanySignal.value = undefined;
  // Por defecto, con un arqueo reciente: el aviso de caja no aparece salvo en sus propios tests.
  nowMinuteSignal.value = '2026-09-24T12:00:00.000Z';
  lastCashCountAtSignal.value = '2026-09-24T11:00:00.000Z';
});

describe('aviso "Sin arqueo en 24 h" (#100)', () => {
  it('sin arqueo reciente se ve un botón que abre el arqueo sin abrir /DIAGNOSTICO', () => {
    lastCashCountAtSignal.value = undefined;
    activeScreenSignal.value = 'sale';
    render(<StatusBar />);

    const button = screen.getByRole('button', { name: 'Sin arqueo en 24 h' });
    expect(button.tabIndex).toBe(-1);
    fireEvent.click(button);

    expect(activeScreenSignal.value).toBe('cash');
    expect(cashKindSignal.value).toBe('count');
  });

  it('con un arqueo reciente no aparece', () => {
    render(<StatusBar />);
    expect(screen.queryByRole('button', { name: 'Sin arqueo en 24 h' })).toBeNull();
  });

  it('convive con la marca DEMO y el botón de alta', () => {
    lastCashCountAtSignal.value = undefined;
    setDemoSession(demo);
    try {
      render(<StatusBar />);
      expect(screen.getByRole('button', { name: 'Sin arqueo en 24 h' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Crear mi comercio (/ALTA)' })).not.toBeNull();
    } finally {
      setDemoSession(null);
    }
  });
});

describe('StatusBar — terminal en demo (#128)', () => {
  afterEach(() => {
    setDemoSession(null);
    demoRevokedSignal.value = null;
  });

  it('con la demo revocada: "La demo terminó" y el botón de una demo nueva en lugar del alta (#176)', () => {
    vi.mocked(startNewDemo).mockClear();
    syncStatusSignal.value = 'sync-error';
    setDemoSession(demo);
    demoRevokedSignal.value = '2026-10-02T10:00:00.000Z';
    activeScreenSignal.value = 'sale';
    render(<StatusBar />);

    expect(screen.getByText('DEMO')).not.toBeNull();
    expect(screen.getByText('La demo terminó')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Crear mi comercio (/ALTA)' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Empezar una demo nueva (/DEMO_NUEVA)' });
    expect(button.tabIndex).toBe(-1);
    fireEvent.click(button);

    expect(startNewDemo).toHaveBeenCalledTimes(1);
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('sin demo no hay marca ni botón de alta', () => {
    render(<StatusBar />);
    expect(screen.queryByText('DEMO')).toBeNull();
    expect(screen.queryByRole('button', { name: /\(\/ALTA\)/ })).toBeNull();
  });

  it('con demo se ven DEMO y el botón; el click lleva al alta sin abrir /DIAGNOSTICO', () => {
    vi.mocked(startOnboarding).mockClear();
    setDemoSession(demo);
    activeScreenSignal.value = 'sale';
    render(<StatusBar />);

    expect(screen.getByText('DEMO')).not.toBeNull();
    const button = screen.getByRole('button', { name: 'Crear mi comercio (/ALTA)' });
    expect(button.tabIndex).toBe(-1);
    fireEvent.click(button);

    expect(startOnboarding).toHaveBeenCalledTimes(1);
    expect(activeScreenSignal.value).toBe('sale');
  });
});

describe('StatusBar', () => {
  it('muestra "Sin conexión" con el conteo de pendientes cuando está offline', () => {
    syncStatusSignal.value = 'offline';
    pendingOutboxCountSignal.value = 3;

    render(<StatusBar />);

    expect(screen.getByText('Sin conexión (3)')).not.toBeNull();
  });

  it('muestra "Sin configurar" si hay red pero no hay config, aunque no esté offline', () => {
    syncStatusSignal.value = 'online-idle';
    syncConfiguredSignal.value = false;

    render(<StatusBar />);

    expect(screen.getByText('Sin configurar — /CONFIG')).not.toBeNull();
  });

  it('offline tiene precedencia sobre "sin configurar"', () => {
    syncStatusSignal.value = 'offline';
    syncConfiguredSignal.value = false;

    render(<StatusBar />);

    expect(screen.getByText(/Sin conexión/)).not.toBeNull();
  });

  it('muestra "Sincronizando" con el conteo de pendientes', () => {
    syncStatusSignal.value = 'syncing';
    pendingOutboxCountSignal.value = 2;

    render(<StatusBar />);

    expect(screen.getByText('Sincronizando (2)')).not.toBeNull();
  });

  it('muestra "Problema de sincronización" en sync-error', () => {
    syncStatusSignal.value = 'sync-error';

    render(<StatusBar />);

    expect(screen.getByText('Problema de sincronización')).not.toBeNull();
  });

  it('muestra "Sincronizado" con la hora en online-idle', () => {
    syncStatusSignal.value = 'online-idle';
    lastSyncedAtSignal.value = '2026-01-01T00:00:00.000Z';

    render(<StatusBar />);

    expect(screen.getByText(/^Sincronizado \(/)).not.toBeNull();
  });

  it('en sync-error muestra el motivo traducido', () => {
    syncStatusSignal.value = 'sync-error';
    lastSyncFailureSignal.value = {
      ok: false,
      error: 'sync/request-failed',
      meta: { status: 401, message: 'x' },
    };

    render(<StatusBar />);

    expect(
      screen.getByText('Problema de sincronización: El servidor rechazó las credenciales (401).'),
    ).not.toBeNull();
  });

  it('en sync-error muestra también la hora de la última sync exitosa', () => {
    syncStatusSignal.value = 'sync-error';
    lastSyncedAtSignal.value = '2026-01-01T00:00:00.000Z';

    render(<StatusBar />);

    expect(screen.getByText(/^Problema de sincronización · última sync OK /)).not.toBeNull();
  });

  it('en online-idle muestra lo que hay en la base local', () => {
    syncStatusSignal.value = 'online-idle';
    lastSyncedAtSignal.value = '2026-01-01T00:00:00.000Z';
    localCatalogCountsSignal.value = { products: 120, customers: 22 };

    render(<StatusBar />);

    expect(screen.getByText(/· 120 productos · 22 clientes$/)).not.toBeNull();
  });
});

describe('StatusBar — avisos del backend (4.4.0, #128)', () => {
  it('sin avisos no aparece', () => {
    render(<StatusBar />);
    expect(screen.queryByRole('button', { name: /^Avisos/ })).toBeNull();
  });

  it('con avisos muestra "Avisos (N)" con el color del más grave y el click abre /DIAGNOSTICO', () => {
    backendNoticesSignal.value = [
      { id: 'a', severity: 'info', message: 'uno' },
      { id: 'b', severity: 'critical', message: 'dos' },
    ];
    activeScreenSignal.value = 'sale';
    render(<StatusBar />);

    const button = screen.getByRole('button', { name: 'Avisos (2)' });
    expect(button.tabIndex).toBe(-1);
    expect(button.style.color).toBe('var(--color-danger)');
    fireEvent.click(button);

    expect(activeScreenSignal.value).toBe('diagnostico');
  });
});

describe('StatusBar — empresa, sucursal y caja (#193)', () => {
  it('línea de contexto: caja - sucursal - empresa', () => {
    setTerminalIdentity({ branch: 'Central', pointOfSale: 'Caja 1' });
    backendCompanySignal.value = 'Kiosco Pepe';
    render(<StatusBar />);
    expect(screen.getByText('Caja 1 - Central - Kiosco Pepe')).not.toBeNull();
  });

  it('sin empresa, caja - sucursal', () => {
    setTerminalIdentity({ branch: 'Central', pointOfSale: 'Caja 1' });
    render(<StatusBar />);
    expect(screen.getByText('Caja 1 - Central')).not.toBeNull();
  });

  it('DEMO y el botón del alta van en la línea del contexto, no en la del estado', () => {
    setTerminalIdentity({ branch: 'Central', pointOfSale: 'Caja 1' });
    setDemoSession(demo);
    try {
      render(<StatusBar />);
      const contextLine = screen.getByTestId('status-bar-context');
      expect(contextLine.textContent).toContain('DEMO');
      expect(contextLine.textContent).toContain('Caja 1 - Central');
      expect(contextLine.textContent).toContain('Crear mi comercio (/ALTA)');
      expect(screen.getByTestId('status-bar-sync').textContent).not.toContain('DEMO');
    } finally {
      setDemoSession(null);
    }
  });

  it('sin identidad ni demo no hay línea de contexto', () => {
    render(<StatusBar />);
    expect(screen.queryByTestId('status-bar-context')).toBeNull();
  });

  it('un click en la línea de contexto abre /DIAGNOSTICO', () => {
    setTerminalIdentity({ branch: 'Central', pointOfSale: 'Caja 1' });
    activeScreenSignal.value = 'sale';
    render(<StatusBar />);
    fireEvent.click(screen.getByText('Caja 1 - Central'));
    expect(activeScreenSignal.value).toBe('diagnostico');
  });
});

describe('StatusBar — click (Etapa 2 de #94)', () => {
  it('un click abre /DIAGNOSTICO', () => {
    activeScreenSignal.value = 'sale';
    render(<StatusBar />);
    fireEvent.click(screen.getByTitle('Ver diagnóstico de sincronización (/DIAGNOSTICO)'));
    expect(activeScreenSignal.value).toBe('diagnostico');
  });
});

describe('StatusBar — pull que retiene (#98)', () => {
  it('avisa que stock y saldos esperan al backend, sin marcar error', () => {
    syncStatusSignal.value = 'online-idle';
    lastPullApplicationSignal.value = { kind: 'retained', lotIds: ['L1'] };
    render(<StatusBar />);
    expect(screen.getByText(/Sincronizado.*stock y saldos en espera del backend/)).not.toBeNull();
  });

  it('sin retención no muestra el aviso', () => {
    syncStatusSignal.value = 'online-idle';
    lastPullApplicationSignal.value = { kind: 'reapplied', events: 2 };
    render(<StatusBar />);
    expect(screen.queryByText(/en espera del backend/)).toBeNull();
  });
});

describe('StatusBar — estado del backend (#99)', () => {
  beforeEach(() => {
    backendStatusSignal.value = { kind: 'unknown' };
  });

  it('backend incompatible, con estilo de error', () => {
    syncStatusSignal.value = 'online-idle';
    backendStatusSignal.value = { kind: 'incompatible', backendVersion: '3.0.0' };

    const { container } = render(<StatusBar />);

    expect(
      screen.getByText('Backend incompatible (contrato 3.0.0, se necesita 4.0 o posterior)'),
    ).not.toBeNull();
    const dot = container.querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(dot?.style.background).toBe('var(--color-danger)');
  });

  it('backend en mantenimiento con su mensaje', () => {
    syncStatusSignal.value = 'online-idle';
    backendStatusSignal.value = {
      kind: 'maintenance',
      info: { contractVersion: '4.0.0', status: 'maintenance', message: 'Cierre de mes' },
    };

    render(<StatusBar />);

    expect(screen.getByText('Backend en mantenimiento: Cierre de mes')).not.toBeNull();
  });

  it('offline tiene precedencia', () => {
    syncStatusSignal.value = 'offline';
    backendStatusSignal.value = { kind: 'incompatible', backendVersion: '3.0.0' };

    render(<StatusBar />);

    expect(screen.getByText('Sin conexión (0)')).not.toBeNull();
  });
});
