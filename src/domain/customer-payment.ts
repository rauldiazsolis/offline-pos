import { err, ok, type Result } from './result.ts';
import { roundAmount } from './rounding.ts';
import type { Payment, PaymentMethod } from './sale.ts';
import type { DailyNumber } from './ticket-number.ts';

/**
 * Cobranza sin venta (contrato v3, #96 — la genera la Etapa 6): un pago a
 * favor de un cliente identificado, tenga o no cuenta corriente. Sin vuelto:
 * lo tendido es lo acreditado. No se anula (RNF-07).
 */
export type CustomerPayment = {
  id: string; // ULID
  customerId: string;
  payments: Payment[];
  total: number;
  createdAt: string; // ISO 8601
  /** Número de recibo del día local (#101). Una cobranza anterior no tiene y nunca se le inventa. */
  receipt?: DailyNumber;
};

export function buildCustomerPayment(params: {
  id: string;
  customerId: string;
  payments: Payment[];
  now: string;
}): Result<CustomerPayment> {
  if (params.payments.length === 0) {
    return err('customer-payment/invalid', { reason: 'empty' });
  }
  if (params.payments.some((payment) => payment.method === 'account')) {
    return err('customer-payment/invalid', { reason: 'account-method' });
  }
  if (params.payments.some((payment) => payment.amount <= 0)) {
    return err('customer-payment/invalid', { reason: 'non-positive-amount' });
  }
  const total = roundAmount(params.payments.reduce((sum, payment) => sum + payment.amount, 0));
  return ok({
    id: params.id,
    customerId: params.customerId,
    payments: params.payments,
    total,
    createdAt: params.now,
  });
}

/** Los medios de una cobranza (#101): todos menos cuenta corriente, en el orden de Cobro. */
export type CollectionMethod = Exclude<PaymentMethod, 'account'>;
export const COLLECTION_METHODS: readonly CollectionMethod[] = [
  'cash',
  'debit',
  'credit',
  'transfer',
  'qr',
];

/**
 * De lo tipeado por medio a los pagos de una cobranza (spec de #101, §2): sin vuelto (lo tendido es
 * lo acreditado) y sin tope (pagar de más deja saldo a favor); la suma tiene que ser mayor que 0.
 * Vive acá y no en `tender.ts` porque su regla es otra que la del cobro de una venta.
 */
export function resolveCollection(tendered: Record<CollectionMethod, number>): Result<Payment[]> {
  const payments: Payment[] = [];
  for (const method of COLLECTION_METHODS) {
    const amount = roundAmount(tendered[method]);
    if (amount > 0) {
      payments.push({ method, amount });
    }
  }
  return payments.length === 0
    ? err('customer-payment/invalid', { reason: 'empty' })
    : ok(payments);
}
