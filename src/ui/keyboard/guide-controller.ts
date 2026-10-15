import { effect } from '@preact/signals';
import type { Product } from '../../domain/product.ts';
import type { PaymentMethod } from '../../domain/sale.ts';
import { db } from '../../storage/db.ts';
import { isTrainingMode } from '../../storage/training-mode.ts';
import { formatAmountInput, parseNonNegativeAmount } from '../parse-amount.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import { checkoutBuffersSignal } from '../state/checkout.ts';
import {
  guideLessonsSignal,
  guideRunningSignal,
  guideSignal,
  guideSnapshotSignal,
} from '../state/guide.ts';
import { operationCountsSignal } from '../state/operations.ts';
import { closeReceipt } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { uiModeSignal } from '../state/ui-mode.ts';
import { submitCheckout } from './checkout-controller.ts';
import {
  pressCommandBarEnter,
  triggerDiscardCart,
  updateCommandBarBuffer,
} from './command-bar-controller.ts';
import { buildLessons } from './guide-lessons.ts';
import { advanceStep, chooseActors, type GuideAction } from './guide-model.ts';

/** "Hacelo": una letra cada tanto, para que se vea, y una pausa antes de cada tecla. */
const CHAR_MS = 110;
const PAUSE_MS = 600;

export const GUIDE_UNAVAILABLE_REASON =
  'La guía necesita al menos un producto con precio en el catálogo.';

export type GuideDeps = {
  loadProducts: () => Promise<Product[]>;
  firstSearchResult: (query: string) => string | undefined;
  productByCode: (code: string) => string | undefined;
  wait: (ms: number) => Promise<void>;
  reducedMotion: () => boolean;
  /** Enfoca el campo de un medio en Cobro, como un click. */
  focusPaymentField: (method: PaymentMethod) => void;
  /** Escucha F2 y lo que frena "Hacelo"; devuelve con qué dejar de escuchar. */
  listen: (onKey: (event: KeyboardEvent) => void, onPointer: () => void) => () => void;
};

const browserDeps: GuideDeps = {
  loadProducts: () => db.products.toArray(),
  firstSearchResult: (query) => getCatalogRepository().search(query, 1)[0]?.product.id,
  productByCode: (code) => getCatalogRepository().findByBarcodeOrSku(code)?.id,
  wait: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  focusPaymentField: (method) => {
    document.querySelector<HTMLInputElement>(`[data-payment-method="${method}"]`)?.focus();
  },
  listen: (onKey, onPointer) => {
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  },
};

/** Lo que hay que deshacer al cerrar: el effect que sigue el estado y los listeners. */
let teardown: (() => void) | undefined;
/** Cada "Hacelo" tiene su ficha; frenarlo es cambiarla. */
let runToken = 0;
let opening = false;

function stopRun(): void {
  runToken += 1;
  guideRunningSignal.value = false;
}

/**
 * Sigue el estado de la app: arranca la lección que espera (en la venta, descartando la venta de
 * práctica a medias), avanza los pasos cumplidos y cierra la guía si se pasa a la vista de celular.
 */
function followState(): () => void {
  return effect(() => {
    const state = guideSignal.value;
    const snapshot = guideSnapshotSignal.value;
    if (uiModeSignal.value !== 'desktop') {
      // Fuera del effect: cerrar lo desecha.
      queueMicrotask(closeGuide);
      return;
    }
    if (state === null) {
      return;
    }
    const lessons = guideLessonsSignal.peek();
    if (state.phase === 'waiting') {
      if (snapshot.screen !== 'sale') {
        return;
      }
      triggerDiscardCart();
      guideSignal.value = {
        phase: 'step',
        lesson: state.lesson,
        step: 0,
        salesAtStart: operationCountsSignal.peek().sale,
      };
      return;
    }
    if (state.phase !== 'step') {
      return;
    }
    const lesson = lessons[state.lesson];
    if (lesson === undefined) {
      return;
    }
    const next = advanceStep(lesson, state.step, snapshot);
    if (next === state.step) {
      return;
    }
    if (next < lesson.steps.length) {
      guideSignal.value = { ...state, step: next };
      return;
    }
    guideSignal.value =
      state.lesson + 1 < lessons.length
        ? { phase: 'lesson-done', lesson: state.lesson }
        : { phase: 'finished' };
  });
}

/**
 * Abre la guía en la primera lección (`/GUIA`, o al entrar al entrenamiento con la guía). Solo en
 * entrenamiento: todo lo que hace la guía es práctica. Arma las lecciones con los productos de la
 * terminal; sin ninguno que sirva, lo dice.
 */
