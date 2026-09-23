import { err, ok, type Result } from './result.ts';
import type { Payment } from './sale.ts';

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
  const total =
    Math.round(params.payments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;
  return ok({
    id: params.id,
    customerId: params.customerId,
    payments: params.payments,
    total,
    createdAt: params.now,
  });
}
