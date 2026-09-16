# Cobro multi-medio (diálogo modal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la pantalla de Cobro (`/COBRAR`, `Ctrl+Enter`) como un diálogo modal con 6 campos de monto simultáneos y siempre visibles (Efectivo, Tarjeta de Débito, Tarjeta de Crédito, Transferencia, Código QR, Cuenta corriente), resolviendo de raíz el bug del vuelto no descontado en el arqueo.

**Architecture:** El dominio gana un tipo `PaymentMethod` de 6 variantes y una función pura `resolveTender` (`domain/tender.ts`) que convierte "lo tipeado por medio" en los `Payment[]` netos a persistir + el vuelto — solo Efectivo puede exceder lo que falta cubrir, el resto es error de validación si excede. La UI reemplaza el input único + buffer de texto por un `Record<PaymentMethod, string>` de buffers (uno por campo); `checkout-controller.ts` valida recién al confirmar (Ctrl+Enter), nunca mientras se tipea. El vuelto se pasa al comprobante por un signal efímero (no se persiste en `Sale`, no hay hoy ningún consumidor que lo necesite después).

**Tech Stack:** Preact + `@preact/signals`, Dexie (sin cambio de schema — `payments.method` no está indexado), Vitest + Testing Library (sin jest-dom), Playwright para e2e.

