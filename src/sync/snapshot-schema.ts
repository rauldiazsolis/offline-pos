import { z } from 'zod';
import type { CashMovement } from '../domain/cash-movement.ts';
import type { CustomerPayment } from '../domain/customer-payment.ts';
import type { Payment, Sale, SaleLine } from '../domain/sale.ts';
import type { DailyNumber } from '../domain/ticket-number.ts';

/**
 * Respuesta de `GET /snapshot` (contrato 4.7.0, capacidad `cash-snapshot`, #230): la foto de la
 * caja de la key para que una terminal nueva la retome. Sin turnos: el efectivo se ancla en
 * `cashAnchor` (el último arqueo que conoce el backend) más `cashMovements` desde él.
 *
 * Tolerante (reglas de evolución): campos desconocidos se ignoran; `lastTicket`, `lastReceipt` y
 * `cashAnchor` mal formados cuentan como ausentes; un elemento mal formado de una lista se
 * descarta sin tirar la foto (como los `notices`). Un medio de pago que el POS no conoce descarta
 * su documento: hidratarlo con otro medio inventaría un dato.
 */

const dailyNumberSchema = z.object({
  date: z.iso.date(),
  number: z.number().int().min(1),
});

const discountSchema = z.object({
  type: z.enum(['amount', 'percentage']),
  value: z.number(),
});

const saleLineSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('product'),
    productId: z.string(),
    qty: z.number(),
    unitPrice: z.number(),
    discount: discountSchema.optional(),
  }),
  z.object({
    kind: z.literal('freeform'),
    description: z.string(),
    qty: z.number(),
    unitPrice: z.number(),
    discount: discountSchema.optional(),
  }),
]);

const paymentSchema = z.object({
  method: z.enum(['cash', 'debit', 'credit', 'transfer', 'qr', 'account']),
  amount: z.number(),
  reference: z.string().optional(),
});

const originSchema = z.object({ branch: z.string(), pointOfSale: z.string() });

const snapshotSaleSchema = z.object({
  id: z.string(),
  lines: z.array(saleLineSchema),
  payments: z.array(paymentSchema),
  total: z.number(),
  status: z.literal('closed'),
  createdAt: z.iso.datetime({ offset: true }),
  ticket: dailyNumberSchema.optional(),
  voidsSaleId: z.string().optional(),
  voidReason: z.string().optional(),
  customerId: z.string().optional(),
  origin: originSchema.optional(),
});

const snapshotCustomerPaymentSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  payments: z.array(paymentSchema),
  total: z.number(),
  createdAt: z.iso.datetime({ offset: true }),
  receipt: dailyNumberSchema.optional(),
  voidsPaymentId: z.string().optional(),
  origin: originSchema.optional(),
});

const snapshotCashMovementSchema = z.object({
  id: z.string(),
  direction: z.enum(['in', 'out']),
  amount: z.number().positive(),
  concept: z.string(),
  description: z.string().optional(),
  source: z.enum(['manual', 'count-adjustment']),
  count: z.object({ expected: z.number(), counted: z.number() }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  origin: originSchema.optional(),
});

const cashAnchorSchema = z.object({
  countedAt: z.iso.datetime({ offset: true }),
  amount: z.number(),
});

/** Cada elemento se valida solo: uno mal formado queda `null` y se filtra en `toCashSnapshot`. */
const tolerantList = <T extends z.ZodType>(item: T) => z.array(item.nullable().catch(null));

export const cashSnapshotSchema = z.object({
  generatedAt: z.iso.datetime({ offset: true }).optional().catch(undefined),
  lastTicket: dailyNumberSchema.optional().catch(undefined),
  lastReceipt: dailyNumberSchema.optional().catch(undefined),
  recentSales: tolerantList(snapshotSaleSchema),
  recentCustomerPayments: tolerantList(snapshotCustomerPaymentSchema),
  cashAnchor: cashAnchorSchema.optional().catch(undefined),
  cashMovements: tolerantList(snapshotCashMovementSchema),
});

/** La foto ya validada, en tipos del dominio (sin el `origin`, que no se guarda en lo local). */
export type CashSnapshot = {
  generatedAt?: string;
  lastTicket?: DailyNumber;
  lastReceipt?: DailyNumber;
  recentSales: Sale[];
  recentCustomerPayments: CustomerPayment[];
  cashAnchor?: { countedAt: string; amount: number };
  cashMovements: CashMovement[];
};

type WireSale = z.infer<typeof snapshotSaleSchema>;
type WireCustomerPayment = z.infer<typeof snapshotCustomerPaymentSchema>;
type WireCashMovement = z.infer<typeof snapshotCashMovementSchema>;

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

type WireLine = WireSale['lines'][number];
type WirePayment = WireSale['payments'][number];

function toLine(line: WireLine): SaleLine {
  const discount = line.discount !== undefined ? { discount: line.discount } : {};
  return line.kind === 'product'
    ? {
        kind: 'product',
        productId: line.productId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        ...discount,
      }
    : {
        kind: 'freeform',
        description: line.description,
        qty: line.qty,
        unitPrice: line.unitPrice,
        ...discount,
      };
}

function toPayment(payment: WirePayment): Payment {
  return {
    method: payment.method,
    amount: payment.amount,
    ...(payment.reference !== undefined ? { reference: payment.reference } : {}),
  };
}

function toSale(wire: WireSale): Sale {
  return {
    id: wire.id,
    lines: wire.lines.map(toLine),
    payments: wire.payments.map(toPayment),
    total: wire.total,
    status: wire.status,
    createdAt: wire.createdAt,
    ...(wire.ticket !== undefined ? { ticket: wire.ticket } : {}),
    ...(wire.voidsSaleId !== undefined ? { voidsSaleId: wire.voidsSaleId } : {}),
    ...(wire.voidReason !== undefined ? { voidReason: wire.voidReason } : {}),
    ...(wire.customerId !== undefined ? { customerId: wire.customerId } : {}),
  };
}

function toCustomerPayment(wire: WireCustomerPayment): CustomerPayment {
  return {
    id: wire.id,
    customerId: wire.customerId,
    payments: wire.payments.map(toPayment),
    total: wire.total,
    createdAt: wire.createdAt,
    ...(wire.receipt !== undefined ? { receipt: wire.receipt } : {}),
    ...(wire.voidsPaymentId !== undefined ? { voidsPaymentId: wire.voidsPaymentId } : {}),
  };
}

function toCashMovement(wire: WireCashMovement): CashMovement {
  return {
    id: wire.id,
    direction: wire.direction,
    amount: wire.amount,
    concept: wire.concept,
    source: wire.source,
    createdAt: wire.createdAt,
    ...(wire.description !== undefined ? { description: wire.description } : {}),
    ...(wire.count !== undefined ? { count: wire.count } : {}),
  };
}

export function toCashSnapshot(data: z.infer<typeof cashSnapshotSchema>): CashSnapshot {
  return {
    ...(data.generatedAt !== undefined ? { generatedAt: data.generatedAt } : {}),
    ...(data.lastTicket !== undefined ? { lastTicket: data.lastTicket } : {}),
    ...(data.lastReceipt !== undefined ? { lastReceipt: data.lastReceipt } : {}),
    recentSales: data.recentSales.filter(isPresent).map(toSale),
    recentCustomerPayments: data.recentCustomerPayments.filter(isPresent).map(toCustomerPayment),
    ...(data.cashAnchor !== undefined ? { cashAnchor: data.cashAnchor } : {}),
    cashMovements: data.cashMovements.filter(isPresent).map(toCashMovement),
  };
}
