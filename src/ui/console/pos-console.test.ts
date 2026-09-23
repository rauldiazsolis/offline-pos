import { describe, expect, it, vi } from 'vitest';
import type { OutboxEvent } from '../../domain/outbox.ts';
import { err, ok } from '../../domain/result.ts';
import type { SyncDiagnostics } from '../../sync/diagnostics.ts';
import type { LocalDataDump } from '../../sync/terminal-data.ts';
import { createPosConsole, type PosConsoleDeps } from './pos-console.ts';

const diagnostics: SyncDiagnostics = {
  config: ok({
    type: 'rest',
    baseUrl: 'http://localhost:3001',
    apiKey: 'secreta',
    verifiedAt: '2026-09-23T10:00:00.000Z',
  }),
  lockHeld: false,
  online: true,
  currentLot: undefined,
  awaitingLots: [{ id: 'LOT1', sentAt: '2026-09-23T11:00:00.000Z' }],
  lastSyncedAt: '2026-09-23T11:05:00.000Z',
  lastSyncFailure: null,
  pushLotIssues: null,
  log: [
    { at: '2026-09-23T11:05:00.000Z', kind: 'pull', request: { full: true }, result: { ok: true } },
    {
      at: '2026-09-23T11:00:00.000Z',
      kind: 'push',
      request: {},
      result: { ok: false, error: 'sync/timeout', meta: { seconds: 30 } },
    },
  ],
};

const pendingEvent: OutboxEvent = {
  type: 'account-hold-release',
  holdId: 'H1',
  id: 'E1',
  status: 'pending',
  createdAt: '2026-09-23T09:00:00.000Z',
};

function fakeDeps(overrides: Partial<PosConsoleDeps> = {}): PosConsoleDeps {
  return {
    syncNow: vi.fn(() => Promise.resolve()),
    collectDiagnostics: () => diagnostics,
    listPendingOutbox: () => Promise.resolve([pendingEvent]),
    exportLocalData: () =>
      Promise.resolve<LocalDataDump>({
        exportedAt: '2026-09-23T12:00:00.000Z',
        indexedDb: {},
        localStorage: {},
      }),
    resetTerminal: () => Promise.resolve(ok(undefined)),
    download: vi.fn(),
    reload: vi.fn(),
    console: { log: vi.fn(), info: vi.fn(), error: vi.fn(), table: vi.fn() },
    ...overrides,
  };
}

describe('pos.help', () => {
  it('lista todos los métodos del objeto', () => {
    const deps = fakeDeps();
    const pos = createPosConsole(deps);

    pos.help();

    const rows = vi.mocked(deps.console.table).mock.calls[0]?.[0] as { metodo: string }[];
    const listed = rows.map((row) => row.metodo);
    expect(listed.sort()).toEqual(
      Object.keys(pos)
        .map((name) => `pos.${name}()`)
        .sort(),
    );
  });
});

describe('pos.status', () => {
  it('traduce lo mismo que /DIAGNOSTICO, sin exponer la API key', () => {
    const pos = createPosConsole(fakeDeps());

    const status = pos.status();

    expect(status.conexion).toEqual({
      tipo: 'REST genérico',
      origen: 'http://localhost:3001',
      probada: '2026-09-23T10:00:00.000Z',
    });
    expect(JSON.stringify(status)).not.toContain('secreta');
    expect(status.cerrojo).toBe('libre');
    expect(status.lotesEnEspera).toEqual([{ id: 'LOT1', enviado: '2026-09-23T11:00:00.000Z' }]);
    expect(status.log.map((entry) => entry.resultado)).toEqual([
      'OK',
      expect.stringContaining('30'),
    ]);
  });

  it('muestra el error de config traducido si no hay conexión', () => {
    const pos = createPosConsole(
      fakeDeps({
        collectDiagnostics: () => ({
          ...diagnostics,
          config: err('sync/config-missing', undefined),
        }),
      }),
    );

    expect(pos.status().conexion).toEqual({
      error: 'No hay conexión configurada todavía. Usá /CONFIG.',
    });
  });
});

describe('pos.sync', () => {
  it('corre el mismo syncNow que /SINCRONIZAR y devuelve el estado', async () => {
    const deps = fakeDeps();
    const pos = createPosConsole(deps);

    const status = await pos.sync();

    expect(deps.syncNow).toHaveBeenCalledOnce();
    expect(status.ultimoPullOk).toBe('2026-09-23T11:05:00.000Z');
  });
});

describe('pos.outbox', () => {
  it('devuelve los eventos pendientes y los muestra en tabla', async () => {
    const deps = fakeDeps();

    const events = await createPosConsole(deps).outbox();

    expect(events).toEqual([pendingEvent]);
    expect(deps.console.table).toHaveBeenCalledWith([
      { id: 'E1', tipo: 'account-hold-release', creado: '2026-09-23T09:00:00.000Z' },
    ]);
  });
});

describe('pos.export', () => {
  it('descarga el volcado como JSON y lo devuelve', async () => {
    const deps = fakeDeps();

    const dump = await createPosConsole(deps).export();

    expect(deps.download).toHaveBeenCalledWith(
      'offline-pos-export-2026-09-23T12-00-00-000Z.json',
      JSON.stringify(dump, null, 2),
    );
  });
});

describe('pos.reset', () => {
  it('recarga si el borrado sale bien', async () => {
    const deps = fakeDeps();

    await createPosConsole(deps).reset();

    expect(deps.reload).toHaveBeenCalledOnce();
  });

  it('no recarga y muestra el error traducido si falla', async () => {
    const deps = fakeDeps({
      resetTerminal: () => Promise.resolve(err('connection/sync-busy', undefined)),
    });

    await createPosConsole(deps).reset();

    expect(deps.reload).not.toHaveBeenCalled();
    expect(deps.console.error).toHaveBeenCalledWith(
      expect.stringContaining('sincronización en curso'),
    );
  });
});
