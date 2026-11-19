import type { EventOrigin } from '../domain/event-origin.ts';
import { isLegacyOutboxType, type OutboxEvent, type OutboxEventPayload } from '../domain/outbox.ts';
import { roundAmount } from '../domain/rounding.ts';
import { localDateKey } from '../domain/ticket-number.ts';
import { db } from '../storage/db.ts';
import { isTrainingMode } from '../storage/training-mode.ts';
import { loadSyncConfig } from './config.ts';
import { getAwaitingLots, getCurrentPushLot } from './push-lot.ts';
import { peekDeviceId } from './terminal-identity.ts';

/**
 * Exportar lo pendiente (4.7.0, #230): con la caja vinculada en otro dispositivo, lo que esta
 * terminal no llegó a confirmar con el backend, en un JSON legible para que el comercio (o
 * soporte) lo cargue a mano. A diferencia de `pos.export()` (`terminal-data.ts::exportLocalData`,
 * un volcado opaco de todas las tablas y claves para soporte), es solo lo que falta, con un
 * resumen, y la conexión sin ninguna credencial (nunca la `apiKey` ni el secreto de Sheets).
 *
 * Dos grupos, porque no significan lo mismo para quien lo carga:
 * - `notSent`: los eventos `pending` del outbox, incluidos los del lote congelado (mandado al
 *   menos una vez, sin ack: el backend puede no tenerlos). Con `lotId` si están en ese lote.
 * - `sentUnconfirmed`: los de lotes en espera (el backend dio ack, pero todavía no informó `ok` ni
 *   `issues`): probablemente ya están, pero no está confirmado. Con su `lotId`.
 * Los tipos que el contrato ya no tiene (`cash-session`, `sale-void`) no viajan nunca y no se
 * exportan.
 */

/** El evento sin `type` (va aparte) ni el sobre. */
type PayloadBody<P> = P extends unknown ? Omit<P, 'type'> : never;

export type PendingExportEvent = {
  id: string;
  type: OutboxEvent['type'];
  createdAt: string;
  origin?: EventOrigin;
  /** El lote de push en el que viajó (o viaja), si alguno. */
  lotId?: string;
  payload: PayloadBody<OutboxEventPayload>;
};

export type PendingExportSummary = {
  events: number;
  /** Por tipo: cuántos y, en ventas y cobranzas, la suma de sus totales. */
  byType: Partial<Record<OutboxEvent['type'], { count: number; total?: number }>>;
};

export type PendingExportGroup = { summary: PendingExportSummary; events: PendingExportEvent[] };

export type PendingExport = {
  format: 'pos-pendientes';
  version: 1;
  exportedAt: string;
  deviceId: string | null;
  /** #177: la base abierta era la de entrenamiento (lo de práctica nunca viaja). */
  training: boolean;
  /** Sin credenciales. */
  connection: {
    type?: string;
    baseUrl?: string;
    webAppUrl?: string;
    branch?: string;
    pointOfSale?: string;
  };
  notSent: PendingExportGroup;
  sentUnconfirmed: PendingExportGroup;
};

function toExportEvent(event: OutboxEvent, lotId: string | undefined): PendingExportEvent {
  const { id, type, createdAt, status: _status, origin, ...payload } = event;
  return {
    id,
    type,
    createdAt,
    ...(origin !== undefined ? { origin } : {}),
    ...(lotId !== undefined ? { lotId } : {}),
    payload,
  };
}

/** Pura. */
export function summarizePendingEvents(events: readonly OutboxEvent[]): PendingExportSummary {
  const byType: PendingExportSummary['byType'] = {};
  for (const event of events) {
    const current = byType[event.type] ?? { count: 0 };
    const amount =
      event.type === 'sale'
        ? event.sale.total
        : event.type === 'customer-payment'
          ? event.payment.total
          : undefined;
    byType[event.type] = {
      count: current.count + 1,
      ...(amount !== undefined ? { total: roundAmount((current.total ?? 0) + amount) } : {}),
    };
  }
  return { events: events.length, byType };
}

function group(
  events: OutboxEvent[],
  lotOf: (id: string) => string | undefined,
): PendingExportGroup {
  const sorted = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    summary: summarizePendingEvents(sorted),
    events: sorted.map((event) => toExportEvent(event, lotOf(event.id))),
  };
}

function exportedConnection(): PendingExport['connection'] {
  const config = loadSyncConfig();
  if (!config.ok) {
    return {};
  }
  const value = config.value;
  return {
    type: value.type,
    ...(value.type === 'google-sheets'
      ? { webAppUrl: value.webAppUrl }
      : { baseUrl: value.baseUrl }),
    ...(value.branch !== undefined ? { branch: value.branch } : {}),
    ...(value.pointOfSale !== undefined ? { pointOfSale: value.pointOfSale } : {}),
  };
}

export async function buildPendingExport(
  now: string = new Date().toISOString(),
): Promise<PendingExport> {
  const currentLot = getCurrentPushLot();
  const awaiting = getAwaitingLots();
  const currentIds = new Set(currentLot?.eventIds ?? []);
  const awaitingLotOf = new Map(
    awaiting.flatMap((lot) => (lot.eventIds ?? []).map((id): [string, string] => [id, lot.id])),
  );
  const [pending, awaitingEvents] = await Promise.all([
    db.outbox.where('status').equals('pending').toArray(),
    db.outbox.bulkGet([...awaitingLotOf.keys()]),
  ]);
  const notSent = pending.filter((event) => !isLegacyOutboxType(event.type));
  const sentUnconfirmed = awaitingEvents.filter(
    (event): event is OutboxEvent =>
      event !== undefined && event.status === 'synced' && !isLegacyOutboxType(event.type),
  );
  return {
    format: 'pos-pendientes',
    version: 1,
    exportedAt: now,
    deviceId: peekDeviceId(),
    training: isTrainingMode(),
    connection: exportedConnection(),
    notSent: group(notSent, (id) => (currentIds.has(id) ? currentLot?.id : undefined)),
    sentUnconfirmed: group(sentUnconfirmed, (id) => awaitingLotOf.get(id)),
  };
}

/** `pendientes-<caja>-<fecha local>.json`, con la caja en minúsculas y sin espacios ni tildes. Pura. */
export function pendingExportFileName(pointOfSale: string | undefined, now: string): string {
  const slug = (pointOfSale ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `pendientes-${slug !== '' ? slug : 'caja'}-${localDateKey(now)}.json`;
}

export const PENDING_EXPORT_MIME_TYPE = 'application/json';

export type PendingExportFile = {
  fileName: string;
  mimeType: typeof PENDING_EXPORT_MIME_TYPE;
  /** El JSON indentado, legible a mano. */
  content: string;
  data: PendingExport;
};

/**
 * Todo lo que necesita la UI para bajar el archivo con `<a download>`: el nombre y el contenido
 * (con `new Blob([file.content], { type: file.mimeType })` y `URL.createObjectURL`).
 */
export async function buildPendingExportFile(
  now: string = new Date().toISOString(),
): Promise<PendingExportFile> {
  const data = await buildPendingExport(now);
  return {
    fileName: pendingExportFileName(data.connection.pointOfSale, now),
    mimeType: PENDING_EXPORT_MIME_TYPE,
    content: `${JSON.stringify(data, null, 2)}\n`,
    data,
  };
}
