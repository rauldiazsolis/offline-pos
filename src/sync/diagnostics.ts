import type { PushLot } from '../domain/push-lot.ts';
import type { Failure, Result } from '../domain/result.ts';
import {
  lastPullApplicationSignal,
  lastSyncFailureSignal,
  lastSyncedAtSignal,
  pushLotIssuesSignal,
  syncLogSignal,
  type SyncLogEntry,
} from '../ui/state/sync.ts';
import { loadSyncConfig, type SyncConfig } from './config.ts';
import type { LotIssue } from './connector.ts';
import { isSyncLockHeld } from './engine.ts';
import type { PullApplication } from './pull-rule.ts';
import { getAwaitingLots, getCurrentPushLot, type AwaitingLot } from './push-lot.ts';
import { getDeviceId } from './terminal-identity.ts';

/**
 * Todo lo que muestra `/DIAGNOSTICO`, leído en un solo lugar: la pantalla
 * (`ui/screens/diagnostico-screen.tsx`) y `pos.status()` (Etapa 0 de #94,
 * `ui/console/pos-console.ts`) consumen esta misma foto, así nunca muestran
 * cosas distintas. Solo lecturas síncronas — signals y `localStorage`.
 */
export type SyncDiagnostics = {
  config: Result<SyncConfig>;
  lockHeld: boolean;
  online: boolean;
  currentLot: PushLot | undefined;
  awaitingLots: AwaitingLot[];
  lastSyncedAt: string | null;
  lastSyncFailure: Failure | null;
  /** Cómo se aplicó el último pull exitoso (#98). */
  lastPullApplication: PullApplication | null;
  pushLotIssues: LotIssue[] | null;
  /** Id de dispositivo de esta terminal (contrato v3, #96). */
  deviceId: string;
  log: SyncLogEntry[];
};

export function collectDiagnostics(): SyncDiagnostics {
  return {
    config: loadSyncConfig(),
    lockHeld: isSyncLockHeld(),
    online: navigator.onLine,
    currentLot: getCurrentPushLot(),
    awaitingLots: getAwaitingLots(),
    lastSyncedAt: lastSyncedAtSignal.value,
    lastSyncFailure: lastSyncFailureSignal.value,
    lastPullApplication: lastPullApplicationSignal.value,
    pushLotIssues: pushLotIssuesSignal.value,
    deviceId: getDeviceId(),
    log: syncLogSignal.value,
  };
}
