import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from '../../domain/result.ts';
import type { SyncDiagnostics } from '../../sync/diagnostics.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { DiagnosticoScreen } from './diagnostico-screen.tsx';

const diagnostics: SyncDiagnostics = {
  config: ok({ type: 'rest', baseUrl: 'http://localhost:4000' }),
  lockHeld: false,
  online: true,
  currentLot: {
    id: 'LOT-CUR',
    eventIds: ['e1'],
    createdAt: '2026-09-23T10:00:00.000Z',
    retries: 1,
    nextAttemptAt: '2026-09-23T10:01:00.000Z',
    notReceivedAt: '2026-09-23T10:00:30.000Z',
  },
  awaitingLots: [
    { id: 'LOT-A', sentAt: '2026-09-23T11:00:00.000Z', lastStatus: 'processing' },
    {
      id: 'LOT-B',
      sentAt: '2026-09-23T11:01:00.000Z',
      lastStatus: 'queued',
      eventIds: ['e1', 'e2'],
    },
    { id: 'LOT-C', sentAt: '2026-09-23T11:02:00.000Z' },
  ],
  lastSyncedAt: null,
  lastSyncFailure: null,
  lastPullApplication: { kind: 'retained', lotIds: ['LOT-A'] },
  lastCleanup: undefined,
  pushLotIssues: [{ message: 'Stock negativo', eventId: 'm1' }],
  backendStatus: {
    kind: 'ok',
    info: {
      contractVersion: '4.2.0',
      status: 'ok',
      backend: { name: 'offline-pos-demo-backend', version: '4.2.0' },
    },
  },
  capabilities: ['demo-sessions', 'customer-payment-void'],
  notices: [
    { id: 'n1', severity: 'critical', message: 'Cuota vencida' },
    {
      id: 'n2',
      severity: 'warning',
      message: 'Venta con precio raro',
      ref: { type: 'sale', id: 's1' },
    },
  ],
  deviceId: 'dev-1',
  log: [],
  posVersion: '0.1.0',
  storageNamespace: 'offline-pos@/0.1.0/',
};

vi.mock('../../sync/diagnostics.ts', () => ({ collectDiagnostics: () => diagnostics }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DiagnosticoScreen (contrato v3)', () => {
  it('muestra la versión del POS y el almacenamiento de esta carpeta (#148)', () => {
    render(<DiagnosticoScreen />);
    expect(screen.getByText(/POS 0\.1\.0/)).not.toBeNull();
    expect(screen.getByText('offline-pos@/0.1.0/')).not.toBeNull();
  });

  it('muestra el dispositivo, el estado de cada lote en espera y los avisos con su evento', () => {
    render(<DiagnosticoScreen />);

    expect(screen.getByText('dev-1')).not.toBeNull();
    expect(screen.getByText(/LOT-A — enviado .*procesando/)).not.toBeNull();
    expect(screen.getByText(/LOT-B .*en cola/)).not.toBeNull();
    expect(screen.getByText(/LOT-C .*sin informar/)).not.toBeNull();
    expect(screen.getByText(/Stock negativo \(evento m1\)/)).not.toBeNull();
  });

  it('muestra cómo se aplicó el último pull, los eventos de cada lote y el lote en curso no recibido', () => {
    render(<DiagnosticoScreen />);
    expect(screen.getByText(/Stock y saldos retenidos: lote LOT-A procesando/)).not.toBeNull();
    expect(screen.getByText(/LOT-B .*en cola · 2 eventos/)).not.toBeNull();
    expect(screen.getByText(/No recibido por el backend/)).not.toBeNull();
  });

  it('muestra la sección de limpieza', () => {
    render(<DiagnosticoScreen />);
    expect(screen.getByText('Limpieza de datos locales')).not.toBeNull();
    expect(screen.getByText('Todavía no corrió')).not.toBeNull();
  });
});

function leftMouseDown(target: Element): MouseEvent {
  const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('DiagnosticoScreen — mouse (Etapa 2 de #94)', () => {
  it('"Cerrar (Esc)" vuelve a la venta', () => {
    activeScreenSignal.value = 'diagnostico';
    render(<DiagnosticoScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar (Esc)' }));
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('un mousedown sobre el título no le saca el foco a la pantalla', () => {
    render(<DiagnosticoScreen />);
    expect(leftMouseDown(screen.getByText('Diagnóstico de sincronización')).defaultPrevented).toBe(
      true,
    );
  });
});

describe('DiagnosticoScreen — estado del backend (#99)', () => {
  it('muestra el contrato, el estado y el nombre del backend', () => {
    render(<DiagnosticoScreen />);

    expect(screen.getByText('Backend: contrato 4.2.0 · ok')).not.toBeNull();
    expect(screen.getByText('offline-pos-demo-backend 4.2.0')).not.toBeNull();
  });

  it('muestra los avisos del backend con su severidad y su referencia (4.4.0, #128)', () => {
    render(<DiagnosticoScreen />);

    const lines = screen
      .getAllByText((_content, element) => element?.tagName === 'P')
      .map((element) => element.textContent);
    expect(lines).toContain('Crítico · Cuota vencida');
    expect(lines).toContain('Advertencia · Venta con precio raro (sale s1)');
  });

  it('muestra las capacidades del backend (4.4.0, #128)', () => {
    render(<DiagnosticoScreen />);

    expect(screen.getByText('Capacidades: demo-sessions, customer-payment-void')).not.toBeNull();
  });
});

describe('DiagnosticoScreen — backend incompatible resaltado (prueba manual de la Etapa 4)', () => {
  it('la línea del backend va en rojo', () => {
    const original = diagnostics.backendStatus;
    diagnostics.backendStatus = { kind: 'incompatible', backendVersion: '3.0.0' };
    try {
      render(<DiagnosticoScreen />);
      expect(screen.getByText('Backend: contrato 3.0.0 · incompatible').style.color).toBe(
        'var(--color-danger)',
      );
    } finally {
      diagnostics.backendStatus = original;
    }
  });
});

describe('DiagnosticoScreen — mensaje con estado ok (4.4.0, #128)', () => {
  it('un backend ok (o con un estado desconocido tratado como ok) muestra su mensaje', () => {
    const original = diagnostics.backendStatus;
    diagnostics.backendStatus = {
      kind: 'ok',
      info: { contractVersion: '4.5.0', status: 'ok', message: 'Degradado' },
    };
    try {
      render(<DiagnosticoScreen />);
      expect(screen.getByText('Backend: contrato 4.5.0 · ok (Degradado)')).not.toBeNull();
    } finally {
      diagnostics.backendStatus = original;
    }
  });
});
