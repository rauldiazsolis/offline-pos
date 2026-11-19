import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../domain/result.ts';
import {
  buildPendingExportFile,
  type PendingExportFile,
  type PendingExportSummary,
} from '../../sync/pending-export.ts';
import { unlinkTerminal } from '../../sync/unlink-terminal.ts';
import { reloadPage } from '../device-revoked-browser.ts';
import { deviceRevokedScreenSignal } from '../state/device-revoked-screen.ts';
import { deviceRevokedSignal } from '../state/sync.ts';
import { DeviceRevokedScreen } from './device-revoked-screen.tsx';

vi.mock(import('../../sync/pending-export.ts'), () => ({
  buildPendingExportFile: vi.fn(),
}));
vi.mock(import('../../sync/unlink-terminal.ts'), () => ({
  unlinkTerminal: vi.fn(),
}));
vi.mock(import('../device-revoked-browser.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  reloadPage: vi.fn(),
}));

const EMPTY: PendingExportSummary = { events: 0, byType: {} };

function fileWith(
  notSent: PendingExportSummary,
  sentUnconfirmed: PendingExportSummary = EMPTY,
): PendingExportFile {
  return {
    fileName: 'pendientes-caja-1-2026-11-19.json',
    mimeType: 'application/json',
    content: '{"format":"pos-pendientes"}\n',
    data: {
      format: 'pos-pendientes',
      version: 1,
      exportedAt: '2026-11-19T12:00:00.000Z',
      deviceId: 'test-device-id',
      training: false,
      connection: {},
      notSent: { summary: notSent, events: [] },
      sentUnconfirmed: { summary: sentUnconfirmed, events: [] },
    },
  };
}

const WITH_PENDING = fileWith(
  {
    events: 4,
    byType: { sale: { count: 2, total: 1500 }, 'customer-payment': { count: 1, total: 300 } },
  },
  { events: 1, byType: { sale: { count: 1, total: 100 } } },
);

const createObjectURL = vi.fn(() => 'blob:pendientes');
const revokeObjectURL = vi.fn();
const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

beforeEach(() => {
  // jsdom no implementa `createObjectURL`.
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  vi.mocked(buildPendingExportFile).mockResolvedValue(WITH_PENDING);
  vi.mocked(unlinkTerminal).mockResolvedValue(ok(undefined));
  deviceRevokedSignal.value = { at: '2026-11-19T10:05:00.000Z' };
  deviceRevokedScreenSignal.value = { phase: 'idle' };
});

afterEach(() => {
  deviceRevokedSignal.value = undefined;
  deviceRevokedScreenSignal.value = { phase: 'idle' };
  vi.clearAllMocks();
});

function container(): HTMLElement {
  return screen.getByTestId('device-revoked-screen');
}

async function renderLoaded(): Promise<void> {
  render(<DeviceRevokedScreen />);
  await screen.findByText(/^Sin enviar:/);
}

