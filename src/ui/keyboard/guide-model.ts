import type { Cart } from '../../domain/cart.ts';
import type { Product } from '../../domain/product.ts';
import type { PaymentMethod } from '../../domain/sale.ts';
import type { CheckoutBuffers } from '../state/checkout.ts';
import type { ActiveScreen } from '../state/screen.ts';

/**
 * Guía de entrenamiento (#226): el modelo puro, sin DOM ni async. Una lección es una lista de pasos;
 * cada paso dice qué hacer, se da por cumplido mirando el **estado de la app** (nunca las teclas: vale
 * igual con el mouse o por otro camino) y sabe hacerse solo con "Hacelo".
 */

/** Lo que mira la guía para saber si un paso se cumplió. */
export type GuideSnapshot = {
  screen: ActiveScreen;
  cart: Cart;
  /** Total de la venta en curso (`calculateTotals`). */
  total: number;
  /** Lo tipeado en la barra de comandos. */
  buffer: string;
  selectedLine: number | null;
  checkout: CheckoutBuffers;
  /** Ventas cerradas desde que empezó la lección. */
  salesClosed: number;
};

/** Qué dice el paso: un texto, y si hay algo que escribir, ese texto aparte (va resaltado). */
export type GuideSay = { before: string; text?: string; after?: string };

/** Dónde se escribe el `text` del paso, para marcar en vivo lo que ya coincide. */
export type GuideTarget = { where: 'bar' } | { where: 'field'; method: PaymentMethod };

/**
 * Lo que hace "Hacelo", en orden. Cada una va por el mismo camino que el teclado: escribir en la
 * barra es `updateCommandBarBuffer`, Enter es lo mismo que la tecla, etcétera.
 */
export type GuideAction =
  /** Vacía la barra y escribe `text` letra por letra. */
  | { kind: 'type-bar'; text: string }
  /** Enter en la barra de comandos. */
  | { kind: 'enter-bar' }
  /** Enfoca el campo del medio en Cobro, lo vacía y escribe `text` letra por letra. */
  | { kind: 'type-field'; method: PaymentMethod; text: string }
  /** Ctrl+Enter en Cobro. */
  | { kind: 'confirm-checkout' }
  /** Esc en el comprobante. */
  | { kind: 'close-receipt' };

export type GuideStep = {
  say: (snapshot: GuideSnapshot) => GuideSay;
  target?: GuideTarget;
  done: (snapshot: GuideSnapshot) => boolean;
  /** Una pista si el estado se fue para otro lado; nunca bloquea nada. */
  hint?: (snapshot: GuideSnapshot) => string | undefined;
  demo: (snapshot: GuideSnapshot) => GuideAction[];
};

export type GuideLesson = { title: string; steps: GuideStep[] };

/** El producto con el que practican las lecciones, y la palabra que lo encuentra primero. */
export type GuideActors = {
  main: { id: string; name: string; word: string };
  /** Un producto con un código de solo dígitos (de barras o SKU), si hay alguno. */
  code?: { id: string; name: string; code: string };
};

export type ActorLookup = {
  /** El primer resultado de la búsqueda por nombre, como la barra. */
  firstSearchResult: (query: string) => string | undefined;
  /** El producto de un código exacto, como Enter con un código. */
  productByCode: (code: string) => string | undefined;
};

/** La barra la toma como búsqueda por nombre: empieza con una letra y no tiene `$ * % @ /`. */
function isPlainSearch(text: string): boolean {
  return /^\p{L}/u.test(text) && !/[$*%@/]/.test(text);
}

/** Primera palabra de 3 letras o más del nombre, en minúsculas. */
function firstWord(name: string): string | undefined {
  return name
    .toLowerCase()
    .split(/\s+/)
    .find((word) => /^\p{L}{3,}$/u.test(word));
}

function searchWordFor(product: Product, lookup: ActorLookup): string | undefined {
  const candidates = [firstWord(product.name), product.name.toLowerCase().trim()];
  return candidates.find(
    (candidate): candidate is string =>
      candidate !== undefined &&
      isPlainSearch(candidate) &&
      lookup.firstSearchResult(candidate) === product.id,
  );
}

function digitCodeFor(product: Product, lookup: ActorLookup): string | undefined {
  return [...product.barcodes, product.sku].find(
    (code) => /^\d{4,}$/.test(code) && lookup.productByCode(code) === product.id,
  );
}

/**
 * Elige con qué practicar: los productos de la terminal, nunca nombres fijos. El principal, uno con
 * precio y sin bloqueo que se encuentre primero escribiendo una palabra de su nombre; el del código,
 * otro con un código de solo dígitos (el mismo si no hay otro). Sin ninguno que sirva, `undefined`.
 */
export function chooseActors(
  products: readonly Product[],
  lookup: ActorLookup,
): GuideActors | undefined {
  const usable = products
    .filter((product) => product.price > 0 && product.blocked === undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
  let main: GuideActors['main'] | undefined;
  for (const product of usable) {
    const word = searchWordFor(product, lookup);
    if (word !== undefined) {
      main = { id: product.id, name: product.name, word };
      break;
    }
  }
  if (main === undefined) {
    return undefined;
  }
  const withCode = usable
    .map((product) => ({ product, code: digitCodeFor(product, lookup) }))
    .filter((entry): entry is { product: Product; code: string } => entry.code !== undefined);
  const chosen = withCode.find((entry) => entry.product.id !== main.id) ?? withCode[0];
  return {
    main,
    ...(chosen !== undefined
      ? { code: { id: chosen.product.id, name: chosen.product.name, code: chosen.code } }
      : {}),
  };
}

/**
 * Cuánto de lo esperado ya está escrito: `matched` caracteres coinciden (sin distinguir mayúsculas)
 * y, si lo escrito se desvía, `wrongAt` es el primero distinto (o el sobrante).
 */
export function typedProgress(
  expected: string,
  typed: string,
): { matched: number; wrongAt: number | null } {
  const want = expected.toLowerCase();
  const got = typed.toLowerCase();
  let matched = 0;
  while (matched < got.length && matched < want.length && got[matched] === want[matched]) {
    matched += 1;
  }
  return { matched, wrongAt: matched < got.length ? matched : null };
}

/**
 * El paso actual después de mirar el estado: desde `step`, avanza mientras el paso esté cumplido
 * (un paso que ya se cumplió solo, como "volvé a la venta" sin comprobante, se pasa de largo).
 * Devuelve `steps.length` si la lección terminó.
 */
export function advanceStep(lesson: GuideLesson, step: number, snapshot: GuideSnapshot): number {
  let current = step;
  while (current < lesson.steps.length && lesson.steps[current]?.done(snapshot) === true) {
    current += 1;
  }
  return current;
}
