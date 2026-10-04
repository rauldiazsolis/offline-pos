import type { LocalDataSummary } from '../../storage/local-data.ts';

/**
 * Lo que se descarta al salir del entrenamiento (#177), contado sobre su base: lo que hizo el
 * operador, nunca el catálogo ni los clientes copiados al entrar. Pura.
 */
export type TrainingDiscard = { lines: string[] };

function count(n: number, singular: string, plural: string): string | undefined {
  if (n === 0) {
    return undefined;
  }
  return `${String(n)} ${n === 1 ? singular : plural}`;
}

export function describeTrainingDiscard(
  summary: LocalDataSummary,
  createdCustomers: number,
): TrainingDiscard {
  const lines = [
    count(summary.sales, 'venta', 'ventas'),
    count(summary.customerPayments, 'cobranza', 'cobranzas'),
    count(
      summary.cashMovements + summary.cashCounts,
      'movimiento de caja o arqueo',
      'movimientos de caja y arqueos',
    ),
    summary.draftCartLines > 0 ? 'La venta en curso' : undefined,
    count(createdCustomers, 'cliente creado', 'clientes creados'),
  ].filter((line): line is string => line !== undefined);
  return { lines: lines.length > 0 ? lines : ['No hiciste nada en el entrenamiento.'] };
}

/**
 * Lo real que todavía no se envió, al entrar (#177), como lo cuenta "Abrir una demo": las ventas
 * aparte y el resto como movimientos (una venta deja también su movimiento de stock). Sin nada
 * pendiente, `undefined`. Pura.
 */
export function describeTrainingPending(summary: LocalDataSummary): string | undefined {
  const others = summary.pendingOutbox - summary.pendingSales;
  const parts = [
    count(summary.pendingSales, 'venta', 'ventas'),
    others > 0
      ? `${String(others)} ${others === 1 ? 'movimiento' : 'movimientos'}${summary.pendingSales > 0 ? ' más' : ''}`
      : undefined,
  ].filter((part): part is string => part !== undefined);
  if (parts.length === 0) {
    return undefined;
  }
  return `Sin enviar: ${parts.join(' y ')}. Se intenta mandarlo ahora; si no se puede, sale al terminar el entrenamiento.`;
}
