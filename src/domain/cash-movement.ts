import { err, ok, type Result } from './result.ts';
import { roundAmount } from './rounding.ts';

/**
 * Ingreso/egreso de caja (contrato v3, #96 — lo genera `/CAJA` desde la Etapa 5, #100). El arqueo
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

/**
 * Ingreso o egreso manual (`/CAJA`, spec de #100, §1). El monto se redondea a 2 decimales y tiene
 * que quedar mayor que 0; el concepto se recorta y no puede quedar vacío; una descripción vacía se
 * omite.
 */
export function buildManualCashMovement(params: {
  id: string;
  direction: 'in' | 'out';
  amount: number;
  concept: string;
  description?: string;
  now: string;
}): Result<CashMovement> {
  const amount = roundAmount(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return err('cash/invalid-amount', { amount: params.amount });
  }
  const concept = params.concept.trim();
  if (concept === '') {
    return err('cash/concept-required', undefined);
  }
  const description = params.description?.trim() ?? '';
  return ok({
    id: params.id,
    direction: params.direction,
    amount,
    concept,
    ...(description !== '' ? { description } : {}),
    source: 'manual',
    createdAt: params.now,
  });
}
