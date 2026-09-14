import { signal } from '@preact/signals';
import type { CashSession, CashSessionSummary } from '../../domain/cash-session.ts';

/**
 * `/CAJA` (Fase 6). Mismos signals-sin-lógica que `void-sale.ts` — la lógica
 * real vive en `keyboard/cash-session-controller.ts`.
 *
 * `'opening'`: no hay turno abierto, se pide el monto de apertura.
 * `'open'`: hay un turno abierto, se muestra el resumen y se puede tipear
 * el efectivo contado para cerrarlo. `'confirming-close'`: ya se tipeó un
 * monto válido, se pide confirmación antes de cerrar de verdad (Enter
 * confirma, Esc vuelve a `'open'`). `'closed'`: el turno ya cerró, se
 * muestra el resumen final hasta que Enter/Esc vuelve a la venta.
 */
export type CashStep = 'opening' | 'open' | 'confirming-close' | 'closed';

export const cashSessionSignal = signal<CashSession | undefined>(undefined);
export const cashSummarySignal = signal<CashSessionSummary | undefined>(undefined);
export const cashStepSignal = signal<CashStep>('opening');
export const cashBufferSignal = signal('');
export const cashErrorSignal = signal<string | null>(null);
