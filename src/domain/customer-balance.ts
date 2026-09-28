import { roundAmount } from './rounding.ts';

/**
 * Saldo de un cliente (#101), aparte del crédito (`CustomerAccount`): lo informa el backend en el
 * pull para cualquier cliente, tenga o no cuenta corriente, y el POS le suma lo que registra
 * localmente (ventas y devoluciones a cuenta, cobranzas). Positivo: debe. Negativo: a favor.
 * Informativo: nunca bloquea ni habilita nada.
 */
export type CustomerBalance = { customerId: string; balance: number; updatedAt: string };

export type BalanceDescription =
  { kind: 'none' } | { kind: 'owes'; amount: number } | { kind: 'in-favor'; amount: number };

/** 0 y desconocido se muestran igual: "Sin saldo". */
export function describeBalance(balance: number | undefined): BalanceDescription {
  if (balance === undefined || balance === 0) {
    return { kind: 'none' };
  }
  return balance > 0 ? { kind: 'owes', amount: balance } : { kind: 'in-favor', amount: -balance };
}

/** Sin saldo conocido parte de 0: es informativo, no fabrica crédito. */
export function applyBalanceDelta(current: number | undefined, delta: number): number {
  return roundAmount((current ?? 0) + delta);
}
