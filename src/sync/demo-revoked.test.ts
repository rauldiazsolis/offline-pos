import { beforeEach, describe, expect, it } from 'vitest';
import { err, ok, type Failure, type Result } from '../domain/result.ts';
import { storageKey } from '../storage/storage-namespace.ts';
import { demoRevokedSignal } from '../ui/state/sync.ts';
import type { SyncConfig } from './config.ts';
import {
  clearDemoRevoked,
  isDemoRevokedFailure,
  markDemoRevoked,
  restoreDemoRevoked,
} from './demo-revoked.ts';

const DEMO: Result<SyncConfig> = ok({
  type: 'rest',
  baseUrl: 'https://b.x',
  apiKey: 'demo-1',
  demo: {
    template: 'kiosco',
    onboarding: { url: 'https://b.x/alta', label: 'Alta' },
    startedAt: 'x',
  },
});
const REAL: Result<SyncConfig> = ok({ type: 'rest', baseUrl: 'https://erp.x', apiKey: 'k' });

function failure(result: Result<never>): Failure {
  if (result.ok) throw new Error('esperaba un fallo');
  return result;
}

beforeEach(() => {
  localStorage.clear();
  demoRevokedSignal.value = null;
});

describe('isDemoRevokedFailure (#176)', () => {
  it('401 o 403 en demo es la demo revocada', () => {
    const unauthorized = failure(err('sync/request-failed', { status: 401, message: 'x' }));
    const forbidden = failure(err('sync/request-failed', { status: 403, message: 'x' }));
    expect(isDemoRevokedFailure(unauthorized, DEMO)).toBe(true);
    expect(isDemoRevokedFailure(forbidden, DEMO)).toBe(true);
  });

  it('fuera de demo, otro status o un error de red, no', () => {
    const unauthorized = failure(err('sync/request-failed', { status: 401, message: 'x' }));
    expect(isDemoRevokedFailure(unauthorized, REAL)).toBe(false);
    expect(isDemoRevokedFailure(unauthorized, err('sync/config-missing', undefined))).toBe(false);
    expect(
      isDemoRevokedFailure(failure(err('sync/request-failed', { status: 500, message: 'x' })), DEMO),
    ).toBe(false);
    expect(
      isDemoRevokedFailure(failure(err('sync/request-failed', { message: 'x' })), DEMO),
    ).toBe(false);
    expect(isDemoRevokedFailure(failure(err('sync/timeout', { seconds: 5 })), DEMO)).toBe(false);
  });
});

describe('marca de demo revocada', () => {
  it('se guarda, se restaura y se borra', () => {
    markDemoRevoked('2026-10-02T10:00:00.000Z');
    expect(demoRevokedSignal.value).toBe('2026-10-02T10:00:00.000Z');
    demoRevokedSignal.value = null;
    restoreDemoRevoked();
    expect(demoRevokedSignal.value).toBe('2026-10-02T10:00:00.000Z');
    clearDemoRevoked();
    expect(demoRevokedSignal.value).toBeNull();
    expect(localStorage.getItem(storageKey('demo-revoked'))).toBeNull();
  });

  it('un valor mal formado se ignora', () => {
    localStorage.setItem(storageKey('demo-revoked'), '{"nope":1}');
    restoreDemoRevoked();
    expect(demoRevokedSignal.value).toBeNull();
  });
});
