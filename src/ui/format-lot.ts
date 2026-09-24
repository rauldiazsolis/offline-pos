import type { LotIssue } from '../sync/connector.ts';
import type { PullApplication } from '../sync/pull-rule.ts';
import type { AwaitingLot } from '../sync/push-lot.ts';

/**
 * Textos de los lotes de push para `/DIAGNOSTICO` y `pos.status()` — un solo
 * lugar, así la pantalla y la consola nunca muestran cosas distintas.
 */
const LOT_STATUS_LABEL = { queued: 'en cola', processing: 'procesando' } as const;

function eventCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'evento' : 'eventos'}`;
}

/**
 * Último estado en curso informado por el backend (contrato v3, #96); sin informar todavía, lo
 * dice. Con la cantidad de eventos del lote si se conoce (#98).
 */
export function formatAwaitingLotStatus(lot: AwaitingLot): string {
  const status = lot.lastStatus !== undefined ? LOT_STATUS_LABEL[lot.lastStatus] : 'sin informar';
  return lot.eventIds !== undefined ? `${status} · ${eventCount(lot.eventIds.length)}` : status;
}

/** Cómo se aplicó el último pull exitoso (#98) — `/DIAGNOSTICO` y `pos.status()`. */
export function formatPullApplication(application: PullApplication): string {
  switch (application.kind) {
    case 'applied':
      return 'Aplicado completo';
    case 'reapplied':
      return `Aplicado + ${eventCount(application.events)} reaplicados (lotes en cola y pendientes)`;
    case 'retained':
      return `Stock y saldos retenidos: lote ${application.lotIds.join(', ')} procesando — cursor de clientes retenido`;
  }
}

/** Un aviso del backend sobre un lote, con el evento al que se refiere si lo informó. */
export function formatLotIssue(issue: LotIssue): string {
  return issue.eventId !== undefined ? `${issue.message} (evento ${issue.eventId})` : issue.message;
}
