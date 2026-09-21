import { signal } from '@preact/signals';
import type { Failure } from '../../domain/result.ts';
import type { ConnectionState } from '../../sync/connection-state.ts';
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
