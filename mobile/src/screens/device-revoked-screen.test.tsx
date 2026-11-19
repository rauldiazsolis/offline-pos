import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../src/domain/result.ts';
import {
  buildPendingExportFile,
  type PendingExportFile,
} from '../../../src/sync/pending-export.ts';
import { unlinkTerminal } from '../../../src/sync/unlink-terminal.ts';
import { reloadPage } from '../../../src/ui/device-revoked-browser.ts';
import { deviceRevokedScreenSignal } from '../../../src/ui/state/device-revoked-screen.ts';
import { deviceRevokedSignal } from '../../../src/ui/state/sync.ts';
import { DeviceRevokedScreen } from './device-revoked-screen.tsx';

vi.mock(import('../../../src/sync/pending-export.ts'), () => ({
  buildPendingExportFile: vi.fn(),
}));
vi.mock(import('../../../src/sync/unlink-terminal.ts'), () => ({
  unlinkTerminal: vi.fn(),
}));
vi.mock(import('../../../src/ui/device-revoked-browser.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  reloadPage: vi.fn(),
}));

const FILE: PendingExportFile = {
  fileName: 'pendientes-caja-1-2026-11-19.json',
  mimeType: 'application/json',
  content: '{}\n',
  data: {
    format: 'pos-pendientes',
    version: 1,
    exportedAt: '2026-11-19T12:00:00.000Z',
    deviceId: 'test-device-id',
    training: false,
    connection: {},
    notSent: { summary: { events: 1, byType: { sale: { count: 1, total: 250 } } }, events: [] },
    sentUnconfirmed: { summary: { events: 0, byType: {} }, events: [] },
  },
};

const createObjectURL = vi.fn(() => 'blob:pendientes');
const revokeObjectURL = vi.fn();
const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

function tap(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

beforeEach(() => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  vi.mocked(buildPendingExportFile).mockResolvedValue(FILE);
  vi.mocked(unlinkTerminal).mockResolvedValue(ok(undefined));
  deviceRevokedSignal.value = { at: '2026-11-19T10:05:00.000Z' };
  deviceRevokedScreenSignal.value = { phase: 'idle' };
});

afterEach(() => {
  deviceRevokedSignal.value = undefined;
  deviceRevokedScreenSignal.value = { phase: 'idle' };
  vi.clearAllMocks();
});

describe('DeviceRevokedScreen en celular (4.7.0, #230)', () => {
  it('título, desde cuándo y lo pendiente', async () => {
    render(<DeviceRevokedScreen />);
    expect(
      screen.getByRole('heading', { name: 'Esta caja fue vinculada en otro dispositivo' }),
    ).not.toBeNull();
    expect(screen.getByText(/^Desde .*2026/)).not.toBeNull();
    expect(await screen.findByText(/^Sin enviar: 1 venta por \$/)).not.toBeNull();
  });

  it('exportar baja el archivo y lo dice', async () => {
    render(<DeviceRevokedScreen />);
    await screen.findByText(/^Sin enviar:/);
    tap('Exportar datos locales pendientes (.json)');
    expect(await screen.findByText('Descargado: pendientes-caja-1-2026-11-19.json')).not.toBeNull();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('desvincular pide confirmación; Volver no hace nada; Desvincular recarga', async () => {
    render(<DeviceRevokedScreen />);
    await screen.findByText(/^Sin enviar:/);
    tap('Desvincular esta terminal');
    expect(screen.getByText(/Todavía no exportaste lo pendiente/)).not.toBeNull();
    tap('Volver');
    expect(screen.queryByText(/Se borran los datos locales/)).toBeNull();
    expect(unlinkTerminal).not.toHaveBeenCalled();

    tap('Desvincular esta terminal');
    tap('Desvincular');
    await waitFor(() => {
      expect(reloadPage).toHaveBeenCalledTimes(1);
    });
  });

  it('un error al desvincular se muestra', async () => {
    vi.mocked(unlinkTerminal).mockResolvedValue(err('terminal/unlink-in-training', undefined));
    render(<DeviceRevokedScreen />);
    await screen.findByText(/^Sin enviar:/);
    tap('Desvincular esta terminal');
    tap('Desvincular');
    expect(
      await screen.findByText(/No se pudo desvincular: Salí del entrenamiento/),
    ).not.toBeNull();
    expect(reloadPage).not.toHaveBeenCalled();
  });
});
