import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from '../../domain/result.ts';
import type { SyncDiagnostics } from '../../sync/diagnostics.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { backendCapabilitiesSignal, backendPortalSignal } from '../state/sync.ts';
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
  company: 'Kiosco Pepe',
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
  demoRevokedAt: null,
  offline: 'ready',
};

vi.mock('../../sync/diagnostics.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  collectDiagnostics: () => diagnostics,
}));

afterEach(() => {
  vi.restoreAllMocks();
  diagnostics.offline = 'ready';
});

describe('DiagnosticoScreen (contrato v3)', () => {
  it('muestra la versión del POS y el almacenamiento de esta carpeta (#148)', () => {
    render(<DiagnosticoScreen />);
    expect(screen.getByText(/POS 0\.1\.0/)).not.toBeNull();
    expect(screen.getByText('offline-pos@/0.1.0/')).not.toBeNull();
  });

  it('muestra si el POS abre sin red, según el service worker (#54)', () => {
    const { unmount } = render(<DiagnosticoScreen />);
    expect(screen.getByText(/sin conexión: lista/)).not.toBeNull();
    unmount();

    diagnostics.offline = 'update-waiting';
    const second = render(<DiagnosticoScreen />);
    expect(screen.getByText(/versión nueva descargada, falta aplicar/)).not.toBeNull();
    second.unmount();

    diagnostics.offline = 'unsupported';
    render(<DiagnosticoScreen />);
    expect(screen.getByText(/sin service worker/)).not.toBeNull();
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

  it('muestra la empresa del backend, o "no informada" (4.5.0, #193)', () => {
    const { unmount } = render(<DiagnosticoScreen />);
    expect(screen.getByText('Empresa: Kiosco Pepe')).not.toBeNull();
    unmount();

    diagnostics.company = undefined;
    try {
      render(<DiagnosticoScreen />);
      expect(screen.getByText('Empresa: no informada')).not.toBeNull();
    } finally {
      diagnostics.company = 'Kiosco Pepe';
    }
  });
});

describe('DiagnosticoScreen — portal (4.6.0, #179)', () => {
  afterEach(() => {
    backendCapabilitiesSignal.value = undefined;
    backendPortalSignal.value = undefined;
  });

  it('muestra el comando y la etiqueta del portal, o "no ofrecido"', () => {
    const { unmount } = render(<DiagnosticoScreen />);
    expect(screen.getByText('Portal: no ofrecido')).not.toBeNull();
    unmount();

    backendCapabilitiesSignal.value = ['portal'];
    backendPortalSignal.value = { command: 'PANEL', label: 'Panel del backend' };
    render(<DiagnosticoScreen />);
    expect(screen.getByText('Portal: /PANEL (Panel del backend)')).not.toBeNull();
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

describe('DiagnosticoScreen — demo (#176)', () => {
  const demoConfig = ok({
    type: 'rest' as const,
    baseUrl: 'http://localhost:4001',
    demo: {
      template: 'kiosco',
      onboarding: { url: 'http://localhost:4001/alta', label: 'Alta' },
      startedAt: '2026-10-02T09:00:00.000Z',
    },
  });

  afterEach(() => {
    diagnostics.config = ok({ type: 'rest', baseUrl: 'http://localhost:4000' });
    diagnostics.demoRevokedAt = null;
  });

  it('con la terminal en demo muestra la plantilla', () => {
    diagnostics.config = demoConfig;
    render(<DiagnosticoScreen />);
    expect(screen.getByText('Demo de kiosco')).not.toBeNull();
  });

  it('con la demo revocada dice desde cuándo', () => {
    diagnostics.config = demoConfig;
    diagnostics.demoRevokedAt = '2026-10-02T10:00:00.000Z';
    render(<DiagnosticoScreen />);
    const when = new Date('2026-10-02T10:00:00.000Z').toLocaleString();
    expect(screen.getByText(`Demo de kiosco · revocada desde ${when}`)).not.toBeNull();
  });
});
