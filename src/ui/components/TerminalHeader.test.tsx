import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startNewDemo, startOnboarding } from '../keyboard/onboarding-controller.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  backendCompanySignal,
  demoRevokedSignal,
  setDemoSession,
  setTerminalIdentity,
} from '../state/sync.ts';
import { TerminalHeader } from './TerminalHeader.tsx';

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
  setTerminalIdentity({ branch: 'Central', pointOfSale: 'Caja 1' });
  backendCompanySignal.value = undefined;
  activeScreenSignal.value = 'sale';
});

afterEach(() => {
  setTerminalIdentity(null);
  setDemoSession(null);
  demoRevokedSignal.value = null;
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
