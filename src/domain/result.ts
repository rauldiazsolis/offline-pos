import type { Discount, Sale } from './sale.ts';

/**
 * Result<T> casero — ver "Manejo de errores" en CLAUDE.md.
 *
 * Regla general: las funciones de negocio nunca lanzan. Un error de negocio
 * anticipado (algo que el dominio ya sabe que puede pasar) se modela siempre
 * como un Result, nunca como una excepción. Todo lo demás (una invariante
 * rota, un bug) se deja explotar como excepción real hasta el manejador
 * global — nunca se envuelve en Result "por las dudas".
 *
 * ErrorMeta es el registro central y cerrado de códigos de error de negocio.
 * Cada entrada liga un ErrorCode a la forma exacta de metadata que necesita,
 * así TypeScript obliga a pasar exactamente esos datos (no un
 * Record<string, unknown> genérico) y los `switch` sobre ErrorCode quedan
 * exhaustivos en la UI/traductor.
 *
 * Se va poblando con los códigos reales a medida que el dominio los
 * necesita. Si un código deja de usarse, se saca de acá.
 */
export type ErrorMeta = {
  // cart.ts
  'cart/invalid-quantity': { quantity: number };
  'cart/line-not-found': { lineIndex: number };
  'cart/nothing-to-subtract': { productId: string };
  'cart/invalid-discount': { discount: Discount };
  'cart/invalid-freeform-line': { field: 'description' | 'unitPrice' | 'qty' };

  // sale.ts
  'sale/insufficient-stock': { productId: string; requested: number; available: number };
  'sale/empty-cart': undefined;
  'sale/invalid-payment-amount': { index: number };
  'sale/insufficient-payment': { total: number; paid: number };
  'sale/not-closed': { status: Sale['status'] };
  'sale/already-voided': undefined;

  // catalog.ts
  'catalog/duplicate-sku': { sku: string };
  'catalog/duplicate-barcode': { barcode: string };
  'catalog/invalid-fixture': { issues: { path: string; message: string }[] };
};

export type ErrorCode = keyof ErrorMeta;

export type Failure = {
  [C in ErrorCode]: { ok: false; error: C; meta: ErrorMeta[C] };
}[ErrorCode];

export type Result<T> = { ok: true; value: T } | Failure;

/** Construye un Result exitoso. */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/**
 * Construye un Result fallido para un ErrorCode y su metadata asociada.
 *
 * El `as Failure` es necesario porque TypeScript no distribuye la unión de
 * `Failure` dentro del cuerpo de una función genérica (para el compilador,
 * `C` sigue siendo `ErrorCode` en general, no el miembro específico que el
 * caller pasó) — la firma de la función sí queda completamente tipada y
 * exhaustiva del lado del caller, el `as` solo destraba la construcción interna.
 */
export function err<C extends ErrorCode>(error: C, meta: ErrorMeta[C]): Result<never> {
  return { ok: false, error, meta } as Failure;
}
