import { signal } from '@preact/signals';
import type { Payment } from '../../domain/sale.ts';

/** Pagos ya registrados en el cobro en curso. */
export const checkoutPaymentsSignal = signal<Payment[]>([]);

/** Buffer del input de monto del cobro. */
export const checkoutBufferSignal = signal('');

export const checkoutErrorSignal = signal<string | null>(null);

export function resetCheckout(): void {
  checkoutPaymentsSignal.value = [];
  checkoutBufferSignal.value = '';
  checkoutErrorSignal.value = null;
}
