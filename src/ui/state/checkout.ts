import { signal } from '@preact/signals';
import type { PaymentMethod } from '../../domain/sale.ts';

/** Orden fijo en el que se muestran los campos de medio de pago en el modal de cobro. */
export const TENDERABLE_METHODS: readonly PaymentMethod[] = [
  'cash',
  'debit',
  'credit',
  'transfer',
  'qr',
  'account',
];

/** Buffer de texto tipeado por el cajero para cada medio — '' significa "no usado". */
export type CheckoutBuffers = Record<PaymentMethod, string>;

function emptyBuffers(): CheckoutBuffers {
  return { cash: '', debit: '', credit: '', transfer: '', qr: '', account: '' };
}

export const checkoutBuffersSignal = signal<CheckoutBuffers>(emptyBuffers());

export const checkoutErrorSignal = signal<string | null>(null);

/**
 * Hold aprobado con red, todavía no confirmado con una venta (RF-19) —
 * `amount` es lo que se pidió, para poder detectar si el cajero cambió el
 * monto tipeado en "Cuenta corriente" entre un intento de confirmar y el
 * siguiente (ver `checkout-controller.ts::resolveAccountReference`). Vive
 * acá, no en Dexie: es estado efímero del cobro en curso — se resuelve al
 * cerrar la venta (`closeSaleAndPersist` lo confirma) o al cancelar el
 * cobro (`releaseAccountHold`, best-effort).
 */
export const pendingHoldSignal = signal<
  { holdId: string; customerId: string; amount: number } | undefined
>(undefined);

export function resetCheckout(): void {
  checkoutBuffersSignal.value = emptyBuffers();
  checkoutErrorSignal.value = null;
  pendingHoldSignal.value = undefined;
}