**Spec:** [issue #55 en GitHub](https://github.com/rauldiazsolis/offline-pos/issues/55) (diseño consolidado, sesión de brainstorming 2026-09-16) — no hay spec en markdown, este repo registra el diseño de estos ciclos directo en la issue.

## Global Constraints

- `any` prohibido; `unknown` solo en el borde con validación Zod inmediata (no aplica en este plan, no hay input externo nuevo).
- Toda función de negocio devuelve `Result<T>`, nunca lanza — `domain/` no importa `ui/`, `storage/` ni `sync/`.
- Optionals con `exactOptionalPropertyTypes`: nunca `campo: undefined` explícito, usar spread condicional (`...(x !== undefined ? { campo: x } : {})`).
- `Payment.amount` es siempre el neto aplicado a la venta — nunca incluye vuelto. Solo `'cash'` puede tipearse por encima de lo que falta cubrir; el resto de los medios nunca puede superar el total, o es error de validación al confirmar (nunca bloquea el tipeo).
- Sin dependencias nuevas.
- Tests de componentes: sin `@testing-library/jest-dom`, aserciones planas (`expect(x).not.toBeNull()`, `toHaveProperty('disabled', true)`), nunca `toBeInTheDocument()`/`toBeDisabled()`.
- Tests de `storage/`: importar `'fake-indexeddb/auto'` primero.
- E2E corre contra el build real (`pnpm build && pnpm preview`), no el dev server.

---

### Task 1: Expandir `Payment.method` y propagar el enum nuevo

**Files:**
- Modify: `src/domain/sale.ts` (tipo `Payment`)
- Modify: `src/domain/result.ts` (nuevo código de error)
- Modify: `src/ui/errors.ts` (traducción del código nuevo)
- Modify: `src/domain/cash-session.ts` (`totalsByMethod` inicial)
- Modify: `src/domain/cash-session.test.ts` (literales `'card'`/`'other'`)
- Modify: `src/storage/cash-session-repository.test.ts` (literal `'card'`/`'other'`)
- Modify: `src/ui/screens/cash-session-screen.tsx` (labels locales, se arreglan acá provisoriamente — Task 3 las reemplaza por el módulo compartido)

**Interfaces:**
- Produces: `PaymentMethod` (`'cash' | 'debit' | 'credit' | 'transfer' | 'qr' | 'account'`), exportado desde `domain/sale.ts`. `Payment.method: PaymentMethod`. Código de error `'sale/non-cash-exceeds-total'` con meta `{ nonCashTotal: number; total: number }`.

- [ ] **Step 1: Cambiar el tipo `Payment` en `domain/sale.ts`**

Reemplazar (línea 14-22):

```ts
/**
 * `'account'` (Fase 3, cuenta corriente) usa `reference` para el `holdId`
 * cuando el hold se aprobó con red — sin red (RF-18), no hay `holdId`.
 */
export type Payment = {
  method: 'cash' | 'card' | 'other' | 'account';
  amount: number;
  reference?: string;
};
```

por:

```ts
/**
 * Medios de pago reales del negocio (issue #55, sesión de brainstorming
 * 2026-09-16) — se retiró el catálogo abierto `'other'` que tenía Fase 3:
 * todo pago tiene que mapear a uno de estos.
 */
export type PaymentMethod = 'cash' | 'debit' | 'credit' | 'transfer' | 'qr' | 'account';

/**
 * `'account'` (Fase 3, cuenta corriente) usa `reference` para el `holdId`
 * cuando el hold se aprobó con red — sin red (RF-18), no hay `holdId`.
 */
export type Payment = {
  method: PaymentMethod;
  amount: number;
  reference?: string;
};
```

- [ ] **Step 2: Correr el typecheck y confirmar que rompe en los usos viejos**

Run: `pnpm typecheck`
Expected: FAIL — errores de tipo en `domain/cash-session.ts` (literales `'card'`/`'other'`), `domain/cash-session.test.ts`, `storage/cash-session-repository.test.ts` y `ui/screens/cash-session-screen.tsx`.

- [ ] **Step 3: Agregar el código de error nuevo a `domain/result.ts`**

En `ErrorMeta`, agregar debajo de `'sale/insufficient-payment'`:

```ts
  'sale/insufficient-payment': { total: number; paid: number };
  'sale/non-cash-exceeds-total': { nonCashTotal: number; total: number };
```

- [ ] **Step 4: Traducir el código nuevo en `ui/errors.ts`**

Agregar el `case` debajo de `'sale/insufficient-payment'`:

```ts
    case 'sale/insufficient-payment':
      return `Falta pagar ${String(failure.meta.total - failure.meta.paid)}.`;
    case 'sale/non-cash-exceeds-total':
      return `Los medios no efectivo no pueden superar el total (excedente ${String(failure.meta.nonCashTotal - failure.meta.total)}).`;
```

- [ ] **Step 5: Actualizar `totalsByMethod` en `domain/cash-session.ts`**

Reemplazar (líneas 106-111):

```ts
  const totalsByMethod: Record<Payment['method'], number> = {
    cash: 0,
    card: 0,
    other: 0,
    account: 0,
  };
```

por:

```ts
  const totalsByMethod: Record<Payment['method'], number> = {
    cash: 0,
    debit: 0,
    credit: 0,
    transfer: 0,
    qr: 0,
    account: 0,
  };
```

- [ ] **Step 6: Arreglar los literales rotos en `domain/cash-session.test.ts`**

Línea 85, cambiar `payments: [{ method: 'card', amount: 200 }]` por `payments: [{ method: 'debit', amount: 200 }]`.

Línea 92, cambiar `totalsByMethod: { cash: 100, card: 200, other: 0, account: 0 }` por:

```ts
      totalsByMethod: { cash: 100, debit: 200, credit: 0, transfer: 0, qr: 0, account: 0 },
```

- [ ] **Step 7: Arreglar el literal roto en `storage/cash-session-repository.test.ts`**

Línea 73, cambiar `totalsByMethod: { cash: 100, card: 0, other: 0, account: 0 }` por:

```ts
        totalsByMethod: { cash: 100, debit: 0, credit: 0, transfer: 0, qr: 0, account: 0 },
```

- [ ] **Step 8: Arreglar los labels rotos en `ui/screens/cash-session-screen.tsx` (provisorio, Task 3 lo reemplaza)**

Líneas 22-27, cambiar:

```ts
const PAYMENT_METHOD_LABELS: Record<Payment['method'], string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  other: 'Otro',
  account: 'Cuenta corriente',
};
```

por:

```ts
const PAYMENT_METHOD_LABELS: Record<Payment['method'], string> = {
  cash: 'Efectivo',
  debit: 'Tarjeta de Débito',
  credit: 'Tarjeta de Crédito',
  transfer: 'Transferencia',
  qr: 'Código QR',
  account: 'Cuenta corriente',
};
```

- [ ] **Step 9: Typecheck y tests, confirmar que pasan**

Run: `pnpm typecheck && pnpm exec vitest run src/domain/cash-session.test.ts src/storage/cash-session-repository.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/domain/sale.ts src/domain/result.ts src/ui/errors.ts src/domain/cash-session.ts src/domain/cash-session.test.ts src/storage/cash-session-repository.test.ts src/ui/screens/cash-session-screen.tsx
git commit -m "feat(domain): expandir Payment.method a los medios reales del negocio"
```

---

### Task 2: Función pura `resolveTender` (`domain/tender.ts`)

**Files:**
- Create: `src/domain/tender.ts`
- Test: `src/domain/tender.test.ts`

**Interfaces:**
- Consumes: `Payment`, `PaymentMethod` de `domain/sale.ts` (Task 1); `err`/`ok`/`Result` de `domain/result.ts`; código `'sale/non-cash-exceeds-total'` (Task 1).
- Produces: `TenderedAmounts = Record<PaymentMethod, number>`; `resolveTender(tendered: TenderedAmounts, total: number): Result<{ payments: Payment[]; change: number }>` — usado por `checkout-controller.ts` (Task 6).

- [ ] **Step 1: Escribir el test que falla**

Crear `src/domain/tender.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveTender, type TenderedAmounts } from './tender.ts';

function tender(overrides: Partial<TenderedAmounts> = {}): TenderedAmounts {
  return { cash: 0, debit: 0, credit: 0, transfer: 0, qr: 0, account: 0, ...overrides };
}

describe('resolveTender', () => {
  it('efectivo exacto: un pago, sin vuelto', () => {
    const result = resolveTender(tender({ cash: 1200 }), 1200);

    expect(result).toEqual({
      ok: true,
      value: { payments: [{ method: 'cash', amount: 1200 }], change: 0 },
    });
  });

  it('efectivo de más: descuenta el vuelto del pago guardado (resuelve el bug del arqueo)', () => {
    const result = resolveTender(tender({ cash: 2000 }), 1200);

    expect(result).toEqual({
      ok: true,
      value: { payments: [{ method: 'cash', amount: 1200 }], change: 800 },
    });
  });

  it('combina varios medios sin exceder', () => {
    const result = resolveTender(tender({ debit: 500, cash: 700 }), 1200);

    expect(result).toEqual({
      ok: true,
      value: {
        payments: [
          { method: 'debit', amount: 500 },
          { method: 'cash', amount: 700 },
        ],
        change: 0,
      },
    });
  });

  it('un medio no-efectivo que supera el total es un error de validación', () => {
    const result = resolveTender(tender({ debit: 1500 }), 1200);

    expect(result).toEqual({
      ok: false,
      error: 'sale/non-cash-exceeds-total',
      meta: { nonCashTotal: 1500, total: 1200 },
    });
  });

  it('varios medios no-efectivo que combinados superan el total, aunque ninguno solo', () => {
    const result = resolveTender(tender({ debit: 700, credit: 700 }), 1200);

    expect(result).toEqual({
      ok: false,
      error: 'sale/non-cash-exceeds-total',
      meta: { nonCashTotal: 1400, total: 1200 },
    });
  });

  it('no cubre el total: error de pago insuficiente', () => {
    const result = resolveTender(tender({ cash: 500, debit: 300 }), 1200);

    expect(result).toEqual({
      ok: false,
      error: 'sale/insufficient-payment',
      meta: { total: 1200, paid: 800 },
    });
  });

  it('cuenta corriente se trata como cualquier medio no-efectivo', () => {
    const result = resolveTender(tender({ account: 1200 }), 1200);

    expect(result).toEqual({
      ok: true,
      value: { payments: [{ method: 'account', amount: 1200 }], change: 0 },
    });
  });
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `pnpm exec vitest run src/domain/tender.test.ts`
Expected: FAIL con "Cannot find module './tender.ts'" o similar.

- [ ] **Step 3: Implementar `domain/tender.ts`**

```ts
import { err, ok, type Result } from './result.ts';
import type { Payment, PaymentMethod } from './sale.ts';

/** Monto tipeado por el cajero para cada medio, en el cobro en curso. 0 = no usado. */
export type TenderedAmounts = Record<PaymentMethod, number>;

const NON_CASH_METHODS: readonly Exclude<PaymentMethod, 'cash'>[] = [
  'debit',
  'credit',
  'transfer',
  'qr',
  'account',
];

/**
 * Resuelve los `Payment[]` a persistir a partir de lo tipeado por medio y el
 * total de la venta (issue #55, sesión de brainstorming 2026-09-16). Solo
 * Efectivo puede tipearse por encima de lo que falta cubrir (el excedente es
 * vuelto); el resto de los medios nunca puede superar el total, o es un
 * error de validación. El `Payment.amount` devuelto es siempre el neto
 * aplicado — nunca incluye el vuelto (a diferencia del bug #48 original, que
 * guardaba el monto tendido tal cual).
 */
export function resolveTender(
  tendered: TenderedAmounts,
  total: number,
): Result<{ payments: Payment[]; change: number }> {
  const nonCashTotal = NON_CASH_METHODS.reduce((sum, method) => sum + tendered[method], 0);
  if (nonCashTotal > total) {
    return err('sale/non-cash-exceeds-total', { nonCashTotal, total });
  }

  const paid = nonCashTotal + tendered.cash;
  if (paid < total) {
    return err('sale/insufficient-payment', { total, paid });
  }

  const netCash = total - nonCashTotal;
  const change = paid - total;

  const payments: Payment[] = [];
  for (const method of NON_CASH_METHODS) {
    if (tendered[method] > 0) {
      payments.push({ method, amount: tendered[method] });
    }
  }
  if (netCash > 0) {
    payments.push({ method: 'cash', amount: netCash });
  }

  return ok({ payments, change });
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `pnpm exec vitest run src/domain/tender.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/tender.ts src/domain/tender.test.ts
git commit -m "feat(domain): resolveTender — netea pagos por medio y calcula el vuelto"
```

---

### Task 3: Labels compartidos de medio de pago (`ui/payment-labels.ts`)

**Files:**
- Create: `src/ui/payment-labels.ts`
- Modify: `src/ui/screens/cash-session-screen.tsx` (usar el módulo compartido en vez del const local)

**Interfaces:**
- Produces: `PAYMENT_METHOD_LABELS: Record<PaymentMethod, string>` — usado por `cash-session-screen.tsx` (este task), `receipt-screen.tsx` (Task 4) y `checkout-screen.tsx` (Task 7).

- [ ] **Step 1: Crear `src/ui/payment-labels.ts`**

```ts
import type { PaymentMethod } from '../domain/sale.ts';

/**
 * Etiquetas en español para cada medio de pago — compartidas entre el modal
 * de cobro (`checkout-screen.tsx`), el desglose de arqueo
 * (`cash-session-screen.tsx`) y el detalle de pagos del comprobante
 * (`receipt-screen.tsx`), así los tres muestran exactamente el mismo texto.
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  debit: 'Tarjeta de Débito',
  credit: 'Tarjeta de Crédito',
  transfer: 'Transferencia',
  qr: 'Código QR',
  account: 'Cuenta corriente',
};
```

- [ ] **Step 2: Usar el módulo compartido en `cash-session-screen.tsx`**

Quitar el const local (Task 1, Step 8) y el import de `Payment` que ya no hace falta para eso:

```ts
import type { Payment } from '../../domain/sale.ts';
import { formatMoney } from '../format.ts';
```

por:

```ts
import { formatMoney } from '../format.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';
```

y borrar el bloque:

```ts
const PAYMENT_METHOD_LABELS: Record<Payment['method'], string> = {
  cash: 'Efectivo',
  debit: 'Tarjeta de Débito',
  credit: 'Tarjeta de Crédito',
  transfer: 'Transferencia',
  qr: 'Código QR',
  account: 'Cuenta corriente',
};
```

`Payment['method'][]` en el `.map()` de la línea 135 pasa a necesitar el tipo `PaymentMethod` importado de dominio en vez de `Payment['method']` — cambiar esa línea:

```ts
{(Object.keys(summary.totalsByMethod) as Payment['method'][]).map((method) => (
```

por:

```ts
import type { PaymentMethod } from '../../domain/sale.ts';
...
{(Object.keys(summary.totalsByMethod) as PaymentMethod[]).map((method) => (
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/ui/payment-labels.ts src/ui/screens/cash-session-screen.tsx
git commit -m "refactor(ui): extraer PAYMENT_METHOD_LABELS a un módulo compartido"
```

---

### Task 4: Vuelto efímero para el comprobante

**Files:**
- Modify: `src/ui/state/receipt.ts`
- Modify: `src/ui/screens/receipt-screen.tsx`
- Modify: `src/ui/screens/receipt-screen.test.tsx`

**Interfaces:**
- Produces: `receiptChangeSignal: Signal<number>` — lo setea `checkout-controller.ts::submitCheckout` (Task 6) junto con `receiptSaleSignal`, lo resetea `continueToSale`.

- [ ] **Step 1: Agregar el signal en `ui/state/receipt.ts`**

```ts
import { signal } from '@preact/signals';
import type { Sale } from '../../domain/sale.ts';

/** Última venta cerrada — la lee receipt-screen para mostrar el comprobante. */
export const receiptSaleSignal = signal<Sale | null>(null);

/**
 * Vuelto entregado en el cobro que generó `receiptSaleSignal` — efímero,
 * nunca persistido en `Sale` (issue #55: no hay hoy ningún consumidor que lo
 * necesite después de mostrado el comprobante — no hay reimpresión desde
 * Historial todavía). `Payment.amount` es siempre el neto aplicado, así que
 * no se puede reconstruir el vuelto a partir de `sale.payments`.
 */
export const receiptChangeSignal = signal(0);
```

- [ ] **Step 2: Actualizar `receipt-screen.tsx` para usar el signal en vez de recalcular**

Cambiar el import:

```ts
import { receiptSaleSignal } from '../state/receipt.ts';
```

por:

```ts
import { receiptChangeSignal, receiptSaleSignal } from '../state/receipt.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';
```

Cambiar `continueToSale`:

```ts
function continueToSale(): void {
  receiptSaleSignal.value = null;
  activeScreenSignal.value = 'sale';
}
```

por:

```ts
function continueToSale(): void {
  receiptSaleSignal.value = null;
  receiptChangeSignal.value = 0;
  activeScreenSignal.value = 'sale';
}
```

Quitar el cálculo viejo:

```ts
  const paid = sale.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const change = paid - sale.total;
```

por:

```ts
  const change = receiptChangeSignal.value;
```

Y usar los labels compartidos en la línea de cada pago:

```ts
        {sale.payments.map((payment, index) => (
          <div key={index} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Pago ({payment.method})</span>
            <span>{formatMoney(payment.amount)}</span>
          </div>
        ))}
```

por:

```ts
        {sale.payments.map((payment, index) => (
          <div key={index} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Pago ({PAYMENT_METHOD_LABELS[payment.method]})</span>
            <span>{formatMoney(payment.amount)}</span>
          </div>
        ))}
```

- [ ] **Step 3: Actualizar `receipt-screen.test.tsx`**

Cambiar el import:

```ts
import { receiptSaleSignal } from '../state/receipt.ts';
```

por:

```ts
import { receiptChangeSignal, receiptSaleSignal } from '../state/receipt.ts';
```

En el `beforeEach`, cambiar el pago de `{ method: 'cash', amount: 250 }` (que dependía del cálculo viejo `paid - total`) por el neto real y setear el signal nuevo:

```ts
  receiptSaleSignal.value = {
    id: 'sale-1',
    lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }],
    payments: [{ method: 'cash', amount: 200 }],
    total: 200,
    status: 'closed',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  receiptChangeSignal.value = 50;
```

Y en el test de Escape, agregar la aserción del reset:

```ts
  it('Escape vuelve a la pantalla de venta', () => {
    render(<ReceiptScreen />);

    fireEvent.keyDown(screen.getByText('Comprobante').closest('[tabindex]') ?? document.body, {
      key: 'Escape',
    });

    expect(activeScreenSignal.value).toBe('sale');
    expect(receiptSaleSignal.value).toBeNull();
    expect(receiptChangeSignal.value).toBe(0);
  });
```

- [ ] **Step 4: Correr los tests**

Run: `pnpm exec vitest run src/ui/screens/receipt-screen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/state/receipt.ts src/ui/screens/receipt-screen.tsx src/ui/screens/receipt-screen.test.tsx
git commit -m "feat(ui): vuelto efímero en el comprobante, ya no se recalcula de payments"
```

---

### Task 5: Nuevo estado de cobro (buffers por medio)

**Files:**
- Modify: `src/ui/state/checkout.ts` (reescritura completa)

**Interfaces:**
- Produces: `TENDERABLE_METHODS: readonly PaymentMethod[]`, `CheckoutBuffers = Record<PaymentMethod, string>`, `checkoutBuffersSignal: Signal<CheckoutBuffers>`, `checkoutErrorSignal: Signal<string | null>` (sin cambios de nombre), `pendingHoldSignal: Signal<{ holdId: string; customerId: string; amount: number } | undefined>` (gana `amount`), `resetCheckout()`. Consumido por `checkout-controller.ts` (Task 6) y `checkout-screen.tsx` (Task 7).

- [ ] **Step 1: Reescribir `src/ui/state/checkout.ts`**

```ts
import { signal } from '@preact/signals';
import type { PaymentMethod } from '../../domain/sale.ts';

/** Orden fijo en el que se muestran los campos de medio de pago en el modal de cobro. */
export const TENDERABLE_METHODS: readonly PaymentMethod[] = [
  'cash',
  'debit',
  'credit',
  'transfer',
  'qr',
  'account',
];

/** Buffer de texto tipeado por el cajero para cada medio — '' significa "no usado". */
export type CheckoutBuffers = Record<PaymentMethod, string>;

function emptyBuffers(): CheckoutBuffers {
  return { cash: '', debit: '', credit: '', transfer: '', qr: '', account: '' };
}

export const checkoutBuffersSignal = signal<CheckoutBuffers>(emptyBuffers());

export const checkoutErrorSignal = signal<string | null>(null);

/**
 * Hold aprobado con red, todavía no confirmado con una venta (RF-19) —
 * `amount` es lo que se pidió, para poder detectar si el cajero cambió el
 * monto tipeado en "Cuenta corriente" entre un intento de confirmar y el
 * siguiente (ver `checkout-controller.ts::resolveAccountReference`). Vive
 * acá, no en Dexie: es estado efímero del cobro en curso — se resuelve al
 * cerrar la venta (`closeSaleAndPersist` lo confirma) o al cancelar el
 * cobro (`releaseAccountHold`, best-effort).
 */
export const pendingHoldSignal = signal<
  { holdId: string; customerId: string; amount: number } | undefined
>(undefined);

export function resetCheckout(): void {
  checkoutBuffersSignal.value = emptyBuffers();
  checkoutErrorSignal.value = null;
  pendingHoldSignal.value = undefined;
}
```

- [ ] **Step 2: Typecheck (va a fallar hasta Task 6/7 — es esperado, este task es solo el estado)**

Run: `pnpm typecheck`
Expected: FAIL — `ui/keyboard/checkout-controller.ts` y `ui/screens/checkout-screen.tsx` todavía importan `checkoutPaymentsSignal`/`checkoutBufferSignal`, que ya no existen. Se resuelve en Task 6 y 7.

- [ ] **Step 3: Commit**

```bash
git add src/ui/state/checkout.ts
git commit -m "refactor(ui): checkout state pasa a un buffer de texto por medio de pago"
```

---

### Task 6: Controller de cobro — flujo de confirmación multi-medio

**Files:**
- Modify: `src/ui/keyboard/checkout-controller.ts` (reescritura completa)
- Modify: `src/ui/keyboard/checkout-controller.test.ts` (reescritura completa)

**Interfaces:**
- Consumes: `resolveTender`/`TenderedAmounts` (Task 2), `checkoutBuffersSignal`/`checkoutErrorSignal`/`pendingHoldSignal`/`resetCheckout`/`TENDERABLE_METHODS` (Task 5), `receiptChangeSignal`/`receiptSaleSignal` (Task 4).
- Produces: `amountTendered(): number`, `changePreview(): number`, `submitCheckout(): Promise<void>`, `cancelCheckout(): void` — consumidos por `checkout-screen.tsx` (Task 7).

- [ ] **Step 1: Reescribir `src/ui/keyboard/checkout-controller.ts`**

```ts
import { availableCredit, canChargeOffline } from '../../domain/customer.ts';
import { err, ok, type Result } from '../../domain/result.ts';
import type { Payment } from '../../domain/sale.ts';
import { resolveTender, type TenderedAmounts } from '../../domain/tender.ts';
import { calculateTotals } from '../../domain/totals.ts';
import { releaseAccountHold } from '../../storage/customer-repository.ts';
import { newId } from '../../storage/ids.ts';
import { closeSaleAndPersist } from '../../storage/sale-repository.ts';
import { requestAccountHoldNow } from '../../sync/account-hold.ts';
import { describeError } from '../errors.ts';
import { parseNonNegativeAmount } from '../parse-amount.ts';
import { cartSignal } from '../state/cart.ts';
import {
  checkoutBuffersSignal,
  checkoutErrorSignal,
  pendingHoldSignal,
  resetCheckout,
  TENDERABLE_METHODS,
} from '../state/checkout.ts';
import { getCustomerRepository } from '../state/customer-repository.ts';
import { attachedCustomerSignal, resetAttachedCustomer } from '../state/customer.ts';
import { receiptChangeSignal, receiptSaleSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';

function parsedTenderSafe(): TenderedAmounts {
  const buffers = checkoutBuffersSignal.value;
  const parsed = {} as TenderedAmounts;
  for (const method of TENDERABLE_METHODS) {
    parsed[method] = parseNonNegativeAmount(buffers[method]) ?? 0;
  }
  return parsed;
}

/** Suma de lo tipeado en todos los campos, ignorando texto inválido (se valida recién al confirmar). */
export function amountTendered(): number {
  const tender = parsedTenderSafe();
  return TENDERABLE_METHODS.reduce((sum, method) => sum + tender[method], 0);
}

/** Vista previa de vuelto para la pantalla — nunca negativo, no bloquea el tipeo. */
export function changePreview(): number {
  const { total } = calculateTotals(cartSignal.value);
  return Math.max(0, amountTendered() - total);
}

function parsedTenderOrError(): Result<TenderedAmounts> {
  const buffers = checkoutBuffersSignal.value;
  const parsed = {} as TenderedAmounts;
  for (const [index, method] of TENDERABLE_METHODS.entries()) {
    const raw = buffers[method];
    if (raw.trim() === '') {
      parsed[method] = 0;
      continue;
    }
    const value = parseNonNegativeAmount(raw);
    if (value === undefined) {
      return err('sale/invalid-payment-amount', { index });
    }
    parsed[method] = value;
  }
  return ok(parsed);
}

/** Esc: si había un hold aprobado sin usar, lo libera (best-effort, RF-19/§5). */
export function cancelCheckout(): void {
  const pendingHold = pendingHoldSignal.value;
  if (pendingHold !== undefined) {
    void releaseAccountHold({ holdId: pendingHold.holdId });
  }
  resetCheckout();
  activeScreenSignal.value = 'sale';
}

/**
 * Resuelve el pago de "Cuenta corriente" para `amount` (RF-17/18): reusa un
 * hold ya aprobado si el monto no cambió desde el intento anterior; si
 * cambió, libera ese hold (best-effort) y pide uno nuevo. Con red, pide un
 * hold síncrono contra el saldo real; sin red, evalúa el crédito disponible
 * cacheado. Nunca pasa por el outbox — la única operación de este tipo (ver
 * §5 del diseño).
 */
async function resolveAccountReference(amount: number): Promise<Result<string | undefined>> {
  const customer = attachedCustomerSignal.value;
  if (customer === undefined) {
    return err('account/no-customer-attached', undefined);
  }

  const existing = pendingHoldSignal.value;
  if (existing !== undefined && existing.customerId === customer.id && existing.amount === amount) {
    return ok(existing.holdId);
  }
  if (existing !== undefined) {
    void releaseAccountHold({ holdId: existing.holdId });
    pendingHoldSignal.value = undefined;
  }

  if (navigator.onLine) {
    const holdResult = await requestAccountHoldNow({
      customerId: customer.id,
      amount,
      idempotencyKey: newId(),
    });
    if (!holdResult.ok) {
      return holdResult;
    }
    if (!holdResult.value.approved) {
      return err('account/hold-rejected', { reasonCode: holdResult.value.reasonCode });
    }
    pendingHoldSignal.value = { holdId: holdResult.value.holdId, customerId: customer.id, amount };
    return ok(holdResult.value.holdId);
  }

  const account = await getCustomerRepository().getCustomerAccount(customer.id);
  if (account === undefined || !canChargeOffline(account, amount)) {
    const missing = account === undefined ? amount : amount - availableCredit(account);
    return err('account/offline-limit-exceeded', { missing });
  }
  return ok(undefined);
}

function attachReference(payments: Payment[], reference: string | undefined): Payment[] {
  if (reference === undefined) {
    return payments;
  }
  return payments.map((payment) => (payment.method === 'account' ? { ...payment, reference } : payment));
}

/**
 * Ctrl+Enter en la pantalla de cobro: valida lo tipeado en los 6 campos,
 * resuelve cuenta corriente si corresponde, y cierra la venta si con eso se
 * cubre el total — nunca antes (RNF-04, el menor número de pasos posible,
 * pero sin cerrar una venta a medio pagar).
 */
export async function submitCheckout(): Promise<void> {
  const tenderResult = parsedTenderOrError();
  if (!tenderResult.ok) {
    checkoutErrorSignal.value = describeError(tenderResult);
    return;
  }

  const { total } = calculateTotals(cartSignal.value);
  const resolved = resolveTender(tenderResult.value, total);
  if (!resolved.ok) {
    checkoutErrorSignal.value = describeError(resolved);
    return;
  }

  const accountAmount = tenderResult.value.account;
  let accountReference: string | undefined;
  if (accountAmount > 0) {
    const accountResult = await resolveAccountReference(accountAmount);
    if (!accountResult.ok) {
      checkoutErrorSignal.value = describeError(accountResult);
      return;
    }
    accountReference = accountResult.value;
  }

  const payments = attachReference(resolved.value.payments, accountReference);
  const customer = attachedCustomerSignal.value;
  const pendingHold = pendingHoldSignal.value;
  const result = await closeSaleAndPersist({
    cart: cartSignal.value,
    payments,
    ...(customer !== undefined ? { customerId: customer.id } : {}),
    ...(pendingHold !== undefined ? { pendingHold: { holdId: pendingHold.holdId } } : {}),
  });
  if (!result.ok) {
    checkoutErrorSignal.value = describeError(result);
    return;
  }

  receiptSaleSignal.value = result.value;
  receiptChangeSignal.value = resolved.value.change;
  cartSignal.value = { lines: [] };
  resetAttachedCustomer();
  resetCheckout();
  activeScreenSignal.value = 'receipt';
}
```

- [ ] **Step 2: Reescribir `src/ui/keyboard/checkout-controller.test.ts`**

```ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerAccount } from '../../domain/customer.ts';
import { openCashSessionAndPersist } from '../../storage/cash-session-repository.ts';
import { db } from '../../storage/db.ts';
import { saveSyncConfig } from '../../sync/config.ts';
import { cartSignal } from '../state/cart.ts';
import { checkoutBuffersSignal, checkoutErrorSignal, pendingHoldSignal } from '../state/checkout.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { receiptChangeSignal, receiptSaleSignal } from '../state/receipt.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { amountTendered, cancelCheckout, submitCheckout } from './checkout-controller.ts';

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

function fakeCustomerRepository(account: CustomerAccount | undefined): void {
  setCustomerRepository({
    search: () => [],
    listRecent: () => [],
    getCustomer: () => undefined,
    getCustomerAccount: () => Promise.resolve(account),
  });
}

function emptyBuffers() {
  return { cash: '', debit: '', credit: '', transfer: '', qr: '', account: '' };
}

beforeEach(async () => {
  await db.open();
  await db.products.add({
    id: 'p1',
    sku: 'SKU-1',
    barcodes: ['111'],
    name: 'Arroz 1kg',
    price: 100,
    taxRate: 0.21,
    category: 'almacen',
    tracksStock: true,
  });
  await db.stock.add({ productId: 'p1', quantity: 10, updatedAt: '2026-01-01T00:00:00.000Z' });
  // Fase 6: closeSaleAndPersist exige un turno de caja abierto.
  await openCashSessionAndPersist({ openingAmount: 0 });

  cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] };
  checkoutBuffersSignal.value = emptyBuffers();
  checkoutErrorSignal.value = null;
  pendingHoldSignal.value = undefined;
  attachedCustomerSignal.value = undefined;
  receiptSaleSignal.value = null;
  receiptChangeSignal.value = 0;
  activeScreenSignal.value = 'checkout';
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  setOnline(true);
  vi.unstubAllGlobals();
});

describe('amountTendered', () => {
  it('suma lo tipeado en todos los campos, tratando texto inválido como 0', () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '100', debit: 'abc', credit: '50' };

    expect(amountTendered()).toBe(150);
  });
});

describe('submitCheckout', () => {
  it('con el total exacto en efectivo, cierra la venta sin vuelto', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '200' };

    await submitCheckout();

    expect(receiptSaleSignal.value?.status).toBe('closed');
    expect(receiptSaleSignal.value?.payments).toEqual([{ method: 'cash', amount: 200 }]);
    expect(receiptChangeSignal.value).toBe(0);
    expect(cartSignal.value.lines).toEqual([]);
    expect(activeScreenSignal.value).toBe('receipt');
  });

  it('con efectivo de más, guarda el neto y calcula el vuelto (resuelve el bug #48)', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '300' };

    await submitCheckout();

    expect(receiptSaleSignal.value?.payments).toEqual([{ method: 'cash', amount: 200 }]);
    expect(receiptChangeSignal.value).toBe(100);
  });

  it('combina débito y efectivo', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), debit: '150', cash: '50' };

    await submitCheckout();

    expect(receiptSaleSignal.value?.payments).toEqual([
      { method: 'debit', amount: 150 },
      { method: 'cash', amount: 50 },
    ]);
  });

  it('no cubre el total: muestra error y no cierra la venta', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '100' };

    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(activeScreenSignal.value).toBe('checkout');
    expect(receiptSaleSignal.value).toBeNull();
  });

  it('un medio no-efectivo que supera el total: muestra error y no cierra', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), debit: '300' };

    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(activeScreenSignal.value).toBe('checkout');
  });

  it('un campo con texto inválido: muestra error', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: 'abc' };

    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
  });
});

describe('cuenta corriente', () => {
  const customer = { id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' };

  it('sin cliente adjunto, rechaza con account/no-customer-attached', async () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), account: '200' };

    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(receiptSaleSignal.value).toBeNull();
  });

  it('con red y hold aprobado, cierra la venta a cuenta corriente', async () => {
    attachedCustomerSignal.value = customer;
    saveSyncConfig({ baseUrl: 'https://api.example.com' });
    setOnline(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ approved: true, holdId: 'hold-1' }),
      }),
    );

    checkoutBuffersSignal.value = { ...emptyBuffers(), account: '200' };
    await submitCheckout();

    expect(receiptSaleSignal.value?.payments).toEqual([
      { method: 'account', amount: 200, reference: 'hold-1' },
    ]);
    expect(receiptSaleSignal.value?.customerId).toBe('c1');
  });

  it('con red y hold rechazado, muestra el error y no cierra la venta', async () => {
    attachedCustomerSignal.value = customer;
    saveSyncConfig({ baseUrl: 'https://api.example.com' });
    setOnline(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ approved: false, reasonCode: 'over-limit' }),
      }),
    );

    checkoutBuffersSignal.value = { ...emptyBuffers(), account: '200' };
    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(activeScreenSignal.value).toBe('checkout');
  });

  it('sin red y dentro del margen, cierra la venta a cuenta corriente', async () => {
    attachedCustomerSignal.value = customer;
    setOnline(false);
    fakeCustomerRepository({
      customerId: 'c1',
      creditLimit: 1000,
      margin: 0,
      balance: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    checkoutBuffersSignal.value = { ...emptyBuffers(), account: '200' };
    await submitCheckout();

    expect(receiptSaleSignal.value?.payments).toEqual([{ method: 'account', amount: 200 }]);
  });

  it('sin red y fuera del margen, rechaza con account/offline-limit-exceeded', async () => {
    attachedCustomerSignal.value = customer;
    setOnline(false);
    fakeCustomerRepository({
      customerId: 'c1',
      creditLimit: 100,
      margin: 0,
      balance: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    checkoutBuffersSignal.value = { ...emptyBuffers(), account: '200' };
    await submitCheckout();

    expect(checkoutErrorSignal.value).not.toBeNull();
    expect(activeScreenSignal.value).toBe('checkout');
  });
});

describe('cancelCheckout', () => {
  it('vuelve a la pantalla de venta sin persistir nada', () => {
    checkoutBuffersSignal.value = { ...emptyBuffers(), cash: '50' };

    cancelCheckout();

    expect(activeScreenSignal.value).toBe('sale');
    expect(checkoutBuffersSignal.value).toEqual(emptyBuffers());
  });

  it('con un hold pendiente, lo libera (encola account-hold-release)', async () => {
    pendingHoldSignal.value = { holdId: 'hold-1', customerId: 'c1', amount: 200 };

    cancelCheckout();
    await vi.waitFor(async () => {
      expect(await db.outbox.count()).toBe(1);
    });

    const event = (await db.outbox.toArray())[0];
    expect(event).toMatchObject({ type: 'account-hold-release', holdId: 'hold-1' });
  });
});
```

- [ ] **Step 3: Correr los tests**

Run: `pnpm exec vitest run src/ui/keyboard/checkout-controller.test.ts`
Expected: PASS (todos los `describe` de arriba)

- [ ] **Step 4: Typecheck completo**

Run: `pnpm typecheck`
Expected: FAIL solo en `ui/screens/checkout-screen.tsx`/`.test.tsx` (Task 7 los arregla) — todo lo demás ya debería compilar.

- [ ] **Step 5: Commit**

```bash
git add src/ui/keyboard/checkout-controller.ts src/ui/keyboard/checkout-controller.test.ts
git commit -m "feat(ui): checkout-controller resuelve el cobro multi-medio al confirmar"
```

---

### Task 7: Pantalla de cobro como diálogo modal

**Files:**
- Modify: `src/ui/screens/checkout-screen.tsx` (reescritura completa)
- Modify: `src/ui/screens/checkout-screen.test.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `TENDERABLE_METHODS`/`checkoutBuffersSignal`/`checkoutErrorSignal` (Task 5), `amountTendered`/`changePreview`/`submitCheckout`/`cancelCheckout` (Task 6), `PAYMENT_METHOD_LABELS` (Task 3).

- [ ] **Step 1: Reescribir `src/ui/screens/checkout-screen.tsx`**

```tsx
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import type { PaymentMethod } from '../../domain/sale.ts';
import { calculateTotals } from '../../domain/totals.ts';
import { formatMoney } from '../format.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { useSelectOnErrorSignal } from '../hooks/use-select-on-error.ts';
import { amountTendered, cancelCheckout, changePreview, submitCheckout } from '../keyboard/checkout-controller.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';
import { cartSignal } from '../state/cart.ts';
import { checkoutBuffersSignal, checkoutErrorSignal, TENDERABLE_METHODS } from '../state/checkout.ts';
import { attachedCustomerSignal } from '../state/customer.ts';

const overlayStyle = {
  height: 'var(--app-height)',
  overflowY: 'auto' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-4)',
  background: 'var(--color-surface)',
};

const dialogStyle = {
  width: '100%',
  maxWidth: '720px',
  background: 'var(--color-bg)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-4)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-3)',
  color: 'var(--color-text)',
  fontFamily: 'var(--font-sans)',
};

const fieldRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--space-3)',
};

