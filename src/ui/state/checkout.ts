import { signal } from '@preact/signals';
import type { Payment } from '../../domain/sale.ts';

/** Pagos ya registrados en el cobro en curso. */
export const checkoutPaymentsSignal = signal<Payment[]>([]);

/** Buffer del input de monto del cobro. */
export const checkoutBufferSignal = signal('');

export const checkoutErrorSignal = signal<string | null>(null);

/**
 * Hold aprobado con red, todavía no confirmado con una venta (RF-19). Vive
 * acá, no en Dexie: es estado efímero del cobro en curso (ver "decisiones
 * resueltas" de Fase 3 en el plan) — se resuelve al cerrar la venta
 * (`closeSaleAndPersist` lo confirma) o al cancelar el cobro
 * (`releaseAccountHold`, best-effort).
 */
export const pendingHoldSignal = signal<{ holdId: string; customerId: string } | undefined>(
  undefined,
);

export function resetCheckout(): void {
  checkoutPaymentsSignal.value = [];
  checkoutBufferSignal.value = '';
  checkoutErrorSignal.value = null;
  pendingHoldSignal.value = undefined;
}
