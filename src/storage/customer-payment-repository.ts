import { buildAccountMovementForPayment } from '../domain/customer.ts';
import { applyBalanceDelta } from '../domain/customer-balance.ts';
import { buildCustomerPayment, type CustomerPayment } from '../domain/customer-payment.ts';
import { buildOutboxEventForCustomerPayment } from '../domain/outbox.ts';
import { err, ok, type Result } from '../domain/result.ts';
import type { Payment } from '../domain/sale.ts';
import {
  lastDailyNumberOn,
  localDateKey,
  localDayRange,
  nextDailyNumber,
  shiftDateKey,
  type DailyNumber,
} from '../domain/ticket-number.ts';
import { getReceiptCounter, setReceiptCounter } from '../sync/receipt-counter.ts';
import { currentEventOrigin } from '../sync/terminal-identity.ts';
import { db } from './db.ts';
import { newId } from './ids.ts';

export type CollectionRecord = {
  payment: CustomerPayment & { receipt: DailyNumber };
  /** Ausente si el cliente no tenía saldo conocido. */
  balanceBefore?: number;
  balanceAfter: number;
};

/**
 * Registra una cobranza sin venta (spec de #101, §3) en **una** transacción: número de recibo del
 * día, la cobranza, su movimiento de cuenta, el saldo del cliente (crea la fila en 0 si no existía:
 * informativo, no inventa crédito) y su evento `customer-payment` — armado adentro para que viaje
 * con el número. El contador de `localStorage` se escribe después del commit, como el de tickets
 * (`sale-repository.ts::persistSaleDocument`).
 */
export async function collectAndPersist(params: {
  customerId: string;
  payments: Payment[];
}): Promise<Result<CollectionRecord>> {
  const now = new Date().toISOString();
  const origin = currentEventOrigin();
  const built = buildCustomerPayment({
    id: newId(),
    customerId: params.customerId,
    payments: params.payments,
    now,
  });
  if (!built.ok) {
    return built;
  }
  const stored = getReceiptCounter();
  const movementId = newId();

  let record: CollectionRecord;
  try {
    record = await db.transaction(
      'rw',
      [db.customerPayments, db.accountMovements, db.customerBalances, db.outbox],
      async () => {
        const date = localDateKey(now);
        // Un día más ancho a cada lado, como las ventas: manda `receipt.date`, no la hora.
        const nearby = await db.customerPayments
          .where('createdAt')
          .between(
            localDayRange(shiftDateKey(date, -1)).from,
            localDayRange(shiftDateKey(date, 1)).to,
            true,
            false,
          )
          .toArray();
        const payment = {
          ...built.value,
          receipt: {
            date,
            number: nextDailyNumber({
              date,
              stored,
              lastLocal: lastDailyNumberOn(
                nearby.map((item) => item.receipt),
                date,
              ),
            }),
          },
        };
        const current = await db.customerBalances.get(params.customerId);
        const balanceAfter = applyBalanceDelta(current?.balance, -payment.total);
        await db.customerPayments.add(payment);
        await db.accountMovements.add(
          buildAccountMovementForPayment({
            id: movementId,
            customerId: params.customerId,
            amount: -payment.total,
            paymentId: payment.id,
            now,
          }),
        );
        await db.customerBalances.put({
          customerId: params.customerId,
          balance: balanceAfter,
          updatedAt: now,
        });
        await db.outbox.add(buildOutboxEventForCustomerPayment(payment, { now, origin }));
        return {
          payment,
          ...(current !== undefined ? { balanceBefore: current.balance } : {}),
          balanceAfter,
        };
      },
    );
  } catch (error) {
    return err('customer-payment/persist-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  setReceiptCounter({ date: record.payment.receipt.date, last: record.payment.receipt.number });
  return ok(record);
}
