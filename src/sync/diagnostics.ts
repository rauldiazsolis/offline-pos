import type { PushLot } from '../domain/push-lot.ts';
import type { Failure, Result } from '../domain/result.ts';
import { STORAGE_NAMESPACE } from '../storage/storage-namespace.ts';
import {
  backendCapabilitiesSignal,
  backendCompanySignal,
  backendNoticesSignal,
  backendStatusSignal,
  demoRevokedSignal,
  lastPullApplicationSignal,
  lastSyncFailureSignal,
  lastSyncedAtSignal,
  pushLotIssuesSignal,
  syncLogSignal,
  type BackendStatus,
  type SyncLogEntry,
} from '../ui/state/sync.ts';
import { appUpdateSignal, serviceWorkerStateSignal } from '../ui/state/app-update.ts';
import { getLastCleanup, type CleanupRecord } from './cleanup-schedule.ts';
import { loadSyncConfig, type SyncConfig } from './config.ts';
import type { BackendNotice, LotIssue } from './connector.ts';
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
  /** Estado del backend según su último `getInfo` (4.0.0, #99). */
  backendStatus: BackendStatus;
  /** Capacidades del último `getInfo` exitoso (4.4.0, #128); `undefined` = nunca se supo. */
  capabilities: readonly string[] | undefined;
  /** Empresa del último `getInfo` exitoso (4.5.0, #193); `undefined` = no informada. */
  company: string | undefined;
  /** Avisos vigentes del backend según el último pull aplicado (4.4.0, #128). */
  notices: readonly BackendNotice[];
  /** Id de dispositivo de esta terminal (contrato v3, #96). */
  deviceId: string;
  log: SyncLogEntry[];
  /** Última limpieza de datos locales (#98); ausente si todavía no corrió. */
  lastCleanup: CleanupRecord | undefined;
  /** Versión del POS (`package.json`, #148). */
  posVersion: string;
  /** Nombre del almacenamiento local de esta carpeta (#148, `storage/storage-namespace.ts`). */
  storageNamespace: string;
  /** Desde cuándo la demo está revocada (#176); `null` = no lo está. */
  demoRevokedAt: string | null;
  /** Si el POS abre sin red: el estado del service worker (#54). */
  offline: OfflineStatus;
};

/** Si el POS abre sin red (#54), para `/DIAGNOSTICO` y `pos.status()`. */
export type OfflineStatus = 'ready' | 'installing' | 'update-waiting' | 'unsupported';

export function describeOffline(status: OfflineStatus): string {
  switch (status) {
    case 'ready':
      return 'sin conexión: lista';
    case 'installing':
      return 'preparando el modo sin conexión';
    case 'update-waiting':
      return 'versión nueva descargada, falta aplicar';
    case 'unsupported':
      return 'sin service worker';
  }
}

function currentOfflineStatus(): OfflineStatus {
  return appUpdateSignal.value !== 'none' ? 'update-waiting' : serviceWorkerStateSignal.value;
}

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
    backendStatus: backendStatusSignal.value,
    capabilities: backendCapabilitiesSignal.value,
    company: backendCompanySignal.value,
    notices: backendNoticesSignal.value,
    deviceId: getDeviceId(),
    log: syncLogSignal.value,
    lastCleanup: getLastCleanup(),
    posVersion: __POS_VERSION__,
    storageNamespace: STORAGE_NAMESPACE,
    demoRevokedAt: demoRevokedSignal.value,
    offline: currentOfflineStatus(),
  };
}