export async function openGuide(deps: GuideDeps = browserDeps): Promise<void> {
  if (!isTrainingMode() || guideSignal.value !== null || opening) {
    return;
  }
  // Un segundo pedido mientras lee los productos no la abre dos veces.
  opening = true;
  let products: Product[];
  try {
    products = await deps.loadProducts();
  } finally {
    opening = false;
  }
  const actors = chooseActors(products, {
    firstSearchResult: deps.firstSearchResult,
    productByCode: deps.productByCode,
  });
  if (actors === undefined) {
    guideLessonsSignal.value = [];
    guideSignal.value = { phase: 'unavailable', reason: GUIDE_UNAVAILABLE_REASON };
  } else {
    guideLessonsSignal.value = buildLessons(actors, {
      amountInput: formatAmountInput,
      parseAmount: parseNonNegativeAmount,
      methodLabel: (method) => PAYMENT_METHOD_LABELS[method],
    });
    guideSignal.value = { phase: 'waiting', lesson: 0 };
  }
  const stopListening = deps.listen(
    (event) => {
      if (event.key === 'F2') {
        event.preventDefault();
        void guidePrimaryAction(deps);
        return;
      }
      if (guideRunningSignal.value) {
        stopRun();
      }
    },
    () => {
      if (guideRunningSignal.value) {
        stopRun();
      }
    },
  );
  const stopFollowing = followState();
  teardown = () => {
    stopFollowing();
    stopListening();
  };
}

/** "Cerrar guía": el entrenamiento sigue, sin la guía. */
export function closeGuide(): void {
  stopRun();
  teardown?.();
  teardown = undefined;
  guideSignal.value = null;
}

/** `/GUIA`: la abre o la cierra. */
export function toggleGuide(deps: GuideDeps = browserDeps): Promise<void> {
  if (guideSignal.value !== null) {
    closeGuide();
    return Promise.resolve();
  }
  return openGuide(deps);
}

/** "Saltar lección" (y "Siguiente lección"): la próxima, o el final si era la última. */
export function nextLesson(): void {
  const state = guideSignal.value;
  if (state === null || state.phase === 'finished' || state.phase === 'unavailable') {
    return;
  }
  stopRun();
  const following = state.lesson + 1;
  guideSignal.value =
    following < guideLessonsSignal.value.length
      ? { phase: 'waiting', lesson: following }
      : { phase: 'finished' };
}

/** F2: en un paso, "Hacelo"; entre lecciones, la siguiente; al final, cerrar. */
export async function guidePrimaryAction(deps: GuideDeps = browserDeps): Promise<void> {
  const state = guideSignal.value;
  if (state === null) {
    return;
  }
  switch (state.phase) {
    case 'step':
      await doIt(deps);
      return;
    case 'lesson-done':
      nextLesson();
      return;
    case 'finished':
    case 'unavailable':
      closeGuide();
      return;
    case 'waiting':
      return;
  }
}

/**
 * "Hacelo": el paso actual a la vista, por el mismo camino que el teclado. Escribe letra por letra
 * y llama a lo mismo que cada tecla. Cualquier tecla o click lo frena y deja lo escrito.
 */
export async function doIt(deps: GuideDeps = browserDeps): Promise<void> {
  const state = guideSignal.value;
  if (state?.phase !== 'step' || guideRunningSignal.value) {
    return;
  }
  const step = guideLessonsSignal.value[state.lesson]?.steps[state.step];
  if (step === undefined) {
    return;
  }
  const actions = step.demo(guideSnapshotSignal.value);
  runToken += 1;
  const token = runToken;
  guideRunningSignal.value = true;
  const charMs = deps.reducedMotion() ? 0 : CHAR_MS;
  const live = () => token === runToken;
  for (const action of actions) {
    if (!live()) {
      return;
    }
    await perform(action, deps, charMs, live);
  }
  if (live()) {
    guideRunningSignal.value = false;
  }
}

async function typeSlowly(
  text: string,
  write: (value: string) => void,
  deps: GuideDeps,
  charMs: number,
  live: () => boolean,
): Promise<void> {
  write('');
  if (charMs === 0) {
    write(text);
    return;
  }
  for (let i = 1; i <= text.length; i += 1) {
    await deps.wait(charMs);
    if (!live()) {
      return;
    }
    write(text.slice(0, i));
  }
}

async function perform(
  action: GuideAction,
  deps: GuideDeps,
  charMs: number,
  live: () => boolean,
): Promise<void> {
  switch (action.kind) {
    case 'type-bar':
      await typeSlowly(action.text, updateCommandBarBuffer, deps, charMs, live);
      break;
    case 'type-field': {
      deps.focusPaymentField(action.method);
      const write = (value: string) => {
        checkoutBuffersSignal.value = { ...checkoutBuffersSignal.value, [action.method]: value };
      };
      await typeSlowly(action.text, write, deps, charMs, live);
      break;
    }
    case 'enter-bar':
      await deps.wait(PAUSE_MS);
      if (live()) {
        pressCommandBarEnter();
      }
      break;
    case 'confirm-checkout':
      await deps.wait(PAUSE_MS);
      if (live() && activeScreenSignal.value === 'checkout') {
        await submitCheckout();
      }
      break;
    case 'close-receipt':
      await deps.wait(PAUSE_MS);
      if (live() && activeScreenSignal.value === 'receipt') {
        closeReceipt();
      }
      break;
  }
  // El Enter de la barra puede esperar una operación en curso (`pendingBarOperation`).
  if (live()) {
    await deps.wait(0);
  }
}
