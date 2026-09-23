import { render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from '../../domain/result.ts';
import type { SyncDiagnostics } from '../../sync/diagnostics.ts';
import { DiagnosticoScreen } from './diagnostico-screen.tsx';

const diagnostics: SyncDiagnostics = {
  config: ok({ type: 'rest', baseUrl: 'http://localhost:4000' }),
  lockHeld: false,
  online: true,
  currentLot: undefined,
  awaitingLots: [
    { id: 'LOT-A', sentAt: '2026-09-23T11:00:00.000Z', lastStatus: 'processing' },
    { id: 'LOT-B', sentAt: '2026-09-23T11:01:00.000Z', lastStatus: 'queued' },
    { id: 'LOT-C', sentAt: '2026-09-23T11:02:00.000Z' },
  ],
  lastSyncedAt: null,
  lastSyncFailure: null,
  pushLotIssues: [{ message: 'Stock negativo', eventId: 'm1' }],
  deviceId: 'dev-1',
  log: [],
};

vi.mock('../../sync/diagnostics.ts', () => ({ collectDiagnostics: () => diagnostics }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DiagnosticoScreen (contrato v3)', () => {
  it('muestra el dispositivo, el estado de cada lote en espera y los avisos con su evento', () => {
    render(<DiagnosticoScreen />);

    expect(screen.getByText('dev-1')).not.toBeNull();
    expect(screen.getByText(/LOT-A .*procesando/)).not.toBeNull();
    expect(screen.getByText(/LOT-B .*en cola/)).not.toBeNull();
    expect(screen.getByText(/LOT-C .*sin informar/)).not.toBeNull();
    expect(screen.getByText(/Stock negativo \(evento m1\)/)).not.toBeNull();
  });
});
