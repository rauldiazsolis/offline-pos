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
  'cart/freeform-line-not-found': { description: string };
  'cart/invalid-global-adjustment': { percentage: number };

  // sale.ts
  'sale/insufficient-stock': { productId: string; requested: number; available: number };
  'sale/empty-cart': undefined;
  'sale/invalid-payment-amount': { index: number };
  'sale/insufficient-payment': { total: number; paid: number };
  'sale/non-cash-exceeds-total': { nonCashTotal: number; total: number };
  'sale/not-closed': { status: Sale['status'] };
  'sale/already-voided': undefined;

  // catalog.ts
  'catalog/duplicate-sku': { sku: string };
  'catalog/duplicate-barcode': { barcode: string };
  'catalog/invalid-fixture': { issues: { path: string; message: string }[] };

  // storage/seed-catalog.ts
  'catalog/seed-failed': { message: string };

  // storage/sale-repository.ts
  'sale/persist-failed': { message: string };
  'sale/not-found': { saleId: string };

  // sync/config.ts, sync/engine.ts, connectors/rest/rest-fetch-connector.ts
  'sync/invalid-payload': { issues: { path: string; message: string }[] };
  'sync/request-failed': { status?: number; message: string };
  // sync/engine.ts (pull batch, #87): un lote de push que nos interesa sigue sin resolverse
  'sync/pending-lot': undefined;
  // sync/engine.ts: el backend reportó problemas en un lote ya resuelto — informativo, no bloquea
  'sync/push-issues': { issues: string[] };
  'sync/config-missing': undefined;
  'sync/config-invalid': { issues: { path: string; message: string }[] };
  // sync/connection.ts (prueba de conexión) y connectors/google-sheets/bridge-client.ts
  'sync/timeout': { seconds: number };
  'sync/remote-error': { message: string };
  // sync/apply-connection.ts
  'connection/apply-failed': { message: string };
  // sync/connection.ts: un ciclo de sync en curso no terminó a tiempo para probar
  'connection/sync-busy': undefined;
  // storage/reconcile.ts (foto completa del catálogo)
  'sync/empty-snapshot': { tables: ('products' | 'stock' | 'customers')[] };
  'sync/reconcile-failed': { message: string };

  // sale-lifecycle.ts, checkout-controller.ts (cuenta corriente)
  'account/hold-rejected': { reasonCode: string };
  'account/offline-limit-exceeded': { missing: number };
  'account/no-customer-attached': undefined;

  // storage/customer-repository.ts
  'customer/persist-failed': { message: string };

  // storage/seed-customers.ts
  'customer/invalid-fixture': { issues: { path: string; message: string }[] };
  'customer/seed-failed': { message: string };

  // cash-session.ts, storage/cash-session-repository.ts
  'cash-session/invalid-amount': { amount: number };
  'cash-session/already-open': undefined;
  'cash-session/none-open': undefined;
  'cash-session/already-closed': undefined;
  'cash-session/persist-failed': { message: string };
  'cash-session/none-ever': undefined; // storage/cash-summary-repository.ts

  // storage/demo-reset.ts
  'demo/reset-failed': { message: string };
  'demo/backend-reset-failed': { message: string };
  'demo/unavailable-for-connector': { connectorLabel: string };
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
