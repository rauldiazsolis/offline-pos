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
