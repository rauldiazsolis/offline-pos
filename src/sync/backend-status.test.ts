import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { err, ok, type Failure, type Result } from '../domain/result.ts';
import { fakeConnector } from '../test/fake-connector.ts';
import {
  backendCheckDueSignal,
  backendStatusSignal,
  setBackendCheckDue,
  setBackendStatus,
  syncLogSignal,
} from '../ui/state/sync.ts';
import {
  blocksSync,
  classifyBackendInfo,
  isNetworkFailure,
  noteSyncFailure,
  refreshBackendStatus,
} from './backend-status.ts';

const now = '2026-09-24T12:00:00.000Z';

function failure(result: Result<never>): Failure {
  if (result.ok) throw new Error('esperaba un fallo');
  return result;
}

beforeEach(() => {
  setBackendStatus({ kind: 'unknown' });
  setBackendCheckDue(true);
});

afterEach(() => {
  syncLogSignal.value = [];
});

describe('classifyBackendInfo (#99)', () => {
  it('ok, mantenimiento e incompatible (que gana sobre mantenimiento)', () => {
    expect(classifyBackendInfo({ contractVersion: '4.0.0', status: 'ok' }).kind).toBe('ok');
    expect(classifyBackendInfo({ contractVersion: '4.1.0', status: 'maintenance' }).kind).toBe(
      'maintenance',
    );
    expect(classifyBackendInfo({ contractVersion: '3.0.0', status: 'maintenance' })).toMatchObject({
      kind: 'incompatible',
      backendVersion: '3.0.0',
    });
  });
});

describe('isNetworkFailure', () => {
  it('sin status o timeout es red; con status, remoto o payload inválido no', () => {
    expect(isNetworkFailure(failure(err('sync/request-failed', { message: 'x' })))).toBe(true);
    expect(isNetworkFailure(failure(err('sync/timeout', { seconds: 5 })))).toBe(true);
    expect(
      isNetworkFailure(failure(err('sync/request-failed', { status: 500, message: 'x' }))),
    ).toBe(false);
    expect(isNetworkFailure(failure(err('sync/remote-error', { message: 'x' })))).toBe(false);
    expect(isNetworkFailure(failure(err('sync/invalid-payload', { issues: [] })))).toBe(false);
  });
});

describe('blocksSync', () => {
  it('solo incompatible y mantenimiento bloquean', () => {
    expect(blocksSync({ kind: 'unknown' })).toBe(false);
    expect(blocksSync({ kind: 'incompatible', backendVersion: '3.0.0' })).toBe(true);
  });
});

describe('refreshBackendStatus', () => {
  it('con getInfo ok fija el estado, apaga el chequeo pendiente y lo registra en el log', async () => {
    await refreshBackendStatus(fakeConnector(), now);

    expect(backendStatusSignal.value.kind).toBe('ok');
    expect(backendCheckDueSignal.value).toBe(false);
    expect(syncLogSignal.value[0]?.kind).toBe('info');
  });

  it('un error de red no cambia el estado conocido', async () => {
    setBackendStatus({
      kind: 'maintenance',
      info: { contractVersion: '4.0.0', status: 'maintenance' },
    });
    await refreshBackendStatus(
      fakeConnector({
        getInfo: () => Promise.resolve(err('sync/request-failed', { message: 'x' })),
      }),
      now,
    );

    expect(backendStatusSignal.value.kind).toBe('maintenance');
  });

  it('un contrato incompatible en la respuesta', async () => {
    await refreshBackendStatus(
      fakeConnector({
        getInfo: () =>
          Promise.resolve(err('sync/incompatible-contract', { backend: '3.0.0', pos: '4.0.0' })),
      }),
      now,
    );

    expect(backendStatusSignal.value).toMatchObject({
      kind: 'incompatible',
      backendVersion: '3.0.0',
    });
  });

  it('mantenimiento informado por getInfo', async () => {
    await refreshBackendStatus(
      fakeConnector({
        getInfo: () =>
          Promise.resolve(
            ok({ contractVersion: '4.0.0', status: 'maintenance' as const, message: 'm' }),
          ),
      }),
      now,
    );

    expect(backendStatusSignal.value.kind).toBe('maintenance');
  });
});

describe('noteSyncFailure', () => {
  it('409 incompatible fija el estado; un error remoto agenda un chequeo; uno de red no', () => {
    setBackendCheckDue(false);
    noteSyncFailure(failure(err('sync/request-failed', { message: 'x' })));
    expect(backendCheckDueSignal.value).toBe(false);

    noteSyncFailure(failure(err('sync/remote-error', { message: 'x' })));
    expect(backendCheckDueSignal.value).toBe(true);

    noteSyncFailure(failure(err('sync/incompatible-contract', { backend: '3.0.0', pos: '4.0.0' })));
    expect(backendStatusSignal.value).toMatchObject({
      kind: 'incompatible',
      backendVersion: '3.0.0',
    });
  });
});