describe('DeviceRevokedScreen (4.7.0, #230)', () => {
  it('sin la marca no muestra nada', () => {
    deviceRevokedSignal.value = undefined;
    render(<DeviceRevokedScreen />);
    expect(screen.queryByTestId('device-revoked-screen')).toBeNull();
  });

  it('título, explicación, desde cuándo y los conteos de lo pendiente', async () => {
    await renderLoaded();
    expect(
      screen.getByRole('heading', { name: 'Esta caja fue vinculada en otro dispositivo' }),
    ).not.toBeNull();
    expect(screen.getByText(/ya no puede sincronizar con el backend/)).not.toBeNull();
    expect(screen.getByText(/^Desde .*2026/)).not.toBeNull();
    const pending = screen.getByTestId('device-revoked-pending').textContent;
    expect(pending).toContain('Sin enviar: 2 ventas por $');
    expect(pending).toContain('1 cobranza por $');
    expect(pending).toContain('y 1 movimiento más');
    expect(pending).toContain('Enviado, sin confirmar por el backend: 1 venta por $');
  });

  it('el mensaje del backend reemplaza la explicación', async () => {
    deviceRevokedSignal.value = { at: '2026-11-19T10:05:00.000Z', message: 'La tomó la Caja 2.' };
    await renderLoaded();
    expect(screen.getByText('La tomó la Caja 2.')).not.toBeNull();
    expect(screen.queryByText(/ya no puede sincronizar/)).toBeNull();
  });

  it('sin nada pendiente lo dice', async () => {
    vi.mocked(buildPendingExportFile).mockResolvedValue(fileWith(EMPTY));
    render(<DeviceRevokedScreen />);
    expect(await screen.findByText(/No hay nada pendiente/)).not.toBeNull();
  });

  it('exportar (Enter o el botón) arma el archivo, lo baja y lo dice', async () => {
    await renderLoaded();
    fireEvent.keyDown(container(), { key: 'Enter' });
    expect(await screen.findByText('Descargado: pendientes-caja-1-2026-11-19.json')).not.toBeNull();
    // Una vez al montar (los conteos) y otra al exportar.
    expect(buildPendingExportFile).toHaveBeenCalledTimes(2);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:pendientes');

    fireEvent.click(
      screen.getByRole('button', { name: 'Exportar datos locales pendientes (.json) (Enter)' }),
    );
    await waitFor(() => {
      expect(anchorClick).toHaveBeenCalledTimes(2);
    });
  });

  it('desvincular pide confirmación, remarca lo no exportado y Esc vuelve', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular esta terminal (Alt+D)' }));
    expect(screen.getByText(/Se borran los datos locales de esta terminal/)).not.toBeNull();
    expect(screen.getByText(/Todavía no exportaste lo pendiente/)).not.toBeNull();
    expect(unlinkTerminal).not.toHaveBeenCalled();

    fireEvent.keyDown(container(), { key: 'Escape' });
    expect(screen.queryByText(/Se borran los datos locales/)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Exportar datos locales pendientes (.json) (Enter)' }),
    ).not.toBeNull();

    fireEvent.keyDown(container(), { key: 'd', code: 'KeyD', altKey: true });
    expect(screen.getByText(/Se borran los datos locales/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Volver (Esc)' }));
    expect(screen.queryByText(/Se borran los datos locales/)).toBeNull();
  });

  it('después de exportar, la confirmación no remarca nada', async () => {
    await renderLoaded();
    fireEvent.keyDown(container(), { key: 'Enter' });
    await screen.findByText(/^Descargado:/);
    fireEvent.keyDown(container(), { key: 'd', code: 'KeyD', altKey: true });
    expect(screen.getByText(/Se borran los datos locales/)).not.toBeNull();
    expect(screen.queryByText(/Todavía no exportaste/)).toBeNull();
  });

  it('Enter en la confirmación desvincula y recarga', async () => {
    await renderLoaded();
    fireEvent.keyDown(container(), { key: 'd', code: 'KeyD', altKey: true });
    fireEvent.keyDown(container(), { key: 'Enter' });
    await waitFor(() => {
      expect(reloadPage).toHaveBeenCalledTimes(1);
    });
    expect(unlinkTerminal).toHaveBeenCalledTimes(1);
  });

  it('un error al desvincular se muestra y no recarga', async () => {
    vi.mocked(unlinkTerminal).mockResolvedValue(err('connection/sync-busy', undefined));
    await renderLoaded();
    fireEvent.keyDown(container(), { key: 'd', code: 'KeyD', altKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular (Enter)' }));
    expect(
      await screen.findByText(/No se pudo desvincular: Hay una sincronización en curso/),
    ).not.toBeNull();
    expect(reloadPage).not.toHaveBeenCalled();
    // Sigue en la confirmación: se puede reintentar o volver.
    expect(screen.getByRole('button', { name: 'Desvincular (Enter)' })).not.toBeNull();
  });

  it('Enter sobre un botón enfocado no repite el atajo', async () => {
    await renderLoaded();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Desvincular esta terminal (Alt+D)' }), {
      key: 'Enter',
    });
    expect(buildPendingExportFile).toHaveBeenCalledTimes(1);
  });
});
