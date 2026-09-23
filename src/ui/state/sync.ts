import { signal } from '@preact/signals';
import type { ErrorCode, Failure } from '../../domain/result.ts';
import type { ConnectionState } from '../../sync/connection-state.ts';
import type { LotIssue } from '../../sync/connector.ts';
import type { ConnectorType } from '../../sync/connector-registry.ts';

/**
 * Estado de sincronización para la barra de estado (ver §7 del doc de
 * diseño). `sync/` nunca importa `@preact/signals` directamente — llama a
 * los setters de acá, mismo patrón que `state/catalog.ts`.
 */
export type SyncStatus = 'offline' | 'online-idle' | 'syncing' | 'sync-error';

export const syncStatusSignal = signal<SyncStatus>('offline');
export const pendingOutboxCountSignal = signal(0);
export const lastSyncedAtSignal = signal<string | null>(null);
export const syncConfiguredSignal = signal(false);

export function setSyncStatus(status: SyncStatus): void {
  syncStatusSignal.value = status;
}

export function setPendingOutboxCount(count: number): void {
  pendingOutboxCountSignal.value = count;
}

export function setLastSyncedAt(isoDate: string): void {
  lastSyncedAtSignal.value = isoDate;
}

export function setSyncConfigured(configured: boolean): void {
  syncConfiguredSignal.value = configured;
}

/** Estado de la conexión (Etapa 2b): `App` bloquea todo salvo `/CONFIG` mientras no sea `active`. */
export const connectionStateSignal = signal<ConnectionState>('unconfigured');

export function setConnectionState(state: ConnectionState): void {
  connectionStateSignal.value = state;
}

/**
 * `true` mientras `/CONFIG` está abierto: `runSyncCycle` no arranca ciclos. Con un
 * conector lento y de a un request por vez (el puente de Sheets), un ciclo del
 * conector actual en paralelo con la prueba del nuevo se pisa con ella (timeouts,
 * "Planilla ocupada") y le cambia el estado a la barra mientras se configura.
 */
export const syncPausedSignal = signal(false);

export function setSyncPaused(paused: boolean): void {
  syncPausedSignal.value = paused;
}

/**
 * Tipo del conector de la config activa (`null` = sin configurar): de acá sale
 * qué comandos extra ofrece la barra (Etapa 2c, #77). Lo fijan `bootstrap` al
 * arrancar y `applyConnection` al cambiar de conexión.
 */
export const activeConnectorTypeSignal = signal<ConnectorType | null>(null);

export function setActiveConnectorType(type: ConnectorType | null): void {
  activeConnectorTypeSignal.value = type;
}

/**
 * Motivo del último fallo de sync (un pull que falló), tal cual — la barra de
 * estado lo traduce con `describeError`: `sync/` no importa `ui/errors.ts`.
 */
export const lastSyncFailureSignal = signal<Failure | null>(null);

export function setLastSyncFailure(failure: Failure | null): void {
  lastSyncFailureSignal.value = failure;
}

/** Lo que hay en la base local (contado, no lo que trajo el último pull — un delta trae solo cambios). */
export type LocalCatalogCounts = { products: number; customers: number };

export const localCatalogCountsSignal = signal<LocalCatalogCounts | null>(null);

export function setLocalCatalogCounts(counts: LocalCatalogCounts | null): void {
  localCatalogCountsSignal.value = counts;
}

/**
 * Issues que el backend reportó sobre un lote de push ya resuelto (#87) —
 * puramente informativo: el POS nunca se autobloquea por esto, solo se lo
 * muestra al humano (ver spec, "el backend nunca rechaza"). `null` = nada
 * que avisar. Se limpia solo cuando un pull posterior no trae issues nuevos.
 */
export const pushLotIssuesSignal = signal<LotIssue[] | null>(null);

export function setPushLotIssues(issues: LotIssue[] | null): void {
  pushLotIssuesSignal.value = issues;
}

/**
 * Historial de los últimos intentos de push/pull, para `/DIAGNOSTICO` — el
 * usuario probó el conector de Sheets contra un despliegue real y se topó
 * con un error sin poder ver el detalle (la Console del navegador no
 * mostraba nada). `request`/`result` son literalmente lo que `sync/engine.ts`
 * ya tiene en la mano en el punto donde llama a `connector.pushBatch`/
 * `pullBatch` — sin resumir nada, para poder correlacionar con la pestaña
 * Network. Tope de 20, más nuevo primero, sin persistencia (se pierde al
 * refrescar — no hace falta más para debuguear una sesión en curso).
 */
export type SyncLogEntry = {
  at: string;
  kind: 'push' | 'pull';
  request: unknown;
  result: { ok: true } | { ok: false; error: ErrorCode; meta: unknown };
};

const SYNC_LOG_MAX_ENTRIES = 20;

export const syncLogSignal = signal<SyncLogEntry[]>([]);

export function appendSyncLogEntry(entry: SyncLogEntry): void {
  syncLogSignal.value = [entry, ...syncLogSignal.value].slice(0, SYNC_LOG_MAX_ENTRIES);
}
