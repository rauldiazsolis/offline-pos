import {
  closeCashSessionAndPersist,
  getOpenCashSessionSummary,
  openCashSessionAndPersist,
} from '../../storage/cash-session-repository.ts';
import { describeError } from '../errors.ts';
import { parseNonNegativeAmount } from '../parse-amount.ts';
import {
  cashBufferSignal,
  cashErrorSignal,
  cashSessionSignal,
  cashStepSignal,
  cashSummarySignal,
} from '../state/cash-session.ts';
import { activeScreenSignal } from '../state/screen.ts';

/**
 * Capa de glue (mismo rol que `void-controller.ts`/`config-controller.ts`)
 * entre `/CAJA` y `storage/cash-session-repository.ts`.
 */

function resetCashState(): void {
  cashSessionSignal.value = undefined;
  cashSummarySignal.value = undefined;
  cashBufferSignal.value = '';
  cashErrorSignal.value = null;
}

/**
 * Se llama al montar la pantalla y después de abrir un turno (para pasar
 * a `'open'` con el buffer limpio, listo para tipear el efectivo de
 * cierre). El reset de buffer/error va ANTES del `await` a propósito: si
 * fuera después, una tecla tipeada mientras la lectura a IndexedDB todavía
 * está en vuelo quedaría pisada por este reset al resolver — una carrera
 * real, no solo teórica (la agarró un e2e flaky antes de este comentario).
 */
export async function loadCashScreen(): Promise<void> {
  cashBufferSignal.value = '';
  cashErrorSignal.value = null;
  const open = await getOpenCashSessionSummary();
  if (open === undefined) {
    cashSessionSignal.value = undefined;
    cashSummarySignal.value = undefined;
    cashStepSignal.value = 'opening';
    return;
  }
  cashSessionSignal.value = open.session;
  cashSummarySignal.value = open.summary;
  cashStepSignal.value = 'open';
}

/**
 * `/CAJA` desde la barra de comandos. Solo cambia de pantalla — cargar el
 * turno abierto (si hay uno) es responsabilidad exclusiva del
 * `useLayoutEffect` de `CashSessionScreen` al montar (mismo criterio que
 * `VoidSaleScreen`/`loadVoidableSales`). Llamar `loadCashScreen()` desde
 * los dos lados era una carrera real: si el mount effect terminaba después
 * de que el cajero ya empezó a tipear un monto, pisaba el buffer con `''`
 * a mitad de camino.
 */
export function enterCashScreen(): void {
  activeScreenSignal.value = 'cash';
}

export function updateCashBuffer(value: string): void {
  cashBufferSignal.value = value;
  cashErrorSignal.value = null;
}

async function submitOpening(): Promise<void> {
  const amount = parseNonNegativeAmount(cashBufferSignal.value);
  if (amount === undefined) {
    cashErrorSignal.value = 'Monto inválido.';
    return;
  }
  const result = await openCashSessionAndPersist({ openingAmount: amount });
  if (!result.ok) {
    cashErrorSignal.value = describeError(result);
    return;
  }
  await loadCashScreen();
}

/** En `'open'`, Enter con un monto contado válido pasa a pedir confirmación (no persiste todavía). */
function submitOpen(): void {
  const amount = parseNonNegativeAmount(cashBufferSignal.value);
  if (amount === undefined) {
    cashErrorSignal.value = 'Monto inválido.';
    return;
  }
  cashStepSignal.value = 'confirming-close';
}

async function submitClosingConfirm(): Promise<void> {
  const amount = parseNonNegativeAmount(cashBufferSignal.value);
  if (amount === undefined) {
    // No debería pasar (ya se validó en submitOpen) — defensivo.
    cashStepSignal.value = 'open';
    return;
  }
  const result = await closeCashSessionAndPersist({ closingAmount: amount });
  if (!result.ok) {
    cashErrorSignal.value = describeError(result);
    cashStepSignal.value = 'open';
    return;
  }
  cashSessionSignal.value = result.value.session;
  cashSummarySignal.value = result.value.summary;
  cashStepSignal.value = 'closed';
}

/** Enter, según el paso actual (`cashStepSignal`). */
export async function submitCashStep(): Promise<void> {
  switch (cashStepSignal.value) {
    case 'opening':
      await submitOpening();
      return;
    case 'open':
      submitOpen();
      return;
    case 'confirming-close':
      await submitClosingConfirm();
      return;
    case 'closed':
      exitCashScreen();
  }
}

/** Esc: en `'confirming-close'` vuelve a `'open'` sin cerrar nada; en cualquier otro paso, sale. */
export function cancelCashStep(): void {
  if (cashStepSignal.value === 'confirming-close') {
    cashBufferSignal.value = '';
    cashErrorSignal.value = null;
    cashStepSignal.value = 'open';
    return;
  }
  exitCashScreen();
}

/** Vuelve a la pantalla de venta — desde `'closed'` (Enter/Esc) o desde cualquier otro paso (Esc). */
export function exitCashScreen(): void {
  resetCashState();
  activeScreenSignal.value = 'sale';
}
