import { buildAccountMovementForPayment } from '../domain/customer.ts';
import { applyBalanceDelta } from '../domain/customer-balance.ts';
import {
  buildCustomerPayment,
  buildVoidCustomerPayment,
  type CustomerPayment,
} from '../domain/customer-payment.ts';
import type { EventOrigin } from '../domain/event-origin.ts';
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
  return persistCollectionDocument(built.value, { now, origin });
}

/**
 * La transacción de una cobranza o de su anulación (#101, #125): número de recibo del día, el
 * documento, su movimiento de cuenta (`-total`: una cobranza baja el saldo, su anulación lo sube),
 * el saldo del cliente (crea la fila si no existía) y su evento `customer-payment`, armado adentro
 * para que viaje con el número. El contador de `localStorage` se escribe después del commit.
 */
async function persistCollectionDocument(
  built: CustomerPayment,
  params: { now: string; origin: EventOrigin },
): Promise<Result<CollectionRecord>> {
  const { now, origin } = params;
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
          ...built,
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
        const current = await db.customerBalances.get(built.customerId);
        const balanceAfter = applyBalanceDelta(current?.balance, -payment.total);
        await db.customerPayments.add(payment);
        await db.accountMovements.add(
          buildAccountMovementForPayment({
            id: movementId,
            customerId: built.customerId,
            amount: -payment.total,
            paymentId: payment.id,
            now,
          }),
        );
        await db.customerBalances.put({
          customerId: built.customerId,
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

/**
 * Anula una cobranza con otra (#125), espejo de `sale-repository.ts::voidSaleAndPersist`: una
 * cobranza negativa (`buildVoidCustomerPayment`) que consume número de recibo, sube de vuelta el
 * saldo del cliente y viaja como un `customer-payment` más. La original no se toca (RNF-07).
 */
export async function voidCollectionAndPersist(
  paymentId: string,
): Promise<Result<CollectionRecord>> {
  const now = new Date().toISOString();
  const origin = currentEventOrigin();
  const original = await db.customerPayments.get(paymentId);
  if (original === undefined) {
    return err('customer-payment/not-found', { paymentId });
  }
  const isAlreadyVoided =
    (await db.customerPayments.where('voidsPaymentId').equals(paymentId).count()) > 0;
  const built = buildVoidCustomerPayment(original, { id: newId(), now, isAlreadyVoided });
  if (!built.ok) {
    return built;
  }
  return persistCollectionDocument(built.value, { now, origin });
}

/** Ids de las cobranzas de `paymentIds` que tienen una anulación (#125). */
export async function loadVoidedPaymentIds(paymentIds: readonly string[]): Promise<Set<string>> {
  if (paymentIds.length === 0) {
    return new Set();
  }
  const voids = await db.customerPayments
    .where('voidsPaymentId')
    .anyOf([...paymentIds])
    .toArray();
  return new Set(
    voids.flatMap((payment) =>
      payment.voidsPaymentId !== undefined ? [payment.voidsPaymentId] : [],
    ),
  );
}

/** Las cobranzas que anulan las anulaciones de `payments`, por id (#125). */
export async function loadPaymentVoidOriginals(
  payments: readonly CustomerPayment[],
): Promise<Map<string, CustomerPayment>> {
  const ids = [
    ...new Set(
      payments.flatMap((payment) =>
        payment.voidsPaymentId !== undefined ? [payment.voidsPaymentId] : [],
      ),
    ),
  ];
  const originals = await db.customerPayments.bulkGet(ids);
  return new Map(
    originals.flatMap((payment) => (payment !== undefined ? [[payment.id, payment] as const] : [])),
  );
}
