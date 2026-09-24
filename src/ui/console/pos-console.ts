import type { OutboxEvent } from '../../domain/outbox.ts';
import type { Failure, Result } from '../../domain/result.ts';
import { listPendingOutbox } from '../../storage/local-data.ts';
import { originKey } from '../../sync/connection.ts';
import { connectorLabel } from '../../sync/connector-registry.ts';
import { collectDiagnostics, type SyncDiagnostics } from '../../sync/diagnostics.ts';
import { syncNow } from '../../sync/engine.ts';
import { peekDeviceId } from '../../sync/terminal-identity.ts';
import { exportLocalData, resetTerminal, type LocalDataDump } from '../../sync/terminal-data.ts';
import { describeError } from '../errors.ts';
import { formatAwaitingLotStatus, formatLotIssue, formatPullApplication } from '../format-lot.ts';
import type { SyncLogEntry } from '../state/sync.ts';

/**
 * Utilidades de consola (`pos.*` en DevTools, Etapa 0 de #94 / issue #95).
 * Cada método es una capa fina sobre funciones que ya usa la UI — sin lógica
 * propia, así nunca se desfasan de lo que hace la app. Quedan también en
 * producción: abrir DevTools y tipear ya es deliberado, así que ninguno pide
 * confirmación (ni siquiera `reset`).
 */
export type PosConsoleDeps = {
  syncNow: () => Promise<void>;
  collectDiagnostics: () => SyncDiagnostics;
  listPendingOutbox: () => Promise<OutboxEvent[]>;
  exportLocalData: () => Promise<LocalDataDump>;
  resetTerminal: () => Promise<Result<void>>;
  getDeviceId: () => string | null;
  download: (filename: string, content: string) => void;
  reload: () => void;
  console: Pick<Console, 'log' | 'info' | 'error' | 'table'>;
};

/** Lo que muestra `/DIAGNOSTICO`, en texto plano — mismos datos (`collectDiagnostics`), mismas traducciones. */
export type PosStatus = {
  conexion: { tipo: string; origen: string; probada: string | null } | { error: string };
  dispositivo: string;
  cerrojo: 'ocupado' | 'libre';
  red: 'online' | 'offline';
  ultimoPush: {
    lote: string;
    reintento: number;
    proximoIntento: string;
    ultimoError: string | null;
    /** El backend, consultado en un pull, no conoce este lote (#98). */
    noRecibido: string | null;
  } | null;
  ultimoPullOk: string | null;
  /** Cómo se aplicó el último pull exitoso (#98). */
  ultimoPullAplicado: string | null;
  errorDeSync: string | null;
  issuesDelBackend: string[] | null;
  lotesEnEspera: { id: string; enviado: string; estado: string }[];
  log: { hora: string; tipo: SyncLogEntry['kind']; request: unknown; resultado: string }[];
};

export type PosConsole = {
  help: () => void;
  sync: () => Promise<PosStatus>;
  status: () => PosStatus;
  outbox: () => Promise<OutboxEvent[]>;
  export: () => Promise<LocalDataDump>;
  reset: () => Promise<void>;
  deviceId: () => string | null;
};

const HELP: { metodo: string; descripcion: string }[] = [
  { metodo: 'pos.help()', descripcion: 'Esta lista.' },
  {
    metodo: 'pos.sync()',
    descripcion:
      'Lo mismo que /SINCRONIZAR: push ya y pull completo; al terminar muestra pos.status().',
  },
  {
    metodo: 'pos.status()',
    descripcion:
      'Lo que muestra /DIAGNOSTICO: conexión, cerrojo, último push/pull, lotes en espera y log.',
  },
  { metodo: 'pos.outbox()', descripcion: 'Eventos pendientes de enviar al backend.' },
  {
    metodo: 'pos.export()',
    descripcion:
      'Descarga un JSON con todos los datos locales (credenciales ocultas), para soporte.',
  },
  {
    metodo: 'pos.deviceId()',
    descripcion: 'Id de dispositivo de esta terminal (null antes del arranque).',
  },
  {
    metodo: 'pos.reset()',
    descripcion: 'Borra TODO lo local, incluida la config de /CONFIG, y recarga. Sin confirmación.',
  },
];

