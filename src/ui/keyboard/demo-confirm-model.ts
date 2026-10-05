import type { Result } from '../../domain/result.ts';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import type { SyncConfig } from '../../sync/config.ts';
import { originKey } from '../../sync/connection.ts';

/** Lo que se pierde al abrir una demo (#176), en textos listos para la pantalla. Ausente = nada. */
export type DemoLoss = {
  pending?: string;
  draft?: string;
  history?: string;
  connection?: string;
};

function plural(count: number, singular: string, pluralForm: string): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).host : url;
}

/**
 * Pura. El catálogo y los clientes no cuentan: vuelven con cualquier pull. `pendingOutbox` incluye
 * las ventas pendientes; el resto son "movimientos" (de stock, de caja, cobranzas, clientes…).
 */
export function describeDemoLoss(summary: LocalDataSummary, config: Result<SyncConfig>): DemoLoss {
  const host = config.ok ? hostOf(originKey(config.value)) : undefined;
  const loss: DemoLoss = {};

  const others = summary.pendingOutbox - summary.pendingSales;
  const pendingParts = [
    ...(summary.pendingSales > 0 ? [plural(summary.pendingSales, 'venta', 'ventas')] : []),
    ...(others > 0
      ? [`${plural(others, 'movimiento', 'movimientos')}${summary.pendingSales > 0 ? ' más' : ''}`]
      : []),
  ];
  if (pendingParts.length > 0) {
    const target = host !== undefined ? `a ${host}` : 'al backend';
    loss.pending = `Sin enviar ${target}: ${pendingParts.join(' y ')}. Se pierden para siempre.`;
  }

  if (summary.draftCartLines > 0) {
    loss.draft = `La venta en curso (${plural(summary.draftCartLines, 'línea', 'líneas')}).`;
  }

  const historyParts = [
    ...(summary.sales > 0 ? [plural(summary.sales, 'venta', 'ventas')] : []),
    ...(summary.customerPayments > 0
      ? [plural(summary.customerPayments, 'cobranza', 'cobranzas')]
      : []),
    ...(summary.cashMovements > 0
      ? [plural(summary.cashMovements, 'movimiento de caja', 'movimientos de caja')]
      : []),
    ...(summary.cashCounts > 0 ? [plural(summary.cashCounts, 'arqueo', 'arqueos')] : []),
  ];
  if (historyParts.length > 0) {
    const where = host ?? 'el backend';
    loss.history = `El historial de esta terminal (${historyParts.join(', ')}): se borra de esta terminal; lo ya enviado queda en ${where}.`;
  }

  const replaced = 'Se reemplaza por la de la demo.';
  if (config.ok) {
    const demo = config.value.demo;
    if (demo !== undefined) {
      loss.connection = `Demo de ${demo.template} en ${host ?? ''}. ${replaced}`;
    } else {
      const parts = [
        `Conexión a ${host ?? ''}`,
        ...(config.value.branch !== undefined ? [`Sucursal ${config.value.branch}`] : []),
        ...(config.value.pointOfSale !== undefined
          ? [`Punto de venta ${config.value.pointOfSale}`]
          : []),
      ];
      loss.connection = `${parts.join(' · ')}. ${replaced}`;
    }
  } else if (config.error !== 'sync/config-missing') {
    loss.connection = `La configuración guardada, que no se puede leer. ${replaced}`;
  }
  return loss;
}
