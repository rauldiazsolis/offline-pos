import {
  getCashBalance,
  listConceptSuggestions,
  recordCashCount,
  recordCashMovement,
} from '../../storage/cash-repository.ts';
import { describeError } from '../errors.ts';
import { parseAmount, parseNonNegativeAmount } from '../parse-amount.ts';
import {
  cashBalanceSignal,
  cashErrorSignal,
  cashFieldsSignal,
  cashKindSignal,
  conceptSuggestionIndexSignal,
  conceptSuggestionsOpenSignal,
  conceptSuggestionsSignal,
  EMPTY_CASH_FIELDS,
  lastCashCountAtSignal,
} from '../state/cash.ts';
import { commandBarNoticeSignal, overlayDismissedSignal } from '../state/command-bar.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  countDifference,
  countNotice,
  MOVEMENT_NOTICE,
  type CashField,
  type CashKind,
} from './cash-form-model.ts';

/**
 * Capa de glue entre el modal de `/CAJA` (Etapa 5 de #94, #100) y `storage/cash-repository.ts` —
 * mismo rol que `checkout-controller.ts`. Las reglas están en `cash-form-model.ts`.
 */

/** Descarta la respuesta de una búsqueda de conceptos que llegó después de una más nueva. */
let suggestionsToken = 0;

function resetCashForm(): void {
  cashFieldsSignal.value = EMPTY_CASH_FIELDS;
  cashErrorSignal.value = null;
  conceptSuggestionsSignal.value = [];
  conceptSuggestionIndexSignal.value = null;
  conceptSuggestionsOpenSignal.value = false;
  suggestionsToken += 1;
}

/**
 * `/CAJA` desde la barra de comandos (o el aviso de la barra de estado). Solo cambia de pantalla:
 * cargar el saldo es responsabilidad del `useLayoutEffect` del modal (`loadCashScreen`), mismo
 * criterio que el resto de las pantallas.
 */
export function enterCashScreen(kind: CashKind = 'count'): void {
  resetCashForm();
  cashBalanceSignal.value = undefined;
  cashKindSignal.value = kind;
  activeScreenSignal.value = 'cash';
}

/** Al montar el modal. El reset va antes del `await`: una tecla en vuelo no se pisa. */
export async function loadCashScreen(): Promise<void> {
  cashErrorSignal.value = null;
  cashBalanceSignal.value = await getCashBalance();
}

/** Cambiar de tipo no pierde lo tipeado (de Ingreso a Egreso, por ejemplo). */
export function setCashKind(kind: CashKind): void {
  cashKindSignal.value = kind;
  cashErrorSignal.value = null;
  closeConceptSuggestions();
}

function refreshSuggestions(): void {
  const kind = cashKindSignal.value;
  if (kind === 'count') {
    return;
  }
  suggestionsToken += 1;
  const token = suggestionsToken;
  conceptSuggestionIndexSignal.value = null;
  void listConceptSuggestions(kind, cashFieldsSignal.value.concept, new Date().toISOString()).then(
    (suggestions) => {
      if (token === suggestionsToken) {
        conceptSuggestionsSignal.value = suggestions;
      }
    },
  );
}

export function updateCashField(field: CashField, value: string): void {
  cashFieldsSignal.value = { ...cashFieldsSignal.value, [field]: value };
  cashErrorSignal.value = null;
  if (field === 'concept') {
    conceptSuggestionsOpenSignal.value = true;
    refreshSuggestions();
  }
}

/** Al enfocar Concepto: las sugerencias se ven sin tipear nada. */
export function openConceptSuggestions(): void {
  conceptSuggestionsOpenSignal.value = true;
  refreshSuggestions();
}

export function closeConceptSuggestions(): void {
  conceptSuggestionsOpenSignal.value = false;
  conceptSuggestionIndexSignal.value = null;
}

/** ↑/↓ con las sugerencias abiertas; sin preselección, el primer ↓ elige la primera. */
export function moveConceptSuggestion(direction: 1 | -1): void {
  const count = conceptSuggestionsSignal.value.length;
  if (count === 0) {
    return;
  }
  const current = conceptSuggestionIndexSignal.value;
  const next = current === null ? (direction === 1 ? 0 : count - 1) : current + direction;
  conceptSuggestionIndexSignal.value = Math.min(Math.max(next, 0), count - 1);
}

export function chooseConceptSuggestion(index: number): void {
  const concept = conceptSuggestionsSignal.value[index];
  if (concept === undefined) {
    return;
  }
  cashFieldsSignal.value = { ...cashFieldsSignal.value, concept };
  cashErrorSignal.value = null;
  closeConceptSuggestions();
}

function finish(notice: string): void {
  resetCashForm();
  commandBarNoticeSignal.value = notice;
  // Si `/CAJA` se abrió con un click (el aviso de la barra de estado), ese click cerró el overlay
  // de la barra de comandos (#28): sin esto el aviso quedaba oculto — lo encontró el e2e.
  overlayDismissedSignal.value = false;
  activeScreenSignal.value = 'sale';
}

/** Ctrl+Enter (o Enter en el arqueo): registra y vuelve a la venta con un aviso. */
export async function submitCash(): Promise<void> {
  const kind = cashKindSignal.value;
  const fields = cashFieldsSignal.value;
  if (kind === 'count') {
    const counted = parseNonNegativeAmount(fields.counted);
    if (counted === undefined) {
      cashErrorSignal.value = {
        field: 'counted',
        message: describeError({
          ok: false,
          error: 'cash/invalid-amount',
          meta: { amount: Number.NaN },
        }),
      };
      return;
    }
    const result = await recordCashCount(counted);
    if (!result.ok) {
      cashErrorSignal.value = { field: 'counted', message: describeError(result) };
      return;
    }
    const { count } = result.value;
    lastCashCountAtSignal.value = count.createdAt;
    finish(
      countNotice(countDifference(count.expected, count.counted) ?? { kind: 'even', amount: 0 }),
    );
    return;
  }
  const result = await recordCashMovement({
    direction: kind,
    amount: parseAmount(fields.amount) ?? Number.NaN,
    concept: fields.concept,
    ...(fields.description.trim() !== '' ? { description: fields.description } : {}),
  });
  if (!result.ok) {
    cashErrorSignal.value = {
      field: result.error === 'cash/concept-required' ? 'concept' : 'amount',
      message: describeError(result),
    };
    return;
  }
  finish(MOVEMENT_NOTICE[kind]);
}

export function cancelCash(): void {
  resetCashForm();
  activeScreenSignal.value = 'sale';
}
