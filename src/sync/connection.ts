import { err, type Result } from '../domain/result.ts';
import { hasUserData, type LocalDataSummary } from '../storage/local-data.ts';
import type { SyncConfig } from './config.ts';
import type { Connector } from './connector.ts';
import { createConnector } from './connector-registry.ts';
import { acquireSyncLockWaiting, isSyncLockHeld } from './engine.ts';
import { pullEverything, withTimeout, type ProbeSnapshot } from './pull-snapshot.ts';

// `connection.ts` sigue siendo el punto de entrada de la prueba de conexión.
export { withTimeout, type ProbeSnapshot };

export const PROBE_TIMEOUT_MS = 20_000;
/** Cuánto espera la prueba a que termine un ciclo de sync en curso antes de rendirse. */
export const PROBE_LOCK_WAIT_MS = 30_000;

/** Etapa de la prueba en curso: esperando el cerrojo de sync, o pidiendo la foto. */
export type ProbeStage = 'waiting-lock' | 'pulling';

/**
 * Prueba una conexión candidata (Etapa 2b, #76): el pull completo de
 * productos, stock y clientes, **todo o nada**, en memoria. No toca IndexedDB,
 * ni los cursores, ni la config guardada — recién `applyConnection` lo hace,
 * y solo si esto salió bien. Toma el cerrojo de sync mientras dura. `options.connector` existe para testear sin red.
 */
export async function probeConnection(
  config: SyncConfig,
  options: {
    timeoutMs?: number;
    lockWaitMs?: number;
    connector?: Connector;
    /** Para el spinner del wizard (Etapa 2 de #94): qué se está esperando ahora. */
    onProgress?: (stage: ProbeStage) => void;
  } = {},
): Promise<Result<ProbeSnapshot>> {
  // Toma el cerrojo del motor de sync mientras prueba: nunca en paralelo con un
  // ciclo del conector actual (un backend de a un request por vez, como el puente
  // de Sheets, se traba con dos flujos a la vez) — y, si el usuario cancela y
  // reintenta, la prueba nueva espera a que termine la anterior en vez de apilarse.
  if (isSyncLockHeld()) {
    options.onProgress?.('waiting-lock');
  }
  const release = await acquireSyncLockWaiting(options.lockWaitMs ?? PROBE_LOCK_WAIT_MS);
  if (release === undefined) {
    return err('connection/sync-busy', undefined);
  }
  options.onProgress?.('pulling');
  try {
    const connector = options.connector ?? createConnector(config);
    return await withTimeout(pullEverything(connector), options.timeoutMs ?? PROBE_TIMEOUT_MS);
  } finally {
    release();
  }
}

function normalizeEndpoint(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Identidad del backend: el endpoint normalizado (sin barra final, host en
 * minúsculas). El `type` no forma parte: dos tipos de conector que hablan con
 * el mismo endpoint son el mismo backend. Cambiar la API key, el secreto o el
 * locale no cambia el origen.
 */
export function originKey(config: SyncConfig): string {
  switch (config.type) {
    case 'rest':
    case 'rest-demo':
      return normalizeEndpoint(config.baseUrl);
    case 'google-sheets':
      return normalizeEndpoint(config.webAppUrl);
    default: {
      const exhaustiveCheck: never = config;
      return exhaustiveCheck;
    }
  }
}

export type ConnectionPlan = { wipe: boolean; needsConfirmation: boolean };

/**
 * Decide qué hace falta al aplicar una conexión (función pura):
 * - `wipe`: el origen cambió, o no hay config actual (no se puede saber de
 *   qué origen son los datos, así que se los trata como ajenos).
 * - `needsConfirmation`: hay que borrar **y** hay datos del usuario que se
 *   perderían (ventas, turnos, pendientes de envío, venta en curso). Un
 *   catálogo o clientes solos se reemplazan sin preguntar — nunca se
 *   descartan ventas locales en silencio.
 */
export function planConnectionChange(params: {
  current: SyncConfig | undefined;
  candidate: SyncConfig;
  localData: LocalDataSummary;
}): ConnectionPlan {
  const sameOrigin =
    params.current !== undefined && originKey(params.current) === originKey(params.candidate);
  const wipe = !sameOrigin;
  return { wipe, needsConfirmation: wipe && hasUserData(params.localData) };
}
