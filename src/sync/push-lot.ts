import type { PushLot } from '../domain/push-lot.ts';

/**
 * Persistencia del lote de push en curso y de los lotes ya enviados que
 * todavía no confirmaron `ok`/`issues` (#87) — estado operativo interno del
 * motor, mismo criterio best-effort que `sync/cursor.ts`: si `localStorage`
 * falla (modo privado, cuota llena) o se pierde, el peor caso es reenviar un
 * lote con un id nuevo — el backend "se arregla como puede" (ver spec), no
 * es un error de negocio que valga la pena modelar con Result.
 */
const CURRENT_LOT_KEY = 'offline-pos:sync:push-lot';
const AWAITING_LOTS_KEY = 'offline-pos:sync:push-lot-awaiting';

/** Tope defensivo: si el backend nunca resuelve un lote, no crece sin límite. */
const MAX_AWAITING_LOTS = 20;

export function getCurrentPushLot(): PushLot | undefined {
  try {
    const raw = localStorage.getItem(CURRENT_LOT_KEY);
    return raw === null ? undefined : (JSON.parse(raw) as PushLot);
  } catch {
    return undefined;
  }
}

export function setCurrentPushLot(lot: PushLot): void {
  try {
    localStorage.setItem(CURRENT_LOT_KEY, JSON.stringify(lot));
  } catch {
    /* best-effort, ver comentario de arriba */
  }
}

export function clearCurrentPushLot(): void {
  try {
    localStorage.removeItem(CURRENT_LOT_KEY);
  } catch {
    /* best-effort */
  }
}

export type AwaitingLot = { id: string; sentAt: string };

export function getAwaitingLots(): AwaitingLot[] {
  try {
    const raw = localStorage.getItem(AWAITING_LOTS_KEY);
    return raw === null ? [] : (JSON.parse(raw) as AwaitingLot[]);
  } catch {
    return [];
  }
}

function setAwaitingLots(lots: AwaitingLot[]): void {
  try {
    localStorage.setItem(AWAITING_LOTS_KEY, JSON.stringify(lots.slice(-MAX_AWAITING_LOTS)));
  } catch {
    /* best-effort */
  }
}

/** Se llama justo después de que un lote recibe su ack de push. */
export function addAwaitingLot(lot: AwaitingLot): void {
  setAwaitingLots([...getAwaitingLots(), lot]);
}

/** Saca de la lista los lotes ya resueltos (`ok` o `issues`) — los `pending` (o no informados) se conservan. */
export function resolveAwaitingLots(resolvedIds: Set<string>): void {
  setAwaitingLots(getAwaitingLots().filter((lot) => !resolvedIds.has(lot.id)));
}

/** Usado por `/DEMO_RESET` y al cambiar de conexión (`sync/apply-connection.ts`) — mismo momento que `clearSyncCursors`. */
export function clearPushLotState(): void {
  clearCurrentPushLot();
  setAwaitingLots([]);
}
