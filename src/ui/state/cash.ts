import { computed, signal } from '@preact/signals';
import { isCashCountOverdue } from '../../domain/cash-count.ts';
import type { CashBalance } from '../../storage/cash-repository.ts';
import { isTrainingMode } from '../../storage/training-mode.ts';
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

/** Reloj por minuto: el aviso de arqueo se recalcula solo aunque nadie toque nada. */
export const nowMinuteSignal = signal(new Date().toISOString());

/** Arranca el reloj del aviso de arqueo — lo llama `bootstrap`. Devuelve cómo detenerlo. */
export function startCashClock(): () => void {
  const timer = setInterval(() => {
    nowMinuteSignal.value = new Date().toISOString();
  }, 60_000);
  return () => {
    clearInterval(timer);
  };
}

/**
 * "Sin arqueo en 24 h" (spec de #100, §6): no hay arqueo, o el último tiene más de 24 h. En
 * entrenamiento no (#177): la caja de práctica arranca en 0 y un arqueo real no tiene sentido.
 */
export const cashCountOverdueSignal = computed(
  () => !isTrainingMode() && isCashCountOverdue(lastCashCountAtSignal.value, nowMinuteSignal.value),
);
