import { isCompatibleContract, POS_CONTRACT_VERSION } from '../domain/contract-version.ts';
import type { Failure } from '../domain/result.ts';
import {
  backendCheckDueSignal,
  backendStatusSignal,
  setBackendCheckDue,
  setBackendStatus,
  type BackendStatus,
} from '../ui/state/sync.ts';
import type { BackendInfo, Connector } from './connector.ts';
import { logSyncAttempt } from './sync-log.ts';

/**
 * Estado del backend según su `GET /info` (contrato 4.0.0, #99). Pura. Un
 * contrato incompatible gana sobre el mantenimiento: aunque vuelva a `ok`, el
 * POS no puede hablarle.
 */
export function classifyBackendInfo(info: BackendInfo): BackendStatus {
  if (!isCompatibleContract(info.contractVersion)) {
    return { kind: 'incompatible', backendVersion: info.contractVersion, info };
  }
  if (info.status === 'maintenance') {
    return { kind: 'maintenance', info };
  }
  return { kind: 'ok', info };
}

/** Un fallo de red (sin status HTTP, o timeout): no dice nada del backend en sí. Pura. */
export function isNetworkFailure(failure: Failure): boolean {
  return (
    (failure.error === 'sync/request-failed' && failure.meta.status === undefined) ||
    failure.error === 'sync/timeout'
  );
}

/** Con el backend incompatible o en mantenimiento no corre ningún push ni pull (la venta sigue). */
export function blocksSync(status: BackendStatus): boolean {
  return status.kind === 'incompatible' || status.kind === 'maintenance';
}

/**
 * Pregunta `getInfo` y actualiza el estado. Un error de red no cambia el
 * estado conocido (con `unknown`, los ciclos siguen corriendo como siempre).
 */
export async function refreshBackendStatus(
  connector: Connector,
  now: string,
): Promise<BackendStatus> {
  const result = await connector.getInfo();
  logSyncAttempt('info', now, { contractVersion: POS_CONTRACT_VERSION }, result);
  if (result.ok) {
    const status = classifyBackendInfo(result.value);
    setBackendStatus(status);
    setBackendCheckDue(false);
    return status;
  }
  noteSyncFailure(result);
  return backendStatusSignal.value;
}

/**
 * Después de un fallo de sync: un `409 incompatible-contract` fija el estado
 * ya; cualquier otro fallo que no sea de red agenda un `getInfo` antes del
 * próximo ciclo (puede ser que el backend haya entrado en mantenimiento).
 */
export function noteSyncFailure(failure: Failure): void {
  if (failure.error === 'sync/incompatible-contract') {
    setBackendStatus({ kind: 'incompatible', backendVersion: failure.meta.backend });
    return;
  }
  if (!isNetworkFailure(failure)) {
    setBackendCheckDue(true);
  }
}

/** ¿Hay que preguntar `getInfo` antes de sincronizar? Al arrancar, tras un fallo, o bloqueado. */
export function backendCheckNeeded(): boolean {
  return backendCheckDueSignal.value || blocksSync(backendStatusSignal.value);
}