const fieldInputStyle = {
  width: '160px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-base)',
  padding: 'var(--space-2)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  textAlign: 'right' as const,
};

const cardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-2)',
};

const rowStyle = { display: 'flex', justifyContent: 'space-between' };

const sectionLabelStyle = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.04em',
};

/**
 * Pantalla de cobro (`/COBRAR` o `Ctrl+Enter`) — diálogo modal con un campo
 * de monto simultáneo por medio de pago (issue #55, sesión de brainstorming
 * 2026-09-16). A diferencia del resto de la app, acá Enter solo no confirma
 * nada (moverse entre campos con Tab es el flujo normal de un formulario
 * con varios campos) — Ctrl+Enter confirma el cobro completo, Esc cancela.
 * La validación (falta cubrir el total, un medio no-efectivo excedido) pasa
 * recién al confirmar, nunca mientras se tipea.
 */
export function CheckoutScreen() {
  const firstFieldRef = useFocusOnMount<HTMLInputElement>();
  useSelectOnErrorSignal(firstFieldRef, checkoutErrorSignal);

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelCheckout();
      return;
    }
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      void submitCheckout();
    }
  };

  const handleInput = (method: PaymentMethod) => (event: TargetedEvent<HTMLInputElement>) => {
    checkoutBuffersSignal.value = {
      ...checkoutBuffersSignal.value,
      [method]: event.currentTarget.value,
    };
    checkoutErrorSignal.value = null;
  };

  const totals = calculateTotals(cartSignal.value);
  const paid = amountTendered();
  const change = changePreview();
  const hasCustomer = attachedCustomerSignal.value !== undefined;

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Cobrar venta</h1>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {TENDERABLE_METHODS.map((method, index) => {
              const disabled = method === 'account' && !hasCustomer;
              return (
                <label key={method} style={fieldRowStyle}>
                  <span>{PAYMENT_METHOD_LABELS[method]}</span>
                  <input
                    ref={index === 0 ? firstFieldRef : undefined}
                    type="text"
                    inputMode="decimal"
                    value={checkoutBuffersSignal.value[method]}
                    onInput={handleInput(method)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    placeholder="$ 0,00"
                    aria-label={PAYMENT_METHOD_LABELS[method]}
                    style={{ ...fieldInputStyle, opacity: disabled ? 0.5 : 1 }}
                  />
                </label>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={cardStyle}>
              <div style={sectionLabelStyle}>Total a pagar</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xl)', fontWeight: 'bold' }}>
                {formatMoney(totals.total)}
              </div>
              <div style={rowStyle}>
                <span>Cantidad de ítems</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{cartSignal.value.lines.length}</span>
              </div>
              <div style={rowStyle}>
                <span>Suma de pagos</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(paid)}</span>
              </div>
            </div>
            <div style={cardStyle}>
              <div style={sectionLabelStyle}>Vuelto</div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--font-size-xl)',
                  color: 'var(--color-success)',
                }}
              >
                {formatMoney(change)}
              </div>
            </div>
          </div>
        </div>

        <div style={{ minHeight: 'var(--space-8)' }}>
          {checkoutErrorSignal.value !== null && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
              {checkoutErrorSignal.value}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            Ctrl+Enter para confirmar, Esc para cancelar.
            {!hasCustomer && ' Adjuntá un cliente con @ para habilitar cuenta corriente.'}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              onClick={cancelCheckout}
              style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)' }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void submitCheckout()}
              style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)' }}
            >
              Confirmar Cobro
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Reescribir `src/ui/screens/checkout-screen.test.tsx`**

