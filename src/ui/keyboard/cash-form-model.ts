import { roundAmount } from '../../domain/rounding.ts';
import { localDateKey, shiftDateKey } from '../../domain/ticket-number.ts';
import { formatMoney, formatTime } from '../format.ts';

/**
 * Reglas del modal de `/CAJA` (spec de #100, §4), puras — sin DOM ni async, mismo criterio que
 * `config-wizard-model.ts`. `cash-controller.ts` orquesta lo async y `cash-screen.tsx` dibuja.
 */
export type CashKind = 'count' | 'in' | 'out';

export const CASH_KINDS: readonly CashKind[] = ['count', 'in', 'out'];

export const CASH_KIND_LABELS: Record<CashKind, string> = {
  count: 'Arqueo',
  in: 'Ingreso',
  out: 'Egreso',
};

export type CashField = 'counted' | 'concept' | 'description' | 'amount';

const FIELDS: Record<CashKind, readonly CashField[]> = {
  count: ['counted'],
  in: ['concept', 'description', 'amount'],
  out: ['concept', 'description', 'amount'],
};

export function fieldsFor(kind: CashKind): readonly CashField[] {
  return FIELDS[kind];
}

/** El campo siguiente o anterior, sin ciclar (mismo patrón que Cobro). */
export function moveCashField(
  kind: CashKind,
  from: CashField,
  direction: 1 | -1,
): CashField | undefined {
  const fields = FIELDS[kind];
  const index = fields.indexOf(from);
  return index === -1 ? undefined : fields[index + direction];
}

export type CountDifference = { kind: 'over' | 'short' | 'even'; amount: number };

export function countDifference(
  expected: number,
  counted: number | undefined,
): CountDifference | undefined {
  if (counted === undefined) {
    return undefined;
  }
  const difference = roundAmount(counted - expected);
  if (difference === 0) {
    return { kind: 'even', amount: 0 };
  }
  return { kind: difference > 0 ? 'over' : 'short', amount: Math.abs(difference) };
}

/** Un egreso mayor que el saldo esperado se advierte, nunca se bloquea. */
export function exceedsBalance(
  kind: CashKind,
  amount: number | undefined,
  balance: number,
): boolean {
  return kind === 'out' && amount !== undefined && amount > balance;
}

export function formatCashAmount(amount: number): string {
  return `$${formatMoney(amount)}`;
}

export function describeDifference(difference: CountDifference): string {
  switch (difference.kind) {
    case 'over':
      return `Sobran ${formatCashAmount(difference.amount)}`;
    case 'short':
      return `Faltan ${formatCashAmount(difference.amount)}`;
    case 'even':
      return 'Sin diferencia';
  }
}

/** Aviso que queda en la barra de comandos al registrar un arqueo. */
export function countNotice(difference: CountDifference): string {
  const detail = describeDifference(difference);
  return `Arqueo registrado: ${detail.charAt(0).toLocaleLowerCase()}${detail.slice(1)}`;
}

export const MOVEMENT_NOTICE: Record<'in' | 'out', string> = {
  in: 'Ingreso registrado',
  out: 'Egreso registrado',
};

/**
 * "Último arqueo: hoy 09:12" / "ayer 18:40" / "23/09 18:40", en hora local. La fecha corta sale de
 * la clave local, no de `formatDate` (que usa UTC a propósito).
 */
export function describeLastCount(lastCountAt: string | undefined, now: string): string {
  if (lastCountAt === undefined) {
    return 'Sin arqueo previo · esperado desde el inicio de la terminal';
  }
  const day = localDateKey(lastCountAt);
  const today = localDateKey(now);
  const label =
    day === today
      ? 'hoy'
      : day === shiftDateKey(today, -1)
        ? 'ayer'
        : `${day.slice(8, 10)}/${day.slice(5, 7)}`;
  return `Último arqueo: ${label} ${formatTime(lastCountAt)}`;
}
