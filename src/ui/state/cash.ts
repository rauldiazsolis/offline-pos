import { signal } from '@preact/signals';
import type { CashBalance } from '../../storage/cash-repository.ts';
import type { CashField, CashKind } from '../keyboard/cash-form-model.ts';

/**
 * Estado del modal de `/CAJA` (Etapa 5 de #94, #100) — signals sin lógica, mismo patrón que
 * `checkout.ts`; las reglas viven en `keyboard/cash-form-model.ts` y la orquestación en
 * `keyboard/cash-controller.ts`.
 */
export const EMPTY_CASH_FIELDS: Record<CashField, string> = {
  counted: '',
  concept: '',
  description: '',
  amount: '',
};

export const cashKindSignal = signal<CashKind>('count');
export const cashFieldsSignal = signal<Record<CashField, string>>(EMPTY_CASH_FIELDS);
/** El error tiene campo: la pantalla enfoca y selecciona ese, no siempre el primero. */
export const cashErrorSignal = signal<{ field: CashField; message: string } | null>(null);
/** Saldo esperado y último arqueo, cargados al abrir el modal. */
export const cashBalanceSignal = signal<CashBalance | undefined>(undefined);
export const conceptSuggestionsSignal = signal<string[]>([]);
/** Sin preselección: `null` hasta que se toca ↑/↓ (Enter sin elegir acepta lo tipeado). */
export const conceptSuggestionIndexSignal = signal<number | null>(null);
export const conceptSuggestionsOpenSignal = signal(false);

/**
 * Fecha del último arqueo de la terminal. La carga `bootstrap` y la actualiza cada arqueo; la usa
 * el aviso "Sin arqueo en 24 h" de la barra de estado.
 */
export const lastCashCountAtSignal = signal<string | undefined>(undefined);