```tsx
import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { CheckoutScreen } from './checkout-screen.tsx';
import { cartSignal } from '../state/cart.ts';
import { checkoutBuffersSignal, checkoutErrorSignal } from '../state/checkout.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { activeScreenSignal } from '../state/screen.ts';

function emptyBuffers() {
  return { cash: '', debit: '', credit: '', transfer: '', qr: '', account: '' };
}

beforeEach(() => {
  cartSignal.value = { lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 100 }] };
  checkoutBuffersSignal.value = emptyBuffers();
  checkoutErrorSignal.value = null;
  attachedCustomerSignal.value = undefined;
  activeScreenSignal.value = 'checkout';
});

describe('CheckoutScreen', () => {
  it('muestra el total del carrito', () => {
    render(<CheckoutScreen />);
    expect(screen.getByText('Total a pagar')).not.toBeNull();
  });

  it('muestra un campo por cada medio de pago', () => {
    render(<CheckoutScreen />);
    expect(screen.getByLabelText('Efectivo')).not.toBeNull();
    expect(screen.getByLabelText('Tarjeta de Débito')).not.toBeNull();
    expect(screen.getByLabelText('Tarjeta de Crédito')).not.toBeNull();
    expect(screen.getByLabelText('Transferencia')).not.toBeNull();
    expect(screen.getByLabelText('Código QR')).not.toBeNull();
    expect(screen.getByLabelText('Cuenta corriente')).not.toBeNull();
  });

  it('el campo Cuenta corriente está deshabilitado sin cliente adjunto', () => {
    render(<CheckoutScreen />);
    expect(screen.getByLabelText('Cuenta corriente')).toHaveProperty('disabled', true);
  });

  it('el campo Cuenta corriente se habilita con un cliente adjunto', () => {
    attachedCustomerSignal.value = { id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' };
    render(<CheckoutScreen />);
    expect(screen.getByLabelText('Cuenta corriente')).toHaveProperty('disabled', false);
  });

  it('Escape cancela el cobro y vuelve a la pantalla de venta', () => {
    render(<CheckoutScreen />);
    const input = screen.getByLabelText('Efectivo');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('Enter solo no confirma el cobro', () => {
    render(<CheckoutScreen />);
    const input = screen.getByLabelText('Efectivo');

    fireEvent.input(input, { target: { value: '100' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(activeScreenSignal.value).toBe('checkout');
  });

  it('Ctrl+Enter con un monto inválido muestra un error', () => {
    render(<CheckoutScreen />);
    const input = screen.getByLabelText('Efectivo');

    fireEvent.input(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });

    expect(screen.getByRole('alert')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Correr los tests**

Run: `pnpm exec vitest run src/ui/screens/checkout-screen.test.tsx`
Expected: PASS

- [ ] **Step 4: Typecheck y suite completa de unit tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/checkout-screen.tsx src/ui/screens/checkout-screen.test.tsx
git commit -m "feat(ui): CheckoutScreen como diálogo modal con 6 campos de medio simultáneos"
```

