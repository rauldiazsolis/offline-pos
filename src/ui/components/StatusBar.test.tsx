import { fireEvent, render, screen } from '@testing-library/preact';
import { activeScreenSignal } from '../state/screen.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { StatusBar } from './StatusBar.tsx';
import {
  lastPullApplicationSignal,
  lastSyncFailureSignal,
  lastSyncedAtSignal,
  localCatalogCountsSignal,
  pendingOutboxCountSignal,
  syncConfiguredSignal,
  syncStatusSignal,
} from '../state/sync.ts';

beforeEach(() => {
  syncStatusSignal.value = 'offline';
  pendingOutboxCountSignal.value = 0;
  lastSyncedAtSignal.value = null;
  lastSyncFailureSignal.value = null;
  localCatalogCountsSignal.value = null;
  syncConfiguredSignal.value = true;
  lastPullApplicationSignal.value = null;
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