function describeLogResult(result: SyncLogEntry['result']): string {
  if (result.ok) {
    return 'OK';
  }
  return describeError({ ok: false, error: result.error, meta: result.meta } as Failure);
}

export function formatStatus(diagnostics: SyncDiagnostics): PosStatus {
  const { config, currentLot } = diagnostics;
  return {
    conexion: config.ok
      ? {
          tipo: connectorLabel(config.value.type),
          origen: originKey(config.value),
          probada: config.value.verifiedAt ?? null,
        }
      : { error: describeError(config) },
    dispositivo: diagnostics.deviceId,
    cerrojo: diagnostics.lockHeld ? 'ocupado' : 'libre',
    red: diagnostics.online ? 'online' : 'offline',
    ultimoPush:
      currentLot === undefined
        ? null
        : {
            lote: currentLot.id,
            reintento: currentLot.retries,
            proximoIntento: currentLot.nextAttemptAt,
            ultimoError: currentLot.lastError ?? null,
            noRecibido: currentLot.notReceivedAt ?? null,
          },
    ultimoPullOk: diagnostics.lastSyncedAt,
    ultimoPullAplicado:
      diagnostics.lastPullApplication !== null
        ? formatPullApplication(diagnostics.lastPullApplication)
        : null,
    errorDeSync:
      diagnostics.lastSyncFailure === null ? null : describeError(diagnostics.lastSyncFailure),
    issuesDelBackend: diagnostics.pushLotIssues?.map(formatLotIssue) ?? null,
    lotesEnEspera: diagnostics.awaitingLots.map((lot) => ({
      id: lot.id,
      enviado: lot.sentAt,
      estado: formatAwaitingLotStatus(lot),
    })),
    log: diagnostics.log.map((entry) => ({
      hora: entry.at,
      tipo: entry.kind,
      request: entry.request,
      resultado: describeLogResult(entry.result),
    })),
  };
}

export function createPosConsole(deps: PosConsoleDeps): PosConsole {
  const status = (): PosStatus => {
    const formatted = formatStatus(deps.collectDiagnostics());
    deps.console.log('Estado de sincronización:', formatted);
    return formatted;
  };

  return {
    help: () => {
      deps.console.table(HELP);
    },
    status,
    sync: async () => {
      await deps.syncNow();
      deps.console.info('Sincronización terminada.');
      return status();
    },
    outbox: async () => {
      const events = await deps.listPendingOutbox();
      if (events.length === 0) {
        deps.console.info('No hay eventos pendientes de enviar.');
      } else {
        deps.console.table(
          events.map((event) => ({ id: event.id, tipo: event.type, creado: event.createdAt })),
        );
      }
      return events;
    },
    export: async () => {
      const dump = await deps.exportLocalData();
      const filename = `offline-pos-export-${dump.exportedAt.replace(/[:.]/g, '-')}.json`;
      deps.download(filename, JSON.stringify(dump, null, 2));
      deps.console.info(`Datos locales exportados a ${filename} (credenciales ocultas).`);
      return dump;
    },
    reset: async () => {
      const result = await deps.resetTerminal();
      if (!result.ok) {
        deps.console.error(describeError(result));
        return;
      }
      deps.console.info('Datos locales borrados. Recargando…');
      deps.reload();
    },
    deviceId: () => deps.getDeviceId(),
  };
}

function downloadFile(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

declare global {
  interface Window {
    pos: PosConsole;
  }
}

/**
 * Se instala desde `main.tsx` **antes** de `bootstrap()`: si el arranque
 * falla y queda la pantalla fatal, `pos.export()`/`pos.reset()` siguen
 * disponibles para recuperar la terminal.
 */
export function installPosConsole(): void {
  window.pos = createPosConsole({
    syncNow,
    collectDiagnostics,
    listPendingOutbox,
    exportLocalData: () => exportLocalData(),
    resetTerminal,
    getDeviceId: peekDeviceId,
    download: downloadFile,
    reload: () => {
      window.location.reload();
    },
    console,
  });
}
