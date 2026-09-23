import type { PushLot } from '../domain/push-lot.ts';
import type { Failure, Result } from '../domain/result.ts';
import {
  lastSyncFailureSignal,
  lastSyncedAtSignal,
  pushLotIssuesSignal,
  syncLogSignal,
  type SyncLogEntry,
} from '../ui/state/sync.ts';
import { loadSyncConfig, type SyncConfig } from './config.ts';
import { isSyncLockHeld } from './engine.ts';
import { getAwaitingLots, getCurrentPushLot, type AwaitingLot } from './push-lot.ts';

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
  pushLotIssues: string[] | null;
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
    pushLotIssues: pushLotIssuesSignal.value,
    log: syncLogSignal.value,
  };
}
