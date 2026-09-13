import { signal } from '@preact/signals';

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
