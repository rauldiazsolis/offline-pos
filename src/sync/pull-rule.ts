import type { PushLot } from '../domain/push-lot.ts';
import type { BatchLotStatus, LotIssue } from './connector.ts';
import type { AwaitingLot } from './push-lot.ts';

/** Cómo se aplicó un pull exitoso (Etapa 3 de #94, #98) — para la barra de estado y `/DIAGNOSTICO`. */
export type PullApplication =
  | { kind: 'applied' }
  | { kind: 'reapplied'; events: number }
  | { kind: 'retained'; lotIds: string[] };

export type LotClassification = {
  /** Lotes `ok`/`issues`: salen de la lista de espera. */
  resolvedIds: Set<string>;
  /** Último estado en curso informado, para guardarlo en la lista de espera. */
  inProgress: Record<string, 'queued' | 'processing'>;
  issues: LotIssue[];
  /** El lote en curso vino informado: el backend lo recibió aunque el ack se perdió. */
  recoveredLot: AwaitingLot | undefined;
  /** Había lote en curso y el backend no lo conoce: nunca llegó. */
  currentLotNotReceived: boolean;
  /** Lotes por los que se retienen stock y saldo (`processing`, con ack no informado, o `queued` sin `eventIds`). */
  retainingLotIds: string[];
  /** Eventos de lotes `queued` a reaplicar; los pendientes del outbox se leen aparte. */
  queuedEventIds: string[];
};

/**
 * Regla del pull (spec de #98, §1). Pura: el motor aplica lo que decide acá.
 * El lote en curso viaja en `pendingLotIds`; si el backend lo informa se lo
 * trata como un lote en espera más (ack recuperado), si no, como no recibido.
 */
export function classifyLots(params: {
  awaiting: readonly AwaitingLot[];
  currentLot: PushLot | undefined;
  reported: Readonly<Record<string, BatchLotStatus>>;
}): LotClassification {
  const { currentLot, reported } = params;
  const recoveredLot: AwaitingLot | undefined =
    currentLot !== undefined && reported[currentLot.id] !== undefined
      ? { id: currentLot.id, sentAt: currentLot.createdAt, eventIds: currentLot.eventIds }
      : undefined;

  const result: LotClassification = {
    resolvedIds: new Set(),
    inProgress: {},
    issues: [],
    recoveredLot,
    currentLotNotReceived: currentLot !== undefined && recoveredLot === undefined,
    retainingLotIds: [],
    queuedEventIds: [],
  };

  const lots = recoveredLot !== undefined ? [...params.awaiting, recoveredLot] : params.awaiting;
  for (const lot of lots) {
    const status = reported[lot.id];
    if (status === undefined) {
      // Contrato v3: un lote con ack que el backend no informa cuenta como `processing`.
      result.retainingLotIds.push(lot.id);
      continue;
    }
    switch (status.status) {
      case 'queued':
        result.inProgress[lot.id] = 'queued';
        if (lot.eventIds === undefined) {
          result.retainingLotIds.push(lot.id);
        } else {
          result.queuedEventIds.push(...lot.eventIds);
        }
        break;
      case 'processing':
        result.inProgress[lot.id] = 'processing';
        result.retainingLotIds.push(lot.id);
        break;
      case 'ok':
        result.resolvedIds.add(lot.id);
        break;
      case 'issues':
        result.resolvedIds.add(lot.id);
        result.issues.push(...status.issues);
        break;
    }
  }
  return result;
}
