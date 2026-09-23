import type { LotIssue } from '../sync/connector.ts';
import type { AwaitingLot } from '../sync/push-lot.ts';

/**
 * Textos de los lotes de push para `/DIAGNOSTICO` y `pos.status()` — un solo
 * lugar, así la pantalla y la consola nunca muestran cosas distintas.
 */
const LOT_STATUS_LABEL = { queued: 'en cola', processing: 'procesando' } as const;

/** Último estado en curso informado por el backend (contrato v3, #96); sin informar todavía, lo dice. */
export function formatAwaitingLotStatus(lot: AwaitingLot): string {
  return lot.lastStatus !== undefined ? LOT_STATUS_LABEL[lot.lastStatus] : 'sin informar';
}

/** Un aviso del backend sobre un lote, con el evento al que se refiere si lo informó. */
export function formatLotIssue(issue: LotIssue): string {
  return issue.eventId !== undefined ? `${issue.message} (evento ${issue.eventId})` : issue.message;
}
