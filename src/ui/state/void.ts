import { computed, signal } from '@preact/signals';
import type { VoidCandidate } from '../../storage/void-repository.ts';
import { collectionSearchText, filterByText, saleSearchText } from '../document-search.ts';
import { getCustomerRepository } from './customer-repository.ts';

/** Ventas y cobranzas de las últimas 24 h con su estado (#99, #125): anulable, anulada o anulación. */
export const voidCandidatesSignal = signal<VoidCandidate[]>([]);
export const voidFilterSignal = signal('');
/** Lo que se ve: los candidatos filtrados por el buscador, en el mismo orden. */
export const filteredVoidCandidatesSignal = computed(() =>
  filterByText(voidCandidatesSignal.value, voidFilterSignal.value, (candidate) =>
    candidate.kind === 'sale'
      ? saleSearchText(candidate.sale)
      : collectionSearchText(
          candidate.payment,
          getCustomerRepository().getCustomer(candidate.payment.customerId)?.name ?? '',
        ),
  ),
);
/**
 * Índice en `filteredVoidCandidatesSignal`, sobre todas las filas (también las que no se anulan,
 * como en `/RESUMEN`); lo mueve `useTicketListNavigation`. Con la lista vacía no apunta a nada.
 */
export const voidSelectionIndexSignal = signal(0);
/**
 * Por qué no se abre el modal sobre la fila elegida: una original ya anulada o el documento de una
 * anulación. Se borra con la próxima tecla.
 */
export const voidMessageSignal = signal<string | null>(null);
/** true = modal de confirmación abierto sobre la seleccionada. */
export const voidConfirmingSignal = signal(false);
export const voidErrorSignal = signal<string | null>(null);
/** true cuando terminó de cargar: el vacío se muestra recién ahí, sin parpadeo. */
export const voidLoadedSignal = signal(false);
