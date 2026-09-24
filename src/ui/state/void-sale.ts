import { signal } from '@preact/signals';
import type { VoidCandidate } from '../../storage/sale-repository.ts';

/** Tickets de las últimas 24 h con su estado (#99): anulable, anulada o anulación. */
export const voidableSalesSignal = signal<VoidCandidate[]>([]);
export const voidSelectionIndexSignal = signal<number | null>(null);
/** true = ya se eligió una venta (Enter) y se está pidiendo confirmación. */
export const voidConfirmingSignal = signal(false);
export const voidErrorSignal = signal<string | null>(null);
/** true cuando terminó de cargar la lista: el vacío se muestra recién ahí, sin parpadeo. */
export const voidLoadedSignal = signal(false);
