import { signal } from '@preact/signals';
import type { Customer } from '../../domain/customer.ts';

/**
 * Cliente adjunto a la venta en curso (RF-16) — se adjunta desde `@` en la
 * barra de comandos, independientemente de cómo se termine pagando. Solo es
 * obligatorio si se paga con `/CUENTA` (ver checkout-controller.ts).
 */
export const attachedCustomerSignal = signal<Customer | undefined>(undefined);

export function resetAttachedCustomer(): void {
  attachedCustomerSignal.value = undefined;
}
