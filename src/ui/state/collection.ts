import { signal } from '@preact/signals';
import type { CollectionMethod } from '../../domain/customer-payment.ts';

/**
 * Lo tipeado por medio en la cobranza sin venta (#101) — '' significa "no usado". Sin Cuenta
 * corriente: no tiene sentido pagar cuenta corriente con cuenta corriente.
 */
export type CollectionBuffers = Record<CollectionMethod, string>;

export function emptyCollectionBuffers(): CollectionBuffers {
  return { cash: '', debit: '', credit: '', transfer: '', qr: '' };
}

export const collectionBuffersSignal = signal<CollectionBuffers>(emptyCollectionBuffers());

export const collectionErrorSignal = signal<string | null>(null);

export function resetCollection(): void {
  collectionBuffersSignal.value = emptyCollectionBuffers();
  collectionErrorSignal.value = null;
}