---

### Task 8: Actualizar el contrato del Connector API

**Files:**
- Modify: `docs/connector-api.openapi.yaml`

- [ ] **Step 1: Actualizar el enum de `Payment.method`**

Línea 363, cambiar:

```yaml
        method: { type: string, enum: [cash, card, other, account] }
```

por:

```yaml
        method: { type: string, enum: [cash, debit, credit, transfer, qr, account] }
```

- [ ] **Step 2: Commit**

```bash
git add docs/connector-api.openapi.yaml
git commit -m "docs(connector-api): actualizar el enum de Payment.method"
```

---

### Task 9: Actualizar los specs de Playwright

**Files:**
- Modify: `e2e/helpers.ts` (dos helpers nuevos)
- Modify: `e2e/offline-sale.spec.ts`
- Modify: `e2e/account-sale.spec.ts`
- Modify: `e2e/void-sale.spec.ts`
- Modify: `e2e/keyboard-only.spec.ts`
- Modify: `e2e/cash-session.spec.ts`
- Modify: `e2e/minibackend-sync.spec.ts`
- Modify: `e2e/cart-persistence.spec.ts`

**Interfaces:**
- Produces: `fillPayment(page, label, amount)`, `confirmCheckout(page)` en `e2e/helpers.ts` — reemplazan el patrón repetido `page.getByLabel('Monto a cobrar').fill(...); .press('Enter')` en los 7 specs de abajo.

