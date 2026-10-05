import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startNewDemo, startOnboarding } from '../keyboard/onboarding-controller.ts';
import { openPortal } from '../keyboard/portal-controller.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  backendCapabilitiesSignal,
  backendCompanySignal,
  backendPortalSignal,
  demoRevokedSignal,
  setDemoSession,
  setTerminalIdentity,
} from '../state/sync.ts';
import { TerminalHeader } from './TerminalHeader.tsx';

vi.mock('../keyboard/onboarding-controller.ts', () => ({
  startOnboarding: vi.fn(),
  startNewDemo: vi.fn(),
}));

vi.mock('../keyboard/portal-controller.ts', () => ({ openPortal: vi.fn(() => Promise.resolve()) }));

const demo = {
  template: 'kiosco',
  onboarding: { url: 'https://b.x/alta', label: 'Crear mi comercio' },
  startedAt: '2026-09-28T12:00:00.000Z',
};

beforeEach(() => {
  setTerminalIdentity({ branch: 'Central', pointOfSale: 'Caja 1' });
  backendCompanySignal.value = undefined;
  activeScreenSignal.value = 'sale';
});

afterEach(() => {
  setTerminalIdentity(null);
  setDemoSession(null);
  demoRevokedSignal.value = null;
  backendCapabilitiesSignal.value = undefined;
  backendPortalSignal.value = undefined;
});

describe('TerminalHeader — empresa, sucursal y caja (#193)', () => {
  it('la empresa como título y la caja debajo', () => {
    backendCompanySignal.value = 'Kiosco Pepe';
    render(<TerminalHeader />);
    expect(screen.getByText('Kiosco Pepe')).not.toBeNull();
    expect(screen.getByText('Caja 1 - Central')).not.toBeNull();
  });

  it('sin empresa, la caja es el título', () => {
    render(<TerminalHeader />);
    expect(screen.getByText('Caja 1 - Central')).not.toBeNull();
  });

  it('sin conexión activa ni demo no se muestra', () => {
    setTerminalIdentity(null);
    render(<TerminalHeader />);
    expect(screen.queryByTestId('terminal-header')).toBeNull();
  });

  it('es información pasiva: un click no cambia de pantalla', () => {
    render(<TerminalHeader />);
    fireEvent.click(screen.getByText('Caja 1 - Central'));
    expect(activeScreenSignal.value).toBe('sale');
  });
});

describe('TerminalHeader — terminal en demo (#128, #176)', () => {
  it('sin demo no hay marca ni botón de alta', () => {
    render(<TerminalHeader />);
    expect(screen.queryByText('DEMO')).toBeNull();
    expect(screen.queryByRole('button', { name: /\(\/ALTA\)/ })).toBeNull();
  });

  it('con demo se ven DEMO y el botón; el click lleva al alta', () => {
    vi.mocked(startOnboarding).mockClear();
    setDemoSession(demo);
    render(<TerminalHeader />);

    expect(screen.getByText('DEMO')).not.toBeNull();
    const button = screen.getByRole('button', { name: 'Crear mi comercio (/ALTA)' });
    expect(button.tabIndex).toBe(-1);
    fireEvent.click(button);

    expect(startOnboarding).toHaveBeenCalledTimes(1);
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('con la demo revocada, el botón ofrece una demo nueva en lugar del alta', () => {
    vi.mocked(startNewDemo).mockClear();
    setDemoSession(demo);
    demoRevokedSignal.value = '2026-10-02T10:00:00.000Z';
    render(<TerminalHeader />);

    expect(screen.queryByRole('button', { name: 'Crear mi comercio (/ALTA)' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Empezar una demo nueva (/DEMO_NUEVA)' });
    expect(button.tabIndex).toBe(-1);
    fireEvent.click(button);

    expect(startNewDemo).toHaveBeenCalledTimes(1);
  });
});

describe('TerminalHeader — botón del portal (4.6.0, #179)', () => {
  const offerPortal = () => {
    backendCapabilitiesSignal.value = ['portal'];
    backendPortalSignal.value = { command: 'PANEL', label: 'Panel del backend' };
  };

  it('con la oferta, el botón abre el portal sin cambiar de pantalla', () => {
    vi.mocked(openPortal).mockClear();
    offerPortal();
    render(<TerminalHeader />);

    const button = screen.getByRole('button', { name: 'Panel del backend (/PANEL)' });
    expect(button.tabIndex).toBe(-1);
    fireEvent.click(button);

    expect(openPortal).toHaveBeenCalledWith('Panel del backend');
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('sin la capacidad no hay botón', () => {
    backendPortalSignal.value = { command: 'PANEL', label: 'Panel del backend' };
    render(<TerminalHeader />);

    expect(screen.queryByRole('button', { name: /\(\/PANEL\)/ })).toBeNull();
  });

  it('con demo se ven los dos botones, el del portal primero', () => {
    offerPortal();
    setDemoSession(demo);
    render(<TerminalHeader />);

    const names = screen.getAllByRole('button').map((button) => button.textContent);
    expect(names).toEqual(['Panel del backend (/PANEL)', 'Crear mi comercio (/ALTA)']);
  });

  it('con la demo revocada no hay botón del portal', () => {
    offerPortal();
    setDemoSession(demo);
    demoRevokedSignal.value = '2026-10-04T12:00:00.000Z';
    render(<TerminalHeader />);

    expect(screen.queryByRole('button', { name: /\(\/PANEL\)/ })).toBeNull();
  });
});
