import { roundAmount } from './rounding.ts';

/**
 * Ingreso/egreso de caja (contrato v3, #96 — lo genera la Etapa 5). El arqueo
 * viaja solo como ajuste (`source: 'count-adjustment'`) cuando la diferencia
 * no es 0, con lo esperado y lo contado para auditoría. No se anula: un
 * movimiento mal cargado se compensa con otro (RNF-07).
 */
export type CashMovement = {
  id: string; // ULID
  direction: 'in' | 'out';
  amount: number; // > 0
  concept: string;
  description?: string;
  source: 'manual' | 'count-adjustment';
  count?: { expected: number; counted: number };
  createdAt: string; // ISO 8601
};

export const COUNT_ADJUSTMENT_CONCEPT = 'Ajuste por arqueo';

/** `undefined` si lo contado coincide con lo esperado: un arqueo sin diferencia no viaja. */
export function buildCountAdjustment(params: {
  id: string;
  expected: number;
  counted: number;
  now: string;
}): CashMovement | undefined {
  const difference = roundAmount(params.counted - params.expected);
  if (difference === 0) {
    return undefined;
  }
  return {
    id: params.id,
    direction: difference > 0 ? 'in' : 'out',
    amount: Math.abs(difference),
    concept: COUNT_ADJUSTMENT_CONCEPT,
    source: 'count-adjustment',
    count: { expected: params.expected, counted: params.counted },
    createdAt: params.now,
  };
}