- [ ] **Step 1: Agregar los helpers nuevos a `e2e/helpers.ts`**

Agregar al final del archivo:

```ts
/**
 * Tipea un monto en el campo de un medio de pago de la pantalla de Cobro ya
 * abierta — `label` es el texto exacto de `ui/payment-labels.ts`
 * (`PAYMENT_METHOD_LABELS`), ej. 'Efectivo', 'Cuenta corriente'.
 */
export async function fillPayment(page: Page, label: string, amount: number): Promise<void> {
  await page.getByLabel(label).fill(String(amount));
}

/** Ctrl+Enter en la pantalla de Cobro — confirma el cobro con lo tipeado en los campos. */
export async function confirmCheckout(page: Page): Promise<void> {
  await page.keyboard.press('Control+Enter');
}
```

- [ ] **Step 2: Actualizar `e2e/offline-sale.spec.ts`**

Cambiar el import:

```ts
import { openCashSession, seedCatalog } from './helpers.ts';
```

por:

```ts
import { confirmCheckout, fillPayment, openCashSession, seedCatalog } from './helpers.ts';
```

Reemplazar:

```ts
  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('1200');
  await amountInput.press('Enter');

  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
```

por:

```ts
  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);

  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
```

- [ ] **Step 3: Actualizar `e2e/account-sale.spec.ts`**

Cambiar el import:

```ts
import { openCashSession, seedCatalog } from './helpers.ts';
```

por:

```ts
import { confirmCheckout, fillPayment, openCashSession, seedCatalog } from './helpers.ts';
```

En el primer test ("cierra la venta"), reemplazar:

```ts
  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('/CUENTA');
  await amountInput.press('Enter');

  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
```

por:

```ts
  await fillPayment(page, 'Cuenta corriente', 1200);
  await confirmCheckout(page);

  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
```

En el segundo test ("rechaza el cobro"), reemplazar:

```ts
  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('/CUENTA');
  await amountInput.press('Enter');

  await expect(page.getByRole('alert')).toBeVisible();
```

por:

```ts
  await fillPayment(page, 'Cuenta corriente', 1200);
  await confirmCheckout(page);

  await expect(page.getByRole('alert')).toBeVisible();
```

- [ ] **Step 4: Actualizar `e2e/void-sale.spec.ts`**

Cambiar el import:

```ts
import { openCashSession, seedCatalog } from './helpers.ts';
```

por:

```ts
import { confirmCheckout, fillPayment, openCashSession, seedCatalog } from './helpers.ts';
```

En `closeOneSale`, reemplazar:

```ts
  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('1200');
  await amountInput.press('Enter');
```

por:

```ts
  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
```

- [ ] **Step 5: Actualizar `e2e/keyboard-only.spec.ts`**

Cambiar el import:

```ts
import { openCashSession, seedCatalog } from './helpers.ts';
```

por:

```ts
import { confirmCheckout, fillPayment, openCashSession, seedCatalog } from './helpers.ts';
```

En el test "venta → cobrar → Comprobante → Esc", reemplazar:

```ts
  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('1200');
  await amountInput.press('Enter');
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
```

por:

```ts
  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
```

- [ ] **Step 6: Actualizar `e2e/cash-session.spec.ts`**

Mismo cambio de import y reemplazo que el Step 5 (una sola ocurrencia, en el primer test).

- [ ] **Step 7: Actualizar `e2e/minibackend-sync.spec.ts`**

Cambiar el import:

```ts
import { openCashSession } from './helpers.ts';
```

por:

```ts
import { confirmCheckout, fillPayment, openCashSession } from './helpers.ts';
```

Reemplazar:

```ts
  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('1200');
  await amountInput.press('Enter');
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
```

por:

```ts
  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
```

- [ ] **Step 8: Actualizar `e2e/cart-persistence.spec.ts`**

Cambiar el import:

```ts
import { openCashSession, seedCatalog } from './helpers.ts';
```

por:

```ts
import { confirmCheckout, fillPayment, openCashSession, seedCatalog } from './helpers.ts';
```

En el segundo test, reemplazar:

```ts
  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('1200');
  await amountInput.press('Enter');
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
```

por:

```ts
  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
```

- [ ] **Step 9: Build y correr toda la suite de e2e**

Run: `pnpm build && pnpm exec playwright test`
Expected: PASS (todos los specs, incluido `minibackend-sync.spec.ts` si el minibackend de demo está levantado — ver `README.md`/`demo-backend/` para cómo levantarlo local)

- [ ] **Step 10: Commit**

```bash
git add e2e/helpers.ts e2e/offline-sale.spec.ts e2e/account-sale.spec.ts e2e/void-sale.spec.ts e2e/keyboard-only.spec.ts e2e/cash-session.spec.ts e2e/minibackend-sync.spec.ts e2e/cart-persistence.spec.ts
git commit -m "test(e2e): actualizar specs para el modal de cobro multi-medio"
```

---

### Task 10: Documentar el ciclo en CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Agregar la entrada del ciclo**

Agregar un párrafo nuevo en la sección "Estado del proyecto", después de la lista de ciclos post-Fase 4/6, describiendo: rediseño de Cobro como diálogo modal con 6 medios de pago simultáneos (efectivo/débito/crédito/transferencia/QR/cuenta corriente), `domain/tender.ts::resolveTender` como función pura que resuelve el vuelto (solo efectivo puede exceder), y que esto cierra #48/#50/#55 (consolidadas en #55 en la sesión de brainstorming previa a este plan). Mencionar también las dos issues de backlog que salieron de esa sesión (#59 cobranza de cuenta corriente, #60 advertencia de vuelto por denominación de billete) para que quede el rastro de dónde salieron.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: documentar el rediseño de Cobro multi-medio en CLAUDE.md"
```

---

### Task 11: Verificación final

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Suite completa de unit tests**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 4: Suite completa de e2e**

Run: `pnpm build && pnpm exec playwright test`
Expected: PASS

- [ ] **Step 5: Verificación manual en el navegador**

Levantar `pnpm dev`, abrir la app, `/CAJA` para abrir turno, agregar un producto, `Ctrl+Enter`, y probar a mano: (a) efectivo exacto cierra sin vuelto; (b) efectivo de más muestra vuelto y el comprobante lo refleja; (c) combinar débito + efectivo cierra bien; (d) tipear de más en débito sin cubrir con efectivo da error al confirmar; (e) cuenta corriente aparece deshabilitada sin cliente adjunto y se habilita con `@<cliente>`; (f) Esc cancela sin persistir nada; (g) Tab navega los 6 campos en orden.
