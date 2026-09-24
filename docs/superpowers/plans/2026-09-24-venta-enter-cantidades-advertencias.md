# Venta: Enter, cantidades, advertencias, anulación como ticket y contrato 4.0.0 — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. En este repo se ejecuta **inline** con executing-plans, con un resumen por tarea.

**Goal:** Etapa 4 del epic #94 (#99): cobrar con Enter, cantidades decimales y negativas, advertencias en vez de bloqueos, la anulación como ticket negativo, y el contrato 4.0.0 con `GET /info` y la versión en cada request.

**Architecture:** El dominio puro absorbe las reglas nuevas (redondeo, carrito, cierre, devolución, anulación, advertencias, compatibilidad de contrato); `storage/` persiste la anulación como una venta más; `sync/` suma un chequeo de estado del backend que gatea los ciclos sin bloquear la venta; los tres conectores y el minibackend hablan 4.0.0.

**Tech Stack:** Preact + `@preact/signals`, Dexie, Zod, Vitest + Testing Library, Playwright, Node `node:sqlite` (minibackend), Apps Script (`bridge.gs`).

**Spec:** `docs/superpowers/specs/2026-09-24-venta-enter-cantidades-advertencias-design.md`

## Global Constraints

- TypeScript estricto: sin `any`; `unknown` solo en el borde y validado con Zod en la línea siguiente.
- Funciones de negocio devuelven `Result<T>`, nunca lanzan. Todo `ErrorCode` nuevo se traduce en `ui/errors.ts` (el `switch` exhaustivo no compila si falta).
- `exactOptionalPropertyTypes`: los opcionales se omiten, nunca `undefined` explícito.
- Cantidades: con signo, hasta 3 decimales, separador `,` o `.`. Importes a 2 decimales. Redondeo solo en `domain/rounding.ts`.
- Contrato: `POS_CONTRACT_VERSION = '4.0.0'`; header `X-POS-Contract-Version`; `409 { code: "incompatible-contract", contractVersion }`.
- Ventana de anulación: 24 h móviles; tope de 20 tickets.
- El POS nunca bloquea la venta: advertencias, backend incompatible o en mantenimiento solo se informan.
- Patrón teclado + mouse (CLAUDE.md, "Teclado y mouse"): `keepFocusOnMouseDown`, botón con el atajo en la etiqueta, `.btn`/`.btn-primary`/`.btn-danger`.
- Textos de UI, comentarios y commits en español. Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comandos: `pnpm test -- <ruta>` (Vitest), `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` (Playwright, contra el build). Minibackend: `pnpm test:backend` y `pnpm typecheck:backend`.

---

### Task 1: Redondeo en un solo lugar y totales redondeados

**Files:**
- Create: `src/domain/rounding.ts`, `src/domain/rounding.test.ts`
- Modify: `src/domain/reapply.ts` (importa de `rounding.ts`, borra sus copias), `src/domain/totals.ts`, `src/domain/totals.test.ts`

**Interfaces:**
- Produces: `roundQuantity(value: number): number`, `roundAmount(value: number): number`, `hasAtMostThreeDecimals(value: number): boolean` (en `domain/rounding.ts`). `calculateTotals`/`calculateLineTotal` devuelven importes redondeados a 2.

- [ ] **Step 1: tests que fallan**

`src/domain/rounding.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { hasAtMostThreeDecimals, roundAmount, roundQuantity } from './rounding.ts';

describe('rounding', () => {
  it('roundQuantity a 3 decimales, sin arrastre de coma flotante', () => {
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
    expect(roundQuantity(-1.0005)).toBe(-1);
    expect(roundQuantity(5.9510000000000005)).toBe(5.951);
  });
  it('roundAmount a 2 decimales', () => {
    expect(roundAmount(10.005)).toBe(10.01);
    expect(roundAmount(-3.333)).toBe(-3.33);
  });
  it('hasAtMostThreeDecimals', () => {
    expect(hasAtMostThreeDecimals(1.25)).toBe(true);
    expect(hasAtMostThreeDecimals(-0.125)).toBe(true);
    expect(hasAtMostThreeDecimals(1.2345)).toBe(false);
    expect(hasAtMostThreeDecimals(Number.NaN)).toBe(false);
  });
});
```

En `src/domain/totals.test.ts`, agregar:
```typescript
it('redondea cada campo a 2 decimales y el total suma lo que se ve', () => {
  const cart = {
    lines: [{ kind: 'freeform' as const, description: 'x', qty: 0.333, unitPrice: 10 }],
    globalAdjustmentPercentage: 10,
  };
  const totals = calculateTotals(cart);
  expect(totals.subtotal).toBe(3.33);
  expect(totals.globalAdjustmentAmount).toBe(0.33);
  expect(totals.total).toBe(3.66);
});
it('una línea negativa con descuento porcentual devuelve menos', () => {
  const line = {
    kind: 'freeform' as const,
    description: 'x',
    qty: -2,
    unitPrice: 100,
    discount: { type: 'percentage' as const, value: 10 },
  };
  expect(calculateLineTotal(line)).toBe(-180);
});
it('descuento por monto sobre una línea negativa conserva el signo', () => {
  const line = {
    kind: 'freeform' as const,
    description: 'x',
    qty: -1,
    unitPrice: 100,
    discount: { type: 'amount' as const, value: 30 },
  };
  expect(calculateLineTotal(line)).toBe(-70);
});
```

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/rounding.test.ts src/domain/totals.test.ts`

- [ ] **Step 3: implementar**

`src/domain/rounding.ts`:
```typescript
/**
 * Único lugar donde se redondea en el dominio (epic #94, Etapa 4 — #99):
 * cantidades a 3 decimales (se vende por peso), importes a 2.
 */
export function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Lo que tipea el cajero nunca se redondea en silencio: más de 3 decimales es un error. */
export function hasAtMostThreeDecimals(value: number): boolean {
  return Number.isFinite(value) && Math.abs(roundQuantity(value) - value) < 1e-9;
}
```

`src/domain/reapply.ts`: borrar `roundQuantity`/`roundAmount` locales y agregar `import { roundAmount, roundQuantity } from './rounding.ts';` (buscar otros importadores con `grep -rn "roundQuantity\|roundAmount" src` y apuntarlos a `rounding.ts`).

`src/domain/totals.ts`: reemplazar `discountAmount`, `calculateLineTotal` y `calculateTotals`:
```typescript
function discountAmount(discount: Discount | undefined, lineSubtotal: number): number {
  if (discount === undefined) {
    return 0;
  }
  // Sobre el valor absoluto, con el signo de la línea: una línea negativa con descuento devuelve menos.
  const magnitude = Math.abs(lineSubtotal);
  const amount =
    discount.type === 'amount' ? discount.value : magnitude * (discount.value / 100);
  return Math.sign(lineSubtotal) * Math.min(amount, magnitude);
}

/** Total de una línea individual, ya con su descuento aplicado (si tiene), a 2 decimales. */
export function calculateLineTotal(line: SaleLine): number {
  const lineSubtotal = line.unitPrice * line.qty;
  return roundAmount(lineSubtotal - discountAmount(line.discount, lineSubtotal));
}

export function calculateTotals(cart: Cart): Totals {
  let subtotal = 0;
  let discountTotal = 0;
  for (const line of cart.lines) {
    const lineSubtotal = line.unitPrice * line.qty;
    subtotal += lineSubtotal;
    discountTotal += discountAmount(line.discount, lineSubtotal);
  }
  const roundedSubtotal = roundAmount(subtotal);
  const roundedDiscount = roundAmount(discountTotal);
  const net = roundedSubtotal - roundedDiscount;
  const globalAdjustmentAmount =
    cart.globalAdjustmentPercentage !== undefined
      ? roundAmount(net * (cart.globalAdjustmentPercentage / 100))
      : 0;
  return {
    subtotal: roundedSubtotal,
    discountTotal: roundedDiscount,
    globalAdjustmentAmount,
    total: roundAmount(net + globalAdjustmentAmount),
  };
}
```
(con `import { roundAmount } from './rounding.ts';`). Nota: `discountTotal` queda con el signo de las líneas (negativo para líneas negativas); la tarjeta de totales lo muestra tal cual.

- [ ] **Step 4: correr** `pnpm test -- src/domain` → PASS (ajustar tests viejos de totales si esperaban coma flotante sin redondear).

- [ ] **Step 5: commit** `feat(domain): redondeo en un solo lugar y totales a 2 decimales (#99)`

---

### Task 2: Carrito con cantidades decimales y negativas, sin bloqueo de stock

**Files:**
- Modify: `src/domain/cart.ts`, `src/domain/cart.test.ts`, `src/domain/result.ts`, `src/ui/errors.ts`, `src/ui/keyboard/command-bar-controller.ts` (callers), tests que usen `sale/insufficient-stock` o `cart/nothing-to-subtract` (`grep -rn` y ajustar).

**Interfaces:**
- Consumes: `roundQuantity`, `hasAtMostThreeDecimals` (Task 1).
- Produces:
  - `addProductLine(cart, { product: Product; qty: number }): Result<Cart>` (sin `stock`).
  - `addFreeformLine(cart, { description, unitPrice, qty })` con `qty` ≠ 0 de cualquier signo.
  - `adjustFreeformLineQuantity(cart, { description, qty })`.
  - `setLineQuantity(cart, lineIndex, qty): Result<Cart>` (sin `params`; `qty === 0` borra).
  - Salen de `ErrorMeta`: `sale/insufficient-stock`, `cart/nothing-to-subtract`.

- [ ] **Step 1: tests que fallan** (en `cart.test.ts`, reemplazando los casos de stock y de "nothing to subtract"):
```typescript
describe('cantidades decimales y negativas (#99)', () => {
  const product = { id: 'p1', sku: 'S1', barcodes: [], name: 'Queso', price: 1000, taxRate: 0, category: 'c', tracksStock: true };
  it('suma neta con decimales', () => {
    const r1 = addProductLine({ lines: [] }, { product, qty: 0.1 });
    if (!r1.ok) throw new Error();
    const r2 = addProductLine(r1.value, { product, qty: 0.2 });
    expect(r2.ok && r2.value.lines[0]?.qty).toBe(0.3);
  });
  it('crea la línea en negativo sin línea previa', () => {
    const r = addProductLine({ lines: [] }, { product, qty: -2 });
    expect(r.ok && r.value.lines[0]?.qty).toBe(-2);
  });
  it('puede dejar la línea en negativo y la borra en 0 exacto', () => {
    const r1 = addProductLine({ lines: [] }, { product, qty: 1 });
    if (!r1.ok) throw new Error();
    const r2 = addProductLine(r1.value, { product, qty: -3 });
    expect(r2.ok && r2.value.lines[0]?.qty).toBe(-2);
    const r3 = addProductLine(r1.value, { product, qty: -1 });
    expect(r3.ok && r3.value.lines).toEqual([]);
  });
  it('nunca bloquea por stock', () => {
    const r = addProductLine({ lines: [] }, { product, qty: 999 });
    expect(r.ok).toBe(true);
  });
  it('rechaza más de 3 decimales y 0', () => {
    expect(addProductLine({ lines: [] }, { product, qty: 1.2345 }).ok).toBe(false);
    expect(addProductLine({ lines: [] }, { product, qty: 0 }).ok).toBe(false);
  });
  it('línea libre con cantidad negativa', () => {
    const r = addFreeformLine({ lines: [] }, { description: 'regalo', unitPrice: 100, qty: -1 });
    expect(r.ok && r.value.lines[0]?.qty).toBe(-1);
  });
  it('ajuste de línea libre puede quedar negativo', () => {
    const r1 = addFreeformLine({ lines: [] }, { description: 'regalo', unitPrice: 100, qty: 1 });
    if (!r1.ok) throw new Error();
    const r2 = adjustFreeformLineQuantity(r1.value, { description: 'regalo', qty: -2 });
    expect(r2.ok && r2.value.lines[0]?.qty).toBe(-1);
  });
  it('setLineQuantity acepta decimales y negativos, y 0 borra', () => {
    const r1 = addProductLine({ lines: [] }, { product, qty: 1 });
    if (!r1.ok) throw new Error();
    expect(setLineQuantity(r1.value, 0, -1.5).ok && setLineQuantity(r1.value, 0, -1.5)).toMatchObject({ value: { lines: [{ qty: -1.5 }] } });
    const r3 = setLineQuantity(r1.value, 0, 0);
    expect(r3.ok && r3.value.lines).toEqual([]);
  });
});
```

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/cart.test.ts`

- [ ] **Step 3: implementar** en `cart.ts`:
  - Helper:
    ```typescript
    function isValidQuantity(qty: number): boolean {
      return hasAtMostThreeDecimals(qty) && qty !== 0;
    }
    ```
  - `addProductLine(cart, { product, qty })`: si `!isValidQuantity(qty)` → `err('cart/invalid-quantity', { quantity: qty })`. `nextQty = roundQuantity(existingQty + qty)`. Si `nextQty === 0` y existe → splice; si existe → actualizar; si no existe → push con `qty: nextQty`. Sin chequeo de stock ni de "nothing to subtract". Actualizar el JSDoc: "Suma neta (#99): puede crear o dejar la línea en negativo; 0 exacto la borra. Nunca bloquea por stock: la advertencia es aparte (`domain/sale-warnings.ts`)".
  - `addFreeformLine`: validación de `qty` pasa a `!isValidQuantity(qty)` → `cart/invalid-freeform-line { field: 'qty' }`. `unitPrice` sigue `> 0`.
  - `adjustFreeformLineQuantity`: `isValidQuantity`; `nextQty = roundQuantity(existing.qty + qty)`; 0 borra; sin el chequeo `nextQty < 0`.
  - `setLineQuantity(cart, lineIndex, qty)`: línea inexistente → `cart/line-not-found`; `!hasAtMostThreeDecimals(qty)` → `cart/invalid-quantity`; `qty === 0` → `removeLine(cart, lineIndex)`; si no, reemplaza. Borrar `params` y los imports de `StockItem` que queden sin uso.
  - `applyLineDiscount`: el tope de `amount` pasa a `Math.abs(line.unitPrice * line.qty)`.
  - `result.ts`: borrar `'sale/insufficient-stock'` y `'cart/nothing-to-subtract'`. `ui/errors.ts`: borrar sus `case`, y cambiar el texto de `cart/invalid-quantity` a `Cantidad inválida: ${meta.quantity}. Usá hasta 3 decimales, distinta de 0.`.
  - `command-bar-controller.ts`: `addByProduct` llama `addProductLine(cartSignal.value, { product, qty })` (el `repo.getStock` queda, lo usa la advertencia en Task 7; por ahora borrarlo si queda sin uso); `doSetSelectedCartLineQuantity` pasa a `applyCartResult(setLineQuantity(cartSignal.value, index, qty))` para cualquier tipo de línea, y si la línea desaparece (qty 0) deja `cartSelectionIndexSignal` en `Math.min(index, newLength - 1)` o `null`, como `removeSelectedCartLine`.

- [ ] **Step 4: correr** `pnpm test -- src/domain src/ui/keyboard` y `pnpm typecheck` → PASS (ajustar tests viejos que esperaban el bloqueo de stock).

- [ ] **Step 5: commit** `feat(domain): cantidades decimales y negativas en el carrito, sin bloqueo por stock (#99, cierra #12)`

---

### Task 3: Barra de comandos — cantidades con signo y decimales

**Files:**
- Modify: `src/ui/keyboard/parse-command-bar.ts`, `src/ui/keyboard/parse-command-bar.test.ts`, `src/ui/components/CommandBarInput.tsx`, `src/ui/format.ts` (`formatQuantity`), `src/ui/components/CartView.tsx` (mostrar `formatQuantity(line.qty)`), tests del controller/componente.

**Interfaces:**
- Produces: `parseQuantityText(raw: string): { ok: true; qty: number } | { ok: false; reason: 'not-a-quantity' | 'too-many-decimals' }` exportada desde `parse-command-bar.ts`. `formatQuantity(qty)` con el separador del locale.

- [ ] **Step 1: tests que fallan** (`parse-command-bar.test.ts`):
```typescript
describe('cantidades (#99)', () => {
  it('prefijo con decimales y coma o punto', () => {
    expect(parseCommandBar('1,5*queso', { finalizing: true })).toEqual({ kind: 'search', query: 'queso', qty: 1.5 });
    expect(parseCommandBar('0.250*queso', { finalizing: true })).toEqual({ kind: 'search', query: 'queso', qty: 0.25 });
  });
  it('prefijo negativo con decimales y línea libre negativa', () => {
    expect(parseCommandBar('-2*coca', { finalizing: true })).toEqual({ kind: 'search', query: 'coca', qty: -2 });
    expect(parseCommandBar('-1*regalo$100', { finalizing: true })).toEqual({ kind: 'freeform-line', description: 'regalo', amount: 100, qty: -1 });
  });
  it('más de 3 decimales en el prefijo es error', () => {
    expect(parseCommandBar('1,2345*queso', { finalizing: true })).toEqual({ kind: 'parse-error', message: 'Hasta 3 decimales en la cantidad' });
  });
  it('parseQuantityText', () => {
    expect(parseQuantityText('-2')).toEqual({ ok: true, qty: -2 });
    expect(parseQuantityText('1,5')).toEqual({ ok: true, qty: 1.5 });
    expect(parseQuantityText('0')).toEqual({ ok: true, qty: 0 });
    expect(parseQuantityText('1,2345')).toEqual({ ok: false, reason: 'too-many-decimals' });
    expect(parseQuantityText('abc')).toEqual({ ok: false, reason: 'not-a-quantity' });
  });
});
```

- [ ] **Step 2: correr y ver que fallan.**

- [ ] **Step 3: implementar**
  - En `parse-command-bar.ts`:
    ```typescript
    const QUANTITY_PATTERN = /^-?\d+(?:[.,]\d+)?$/;

    /** Cantidad tipeada (#99): con signo, separador `,` o `.`, hasta 3 decimales. */
    export function parseQuantityText(
      raw: string,
    ): { ok: true; qty: number } | { ok: false; reason: 'not-a-quantity' | 'too-many-decimals' } {
      if (!QUANTITY_PATTERN.test(raw)) {
        return { ok: false, reason: 'not-a-quantity' };
      }
      const decimals = raw.split(/[.,]/)[1] ?? '';
      if (decimals.length > 3) {
        return { ok: false, reason: 'too-many-decimals' };
      }
      return { ok: true, qty: Number(raw.replace(',', '.')) };
    }
    ```
    y el prefijo: `const quantityMatch = /^(-?\d+(?:[.,]\d+)?)\*(.*)$/.exec(buffer);`. Si hay match, `parseQuantityText(quantityMatch[1])`; si `too-many-decimals` → `{ kind: 'parse-error', message: 'Hasta 3 decimales en la cantidad' }` (solo con `finalizing`; sin finalizing → `{ kind: 'typing' }`).
  - `CommandBarInput.tsx`: borrar `ONLY_DIGITS`. En Enter, con `cartSelectionIndexSignal.value !== null` y `buffer !== ''`: `const parsedQty = parseQuantityText(buffer)`; si `ok` → `void setSelectedCartLineQuantity(parsedQty.qty); commandBarBufferSignal.value = ''; return;`; si `too-many-decimals` → `commandBarErrorSignal.value = 'Hasta 3 decimales en la cantidad'; return;`; si `not-a-quantity` sigue a `submitCommandBar()`. Mover esa lógica a una función del controller `submitWithSelectedLine(buffer): boolean` si queda más clara.
  - `format.ts::formatQuantity`: `new Intl.NumberFormat(resolveLocale(), { maximumFractionDigits: 3 }).format(qty)`. `CartView.tsx`: la celda Cant. muestra `formatQuantity(line.qty)`.

- [ ] **Step 4: correr** `pnpm test -- src/ui` → PASS.

- [ ] **Step 5: commit** `feat(ui): cantidades con signo y decimales en la barra de comandos (#99)`

---

### Task 4: Cierre y cobro con total 0 o negativo (modo devolución)

**Files:**
- Modify: `src/domain/sale-lifecycle.ts` (`closeSale`), `src/domain/sale-lifecycle.test.ts`, `src/domain/tender.ts`, `src/domain/tender.test.ts`, `src/domain/result.ts`, `src/ui/errors.ts`

**Interfaces:**
- Produces: `resolveTender(tendered: TenderedAmounts, total: number): Result<{ payments: Payment[]; change: number }>` con tres modos; `ErrorMeta['sale/refund-amount-mismatch'] = { total: number; tendered: number }`. `tenderMode(total: number): 'charge' | 'refund' | 'zero'` exportada de `tender.ts`.

- [ ] **Step 1: tests que fallan**

`tender.test.ts`:
```typescript
describe('modo devolución (#99)', () => {
  const zero = { cash: 0, debit: 0, credit: 0, transfer: 0, qr: 0, account: 0 };
  it('total negativo: montos positivos → pagos negativos, suma exacta, sin vuelto', () => {
    const r = resolveTender({ ...zero, cash: 300, account: 200 }, -500);
    expect(r).toEqual({ ok: true, value: { payments: [{ method: 'account', amount: -200 }, { method: 'cash', amount: -300 }], change: 0 } });
  });
  it('total negativo con suma distinta es error', () => {
    const r = resolveTender({ ...zero, cash: 600 }, -500);
    expect(r).toMatchObject({ ok: false, error: 'sale/refund-amount-mismatch', meta: { total: -500, tendered: 600 } });
  });
  it('total 0 sin montos: sin pagos', () => {
    expect(resolveTender(zero, 0)).toEqual({ ok: true, value: { payments: [], change: 0 } });
  });
  it('total 0 con algún monto es error', () => {
    expect(resolveTender({ ...zero, cash: 10 }, 0)).toMatchObject({ ok: false, error: 'sale/refund-amount-mismatch' });
  });
});
```
`sale-lifecycle.test.ts`:
```typescript
it('cierra un ticket negativo con pagos negativos que suman exacto', () => {
  const cart = { lines: [{ kind: 'freeform' as const, description: 'dev', qty: -1, unitPrice: 500 }] };
  const r = closeSale({ cart, payments: [{ method: 'cash', amount: -500 }], id: 's1', createdAt: 'now' });
  expect(r.ok && r.value.total).toBe(-500);
});
it('rechaza un pago con signo distinto al total', () => {
  const cart = { lines: [{ kind: 'freeform' as const, description: 'dev', qty: -1, unitPrice: 500 }] };
  const r = closeSale({ cart, payments: [{ method: 'cash', amount: 500 }], id: 's1', createdAt: 'now' });
  expect(r).toMatchObject({ ok: false, error: 'sale/invalid-payment-amount' });
});
it('cierra un ticket en 0 sin pagos', () => {
  const cart = { lines: [
    { kind: 'freeform' as const, description: 'a', qty: 1, unitPrice: 100 },
    { kind: 'freeform' as const, description: 'b', qty: -1, unitPrice: 100 },
  ] };
  expect(closeSale({ cart, payments: [], id: 's1', createdAt: 'now' }).ok).toBe(true);
});
```

- [ ] **Step 2: correr y ver que fallan.**

- [ ] **Step 3: implementar**
  - `tender.ts`:
    ```typescript
    export type TenderMode = 'charge' | 'refund' | 'zero';

    export function tenderMode(total: number): TenderMode {
      return total > 0 ? 'charge' : total < 0 ? 'refund' : 'zero';
    }
    ```
    En `resolveTender`, al principio:
    ```typescript
    const mode = tenderMode(total);
    if (mode !== 'charge') {
      const tenderedTotal = roundAmount(TENDER_METHODS.reduce((sum, m) => sum + tendered[m], 0));
      if (tenderedTotal !== roundAmount(Math.abs(total))) {
        return err('sale/refund-amount-mismatch', { total, tendered: tenderedTotal });
      }
      const payments: Payment[] = [];
      for (const method of NON_CASH_METHODS) {
        if (tendered[method] > 0) payments.push({ method, amount: -tendered[method] });
      }
      if (tendered.cash > 0) payments.push({ method: 'cash', amount: -tendered.cash });
      return ok({ payments, change: 0 });
    }
    ```
    con `const TENDER_METHODS = ['cash', ...NON_CASH_METHODS] as const;`. En el camino `charge`, redondear `netCash` y `change` con `roundAmount`.
  - `closeSale`: reemplazar la validación de pagos por:
    ```typescript
    const { total } = calculateTotals(cart);
    const sign = Math.sign(total);
    const invalidPaymentIndex = payments.findIndex(
      (payment) => !Number.isFinite(payment.amount) || payment.amount === 0 || Math.sign(payment.amount) !== sign,
    );
    if (invalidPaymentIndex !== -1) {
      return err('sale/invalid-payment-amount', { index: invalidPaymentIndex });
    }
    ```
    (con total 0 cualquier pago da índice 0 → error). El chequeo de cobertura: `const paid = roundAmount(sum)`; si `total > 0 && paid < total` → `sale/insufficient-payment`; si `total < 0 && paid !== total` → `sale/refund-amount-mismatch { total, tendered: Math.abs(paid) }`. Actualizar el JSDoc (ya no "No re-valida stock: ya se validó..." → "Nunca valida stock: la falta de stock es una advertencia, #99").
  - `result.ts`: `'sale/refund-amount-mismatch': { total: number; tendered: number };`. `errors.ts`:
    ```typescript
    case 'sale/refund-amount-mismatch':
      return failure.meta.total === 0
        ? 'El ticket está en $0: no hay nada que cobrar ni devolver.'
        : `Lo que se devuelve (${formatMoney(failure.meta.tendered)}) tiene que ser exactamente ${formatMoney(Math.abs(failure.meta.total))}.`;
    ```

- [ ] **Step 4: correr** `pnpm test -- src/domain` → PASS.

- [ ] **Step 5: commit** `feat(domain): cierre y cobro de tickets en 0 y negativos (#99)`

---

### Task 5: Pantalla de Cobro — precarga, navegación, modo devolución y mouse

**Files:**
- Modify: `src/ui/screens/checkout-screen.tsx`, `src/ui/screens/checkout-screen.test.tsx`, `src/ui/keyboard/checkout-controller.ts`, `src/ui/keyboard/checkout-controller.test.ts`, `src/ui/state/checkout.ts`

**Interfaces:**
- Consumes: `tenderMode`, `resolveTender` (Task 4).
- Produces: `enterCheckout(): void` en `checkout-controller.ts` (precarga Efectivo con `|total|` formateado con el separador del locale, si el total ≠ 0) — lo llama `triggerCheckout` antes de cambiar de pantalla. `moveCheckoutField(from: PaymentMethod, direction: 1 | -1): PaymentMethod | undefined` (pura, saltea deshabilitados, sin ciclar).

- [ ] **Step 1: tests que fallan**
  - Controller: `enterCheckout` con carrito de total 1234.5 deja `checkoutBuffersSignal.value.cash === '1234,5'` bajo locale `es-AR` (usar el helper de locale que ya usan los tests de `parse-amount`); con total -500 deja `'500'`; con total 0 deja `''`. `moveCheckoutField('cash', 1)` → `'debit'`; `moveCheckoutField('qr', 1)` sin cliente → `undefined` (cuenta deshabilitada, no hay siguiente); `moveCheckoutField('debit', -1)` → `'cash'`; `moveCheckoutField('cash', -1)` → `undefined`.
  - `submitCheckout` con total negativo y `account: '200'` + `cash: '300'` y cliente adjunto: **no** llama `requestAccountHoldNow` (espiar el módulo con `vi.mock('../../sync/account-hold.ts')`) y cierra la venta con pagos `[-200 account, -300 cash]`.
  - Pantalla: al montar, el campo Efectivo tiene el foco y su texto seleccionado (`selectionStart === 0 && selectionEnd === value.length`); Enter en Efectivo mueve el foco a Débito; ↓ igual; ↑ en Débito vuelve a Efectivo; Enter en el último habilitado no mueve el foco; con total negativo el título es "Devolver $ 500,00" y no aparece la tarjeta Vuelto; el botón primario dice "Confirmar cobro (Ctrl+Enter)" y tiene clase `btn-primary`; el de cancelar "Cancelar (Esc)".

- [ ] **Step 2: correr y ver que fallan.**

- [ ] **Step 3: implementar**
  - `checkout-controller.ts`:
    ```typescript
    export function enterCheckout(): void {
      resetCheckout();
      const { total } = calculateTotals(cartSignal.value);
      if (total !== 0) {
        checkoutBuffersSignal.value = { ...checkoutBuffersSignal.value, cash: formatAmountInput(Math.abs(total)) };
      }
    }

    export function moveCheckoutField(from: PaymentMethod, direction: 1 | -1): PaymentMethod | undefined {
      const hasCustomer = attachedCustomerSignal.value !== undefined;
      const enabled = TENDERABLE_METHODS.filter((method) => method !== 'account' || hasCustomer);
      const index = enabled.indexOf(from);
      return index === -1 ? undefined : enabled[index + direction];
    }
    ```
    `formatAmountInput(value)` va en `ui/parse-amount.ts`: `String(value).replace('.', decimalSeparator(resolveLocale()))` (sin separador de miles, así `parseNonNegativeAmount` lo vuelve a leer).
    En `submitCheckout`: `const mode = tenderMode(total)`; resolver cuenta corriente (`resolveAccountReference`) **solo** si `mode === 'charge' && accountAmount > 0`; con `mode === 'refund' && accountAmount > 0` y sin cliente → `checkoutErrorSignal.value = describeError({ ok: false, error: 'account/no-customer-attached', meta: undefined })`. `changePreview` devuelve 0 si `mode !== 'charge'`.
  - `command-bar-controller.ts::triggerCheckout`: justo antes de `activeScreenSignal.value = 'checkout'`, llamar `enterCheckout()`.
  - `checkout-screen.tsx`:
    - Refs por medio: `const fieldRefs = useRef(new Map<PaymentMethod, HTMLInputElement>())`; el de Efectivo sigue siendo `useFocusOnMount`, y un `useLayoutEffect(() => firstFieldRef.current?.select(), [])` selecciona el texto precargado.
    - `handleKeyDown(method)`: Esc → `cancelCheckout()`; Ctrl+Enter → `submitCheckout()`; Enter o ↓ → `focusField(moveCheckoutField(method, 1))`; ↑ → `focusField(moveCheckoutField(method, -1))`, con `event.preventDefault()`. `focusField(target)` hace `fieldRefs.current.get(target)?.focus()` y `.select()`.
    - Título: `mode === 'refund' ? \`Devolver ${formatMoney(Math.abs(totals.total))}\` : 'Cobrar venta'`; la tarjeta "Vuelto" solo con `mode === 'charge'`; con `refund` la tarjeta principal dice "Total a devolver".
    - Contenedor raíz con `onMouseDown={keepFocusOnMouseDown}`.
    - Botones: `<button type="button" class="btn" onClick={cancelCheckout}>Cancelar (Esc)</button>` y `<button type="button" class="btn btn-primary" onClick={() => void submitCheckout()}>Confirmar cobro (Ctrl+Enter)</button>`.
    - Texto de ayuda: "Enter o ↓ pasa al campo siguiente, ↑ al anterior. Ctrl+Enter confirma, Esc cancela."
    - Actualizar el JSDoc del componente (Enter ya no "no hace nada": navega).

- [ ] **Step 4: correr** `pnpm test -- src/ui/screens/checkout-screen.test.tsx src/ui/keyboard/checkout-controller.test.ts` → PASS.

- [ ] **Step 5: commit** `feat(ui): Cobro con total precargado, navegación con Enter y flechas, y modo devolución (#99)`

---

### Task 6: Enter para cobrar desde la barra vacía y click en el carrito

**Files:**
- Modify: `src/ui/keyboard/command-bar-controller.ts`, `src/ui/keyboard/command-bar-controller.test.ts`, `src/ui/components/CommandBarInput.tsx`, `src/ui/components/CartView.tsx`, `src/ui/screens/sale-screen.test.tsx`

**Interfaces:**
- Produces: `submitEmptyCommandBar(): void` y `selectCartLine(index: number): void` en `command-bar-controller.ts`.

- [ ] **Step 1: tests que fallan** (controller):
  - Con líneas y turno abierto: `submitEmptyCommandBar()` → `activeScreenSignal.value === 'checkout'` (esperar la promesa: exportar el promise o `await vi.waitFor`).
  - Con líneas y una línea seleccionada: igual abre Cobro.
  - Sin líneas y con cliente: `commandBarErrorSignal.value === 'Cobranza sin venta: llega en una próxima versión.'` y la pantalla sigue en `'sale'`.
  - Sin líneas y sin cliente: nada cambia (`commandBarErrorSignal.value === null`).
  - `selectCartLine(1)` con dos líneas → `cartSelectionIndexSignal.value === 1`; índice fuera de rango no cambia nada.
  - Componente (`sale-screen.test.tsx`): click en la segunda fila del carrito la marca seleccionada y el foco sigue en la barra.

- [ ] **Step 2: correr y ver que fallan.**

- [ ] **Step 3: implementar**
  ```typescript
  /**
   * Enter con la barra vacía (#99): con líneas abre Cobro (aunque haya una
   * línea seleccionada — cambiar su cantidad necesita un número en la barra).
   * Sin líneas y con cliente, la cobranza sin venta llega en la Etapa 6
   * (#101); sin nada, no hace nada: Enter sobre la barra vacía es un gesto
   * reflejo y un error molestaría.
   */
  export function submitEmptyCommandBar(): void {
    if (cartSignal.value.lines.length > 0) {
      void triggerCheckout();
      return;
    }
    if (attachedCustomerSignal.value !== undefined) {
      commandBarErrorSignal.value = 'Cobranza sin venta: llega en una próxima versión.';
    }
  }

  /** Click en una fila del carrito: lo mismo que llegar con ↑/↓. */
  export function selectCartLine(index: number): void {
    if (index >= 0 && index < cartSignal.value.lines.length) {
      cartSelectionIndexSignal.value = index;
    }
  }
  ```
  `CommandBarInput.tsx`, rama Enter: si `buffer === ''` → `submitEmptyCommandBar(); return;` (antes del chequeo de línea seleccionada). `CartView.tsx`: cada `<tr>` suma `onClick={() => selectCartLine(index)}` y `style.cursor = 'pointer'`; el contenedor de la venta ya tiene `keepFocusOnMouseDown` (verificarlo en `sale-screen.tsx`; si no, agregarlo al contenedor raíz). Borrar de CLAUDE.md la nota "El carrito todavía no es clickeable (Etapa 4)" en la Task 17.

- [ ] **Step 4: correr** `pnpm test -- src/ui` → PASS.

- [ ] **Step 5: commit** `feat(ui): Enter con la barra vacía abre Cobro y click en el carrito selecciona la línea (#99, cierra #61)`

---

### Task 7: Advertencias — dominio, stock en memoria y UI

**Files:**
- Create: `src/domain/sale-warnings.ts`, `src/domain/sale-warnings.test.ts`, `src/ui/state/stock.ts`, `src/ui/format-warning.ts`, `src/ui/format-warning.test.ts`
- Modify: `src/ui/tokens.css` (o donde vivan los tokens: `grep -rn "color-danger" src/ui/*.css`), `src/ui/state/command-bar.ts` (`commandBarWarningSignal`), `src/ui/keyboard/command-bar-controller.ts`, `src/ui/components/CommandBarInput.tsx`, `src/ui/components/CartView.tsx`, `src/ui/screens/checkout-screen.tsx`, `src/ui/bootstrap.ts`, `src/sync/engine.ts` o donde se actualiza `localCatalogCountsSignal` tras un pull, `src/ui/keyboard/checkout-controller.ts`, `src/ui/keyboard/void-controller.ts` (refrescar el stock tras cerrar/anular), tests de los componentes.

**Interfaces:**
- Produces:
  ```typescript
  export type SaleWarning =
    | { kind: 'insufficient-stock'; productId: string; requested: number; available: number }
    | { kind: 'blocked-product'; productId: string; reason: string }
    | { kind: 'blocked-customer'; customerId: string; reason: string };
  export function lineWarnings(line: SaleLine, context: { product: Product | undefined; stockQuantity: number | undefined }): SaleWarning[];
  export function customerWarnings(customer: Customer | undefined): SaleWarning[];
  export function cartWarnings(cart: Cart, context: { productById: (id: string) => Product | undefined; stockOf: (id: string) => number | undefined; customer: Customer | undefined }): SaleWarning[];
  ```
  `stockSnapshotSignal: Signal<ReadonlyMap<string, number>>` y `refreshStockSnapshot(): Promise<void>` en `ui/state/stock.ts`. `formatWarning(warning, productName: (id: string) => string): string` en `ui/format-warning.ts`. `commandBarWarningSignal: Signal<string | null>`.
- Desviación de la spec (a anotar en el resumen de la tarea): el stock en memoria es la tabla entera, no solo los productos del carrito — así la búsqueda puede mostrar "Stock: N" sin una lectura async por fila. Es una tabla chica (una fila por producto).

- [ ] **Step 1: tests que fallan** (`sale-warnings.test.ts`):
```typescript
const product = { id: 'p1', sku: 'S', barcodes: [], name: 'Coca', price: 1, taxRate: 0, category: 'c', tracksStock: true };
const line = (qty: number) => ({ kind: 'product' as const, productId: 'p1', qty, unitPrice: 1 });
it('stock insuficiente solo con tracksStock, cantidad positiva y mayor al stock', () => {
  expect(lineWarnings(line(5), { product, stockQuantity: 3 })).toEqual([{ kind: 'insufficient-stock', productId: 'p1', requested: 5, available: 3 }]);
  expect(lineWarnings(line(3), { product, stockQuantity: 3 })).toEqual([]);
  expect(lineWarnings(line(-5), { product, stockQuantity: 0 })).toEqual([]);
  expect(lineWarnings(line(5), { product: { ...product, tracksStock: false }, stockQuantity: 0 })).toEqual([]);
  expect(lineWarnings(line(1), { product, stockQuantity: undefined })).toEqual([{ kind: 'insufficient-stock', productId: 'p1', requested: 1, available: 0 }]);
});
it('producto bloqueado', () => {
  expect(lineWarnings(line(1), { product: { ...product, tracksStock: false, blocked: { reason: 'Vencido' } }, stockQuantity: 0 })).toEqual([{ kind: 'blocked-product', productId: 'p1', reason: 'Vencido' }]);
});
it('cliente bloqueado y agregado del carrito con el cliente al final', () => {
  const customer = { id: 'c1', name: 'Ana', createdAt: 'x', blocked: { reason: 'Deuda' } };
  const warnings = cartWarnings({ lines: [line(5)] }, { productById: () => product, stockOf: () => 3, customer });
  expect(warnings.map((w) => w.kind)).toEqual(['insufficient-stock', 'blocked-customer']);
});
it('una línea libre nunca advierte', () => {
  expect(lineWarnings({ kind: 'freeform', description: 'x', qty: 1, unitPrice: 1 }, { product: undefined, stockQuantity: undefined })).toEqual([]);
});
```
`format-warning.test.ts`: `insufficient-stock` → `'Coca: stock disponible 3'`; `blocked-product` → `'Coca: bloqueado — Vencido'`; `blocked-customer` → `'Cliente bloqueado — Deuda'` (con `formatQuantity` para el stock).

- [ ] **Step 2: correr y ver que fallan.**

- [ ] **Step 3: implementar el dominio** (`domain/sale-warnings.ts`, puro, con JSDoc citando "advertir en vez de bloquear", #99 y #12): las tres funciones como en los tests, `cartWarnings` = `flatMap` de `lineWarnings` + `customerWarnings`.

- [ ] **Step 4: stock en memoria** (`ui/state/stock.ts`):
  ```typescript
  export const stockSnapshotSignal = signal<ReadonlyMap<string, number>>(new Map());

  /** Toda la tabla `stock` en memoria para las advertencias (#99). Se recarga al arrancar, tras cada pull aplicado y tras cerrar o anular una venta. */
  export async function refreshStockSnapshot(): Promise<void> {
    const rows = await db.stock.toArray();
    stockSnapshotSignal.value = new Map(rows.map((row) => [row.productId, row.quantity]));
  }
  ```
  Llamarla en `bootstrap` (después de cargar el catálogo), en el mismo lugar donde se actualiza `localCatalogCountsSignal` tras aplicar un pull, al final exitoso de `submitCheckout` y de `confirmVoid`, y tras `applyConnection`/`demoReset` si repueblan (buscar `setCatalogRepository(` para ubicar los puntos que recargan el catálogo y sumarla ahí).

- [ ] **Step 5: UI**
  - Token: `--color-warning: #b45309;` en el tema claro y `--color-chrome-warning: #fbbf24;` para el chrome oscuro (junto a `--color-danger` en los tokens).
  - `commandBarWarningSignal` (`ui/state/command-bar.ts`), se limpia en `updateCommandBarBuffer` junto con el error. En el slot de `CommandBarInput`, si hay error se muestra el error; si no y hay advertencia, la advertencia con `color: var(--color-chrome-warning)` y el prefijo "⚠ ". No usa `useSelectOnErrorSignal`.
  - `addByProduct` (controller): tras aplicar el resultado, busca la línea resultante y calcula `lineWarnings(line, { product, stockQuantity: stockSnapshotSignal.value.get(product.id) })`; si hay alguna, `commandBarWarningSignal.value = warnings.map((w) => formatWarning(w, nameOf)).join(' · ')`. Lo mismo tras `doSetSelectedCartLineQuantity` sobre una línea de producto.
  - Búsqueda (`CommandBarInput`, fila de producto): debajo del nombre, si `product.blocked` → "Bloqueado: <motivo>"; si `product.tracksStock` y `qtyPedida > (stock ?? 0)` → "Stock: <formatQuantity(stock ?? 0)>" — ambos en `--color-chrome-warning`.
  - Lista de `@` (fila de cliente): "Bloqueado: <motivo>" en `--color-chrome-warning`.
  - `CartView.tsx`: en la celda de producto, por cada `lineWarnings(line, …)` un `<div class="cart-view__warning">⚠ …</div>` (`color: var(--color-warning)`, `font-size-sm`), con los textos "Stock disponible: N" y "Bloqueado: <motivo>". `CustomerCard`: si `customer?.blocked`, una fila "⚠ Bloqueado: <motivo>" (la tarjeta tiene alto fijo: reemplaza a la fila de teléfono vacía cuando no hay teléfono; si hay teléfono, el `min-height` de `.cart-view__customer` sube una línea — ajustar en `cart-view.css`).
  - Cobro: si `cartWarnings(...)` no está vacío, arriba de los campos un bloque `role="status"` con título "Advertencias" y una lista con `formatWarning`, borde `--color-warning`. No bloquea nada.

- [ ] **Step 6: tests de UI**: búsqueda con producto bloqueado muestra "Bloqueado: Vencido"; carrito con línea sobre el stock muestra "⚠ Stock disponible: 3"; tarjeta de cliente bloqueado; Cobro con advertencias muestra el bloque y Ctrl+Enter igual cierra la venta; agregar un producto sin stock deja la advertencia en el slot y la próxima tecla la borra.

- [ ] **Step 7: correr** `pnpm test -- src` y `pnpm typecheck` → PASS.

- [ ] **Step 8: commit** `feat: advertencias de stock y bloqueos en búsqueda, carrito, cliente, cobro y barra (#99)`

---

### Task 8: Anulación como ticket negativo — dominio

**Files:**
- Modify: `src/domain/sale.ts`, `src/domain/sale-lifecycle.ts`, `src/domain/sale-lifecycle.test.ts`, `src/domain/result.ts`, `src/ui/errors.ts`, `src/domain/cash-session.test.ts` y cualquier test que construya `Sale` con `voidedAt` o `status: 'open'`.

**Interfaces:**
- Produces:
  - `Sale.voidsSaleId?: string`; `Sale.status: 'closed' | 'voided'` (`voided` solo legado); sale `voidedAt`.
  - `VOID_WINDOW_MS = 24 * 60 * 60 * 1000`.
  - `isWithinVoidWindow(sale: Pick<Sale, 'createdAt'>, now: string): boolean`
  - `isVoided(sale: Pick<Sale, 'id' | 'status'>, voidedSaleIds: ReadonlySet<string>): boolean`
  - `buildVoidSale(original: Sale, params: { id: string; now: string; reason?: string; isAlreadyVoided: boolean }): Result<Sale>`
  - `ErrorMeta`: `'sale/cannot-void-a-void': undefined`, `'sale/void-window-expired': { createdAt: string }`; sale `'sale/not-closed'` si queda sin uso.

- [ ] **Step 1: tests que fallan** (reemplazan los de `voidSale`):
```typescript
const original: Sale = {
  id: 'S1', status: 'closed', createdAt: '2026-09-24T10:00:00.000Z', total: 250, customerId: 'C1',
  globalAdjustmentPercentage: -10,
  lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100, discount: { type: 'amount', value: 10 } }],
  payments: [{ method: 'account', amount: 150, reference: 'H1' }, { method: 'cash', amount: 100 }],
};
it('arma un ticket negativo con referencia al original', () => {
  const r = buildVoidSale(original, { id: 'V1', now: '2026-09-24T12:00:00.000Z', reason: 'error', isAlreadyVoided: false });
  expect(r).toEqual({ ok: true, value: {
    id: 'V1', status: 'closed', createdAt: '2026-09-24T12:00:00.000Z', total: -250, customerId: 'C1',
    globalAdjustmentPercentage: -10, voidsSaleId: 'S1', voidReason: 'error',
    lines: [{ kind: 'product', productId: 'p1', qty: -2, unitPrice: 100, discount: { type: 'amount', value: 10 } }],
    payments: [{ method: 'account', amount: -150 }, { method: 'cash', amount: -100 }],
  } });
});
it('rechaza anular dos veces, una anulación, o fuera de las 24 h', () => {
  expect(buildVoidSale(original, { id: 'V', now: '2026-09-24T12:00:00.000Z', isAlreadyVoided: true })).toMatchObject({ ok: false, error: 'sale/already-voided' });
  expect(buildVoidSale({ ...original, status: 'voided' }, { id: 'V', now: '2026-09-24T12:00:00.000Z', isAlreadyVoided: false })).toMatchObject({ ok: false, error: 'sale/already-voided' });
  expect(buildVoidSale({ ...original, voidsSaleId: 'S0' }, { id: 'V', now: '2026-09-24T12:00:00.000Z', isAlreadyVoided: false })).toMatchObject({ ok: false, error: 'sale/cannot-void-a-void' });
  expect(buildVoidSale(original, { id: 'V', now: '2026-09-25T10:00:00.000Z', isAlreadyVoided: false })).toMatchObject({ ok: false, error: 'sale/void-window-expired' });
});
it('una devolución común (negativa, sin voidsSaleId) se anula con un ticket positivo', () => {
  const refund: Sale = { ...original, total: -100, payments: [{ method: 'cash', amount: -100 }], lines: [{ kind: 'freeform', description: 'dev', qty: -1, unitPrice: 100 }] };
  const r = buildVoidSale(refund, { id: 'V', now: '2026-09-24T12:00:00.000Z', isAlreadyVoided: false });
  expect(r.ok && r.value.total).toBe(100);
});
it('ventana de 24 h móviles: 23:59 se anula a las 00:01', () => {
  expect(isWithinVoidWindow({ createdAt: '2026-09-24T23:59:00.000Z' }, '2026-09-25T00:01:00.000Z')).toBe(true);
  expect(isWithinVoidWindow({ createdAt: '2026-09-24T10:00:00.000Z' }, '2026-09-25T10:00:00.000Z')).toBe(false);
});
it('isVoided con el status legado o con una anulación', () => {
  expect(isVoided({ id: 'S1', status: 'voided' }, new Set())).toBe(true);
  expect(isVoided({ id: 'S1', status: 'closed' }, new Set(['S1']))).toBe(true);
  expect(isVoided({ id: 'S1', status: 'closed' }, new Set())).toBe(false);
});
```

- [ ] **Step 2: correr y ver que fallan.**

- [ ] **Step 3: implementar**
  - `sale.ts`: `status: 'closed' | 'voided'` con comentario ("`voided` solo aparece en ventas guardadas antes de la Etapa 4 de #94; desde entonces una anulación es un ticket negativo aparte, `voidsSaleId`"); borrar `voidedAt`; agregar `voidsSaleId?: string` con su JSDoc (documento independiente, solo auditoría, #99). Actualizar el JSDoc de `Sale` (RNF-07: la original nunca se toca).
  - `sale-lifecycle.ts`: borrar `voidSale`, agregar:
    ```typescript
    export const VOID_WINDOW_MS = 24 * 60 * 60 * 1000;

    export function isWithinVoidWindow(sale: Pick<Sale, 'createdAt'>, now: string): boolean {
      return new Date(now).getTime() - new Date(sale.createdAt).getTime() < VOID_WINDOW_MS;
    }

    export function isVoided(sale: Pick<Sale, 'id' | 'status'>, voidedSaleIds: ReadonlySet<string>): boolean {
      return sale.status === 'voided' || voidedSaleIds.has(sale.id);
    }

    function negateLine(line: SaleLine): SaleLine {
      return { ...line, qty: -line.qty };
    }

    function negatePayment(payment: Payment): Payment {
      // Sin `reference`: un pago `account` negativo sin hold es una acreditación (contrato).
      return { method: payment.method, amount: -payment.amount };
    }

    /**
     * La anulación como documento propio (#99): un ticket nuevo con las líneas y
     * los pagos del original invertidos, que mueve stock, saldo y efectivo por su
     * cuenta. `voidsSaleId` queda solo para auditoría; el original no se toca.
     */
    export function buildVoidSale(
      original: Sale,
      params: { id: string; now: string; reason?: string; isAlreadyVoided: boolean },
    ): Result<Sale> {
      if (original.voidsSaleId !== undefined) {
        return err('sale/cannot-void-a-void', undefined);
      }
      if (params.isAlreadyVoided || original.status === 'voided') {
        return err('sale/already-voided', undefined);
      }
      if (!isWithinVoidWindow(original, params.now)) {
        return err('sale/void-window-expired', { createdAt: original.createdAt });
      }
      return ok({
        id: params.id,
        status: 'closed',
        createdAt: params.now,
        lines: original.lines.map(negateLine),
        payments: original.payments.map(negatePayment),
        total: -original.total,
        voidsSaleId: original.id,
        ...(params.reason !== undefined ? { voidReason: params.reason } : {}),
        ...(original.customerId !== undefined ? { customerId: original.customerId } : {}),
        ...(original.globalAdjustmentPercentage !== undefined
          ? { globalAdjustmentPercentage: original.globalAdjustmentPercentage }
          : {}),
      });
    }
    ```
    `buildStockMovementsForSale`: la firma no cambia; su `sign` pasa a ser siempre `-1` sobre `line.qty` (`delta: -line.qty`) — una venta negativa (o una anulación) repone sola; `reason` queda solo como etiqueta de auditoría. Actualizar su JSDoc.
  - `result.ts`/`errors.ts`: `sale/cannot-void-a-void` → "Esta venta ya es una anulación: no se puede anular."; `sale/void-window-expired` → "Solo se pueden anular ventas de las últimas 24 horas."; borrar `sale/not-closed` si no queda uso (`grep`).

- [ ] **Step 4: correr** `pnpm test -- src/domain` y `pnpm typecheck` (va a fallar en `storage/sale-repository.ts`: se arregla en la Task 9; si hace falta para que compile, dejar esa función llamando a `buildVoidSale` con `isAlreadyVoided: false` y completarla en la Task 9).

- [ ] **Step 5: commit** `feat(domain): la anulación es un ticket negativo con referencia al original (#99)`

---

### Task 9: Anulación — persistencia, outbox, reaplicación y limpieza

**Files:**
- Modify: `src/storage/db.ts` (versión 6), `src/storage/sale-repository.ts`, `src/storage/sale-repository.test.ts`, `src/domain/outbox.ts`, `src/domain/outbox.test.ts`, `src/domain/reapply.ts`, `src/domain/reapply.test.ts`, `src/domain/local-cleanup.ts`, `src/domain/local-cleanup.test.ts`, `src/storage/local-cleanup.ts`, `src/storage/local-data.ts` (si referencia `sale-void`), `src/sync/engine.ts` / `src/sync/connector.ts` (tipos de `OutboxBatchItem`), conectores y sus tests que armen `sale-void`.

**Interfaces:**
- Consumes: `buildVoidSale`, `isVoided` (Task 8).
- Produces:
  - `voidSaleAndPersist(saleId: string, params?: { reason?: string }): Promise<Result<Sale>>` — devuelve el **ticket de anulación**.
  - `listVoidCandidates(now: string): Promise<VoidCandidate[]>` en `storage/sale-repository.ts`, con `type VoidCandidate = { sale: Sale; state: 'voidable' | 'voided' | 'void-ticket'; original?: Sale }` (`original` solo para `void-ticket`).
  - `loadVoidedSaleIds(saleIds: readonly string[]): Promise<Set<string>>` y `loadVoidOriginals(sales: readonly Sale[]): Promise<Map<string, Sale>>`.
  - `OutboxEventPayload` sin `sale-void`; `LEGACY_OUTBOX_TYPES` = `cash-session`, `sale-void`.

- [ ] **Step 1: tests que fallan**
  - `sale-repository.test.ts` (con `fake-indexeddb/auto`): sembrar un producto con `tracksStock`, stock 10, una cuenta con saldo 0, un turno abierto; cerrar una venta de 2 unidades pagada 150 a cuenta (sin hold) + 100 efectivo; `voidSaleAndPersist(sale.id)` →
    - devuelve un ticket con `voidsSaleId === sale.id`, `total === -original.total`;
    - `db.sales.count() === 2` y el original sigue `status: 'closed'` sin cambios;
    - stock vuelve a 10; hay un `stockMovement` con `reason: 'sale-void'`, `saleId === voidTicket.id`, `delta: 2`;
    - saldo de la cuenta vuelve a 0 (hay un `accountMovement` de -150);
    - outbox tiene un evento `sale` con `id === voidTicket.id` y `sale.voidsSaleId === sale.id`, más sus `stock-movement`;
    - el turno abierto incluye el id del ticket de anulación;
    - un segundo `voidSaleAndPersist(sale.id)` → `sale/already-voided`.
  - `listVoidCandidates(now)`: con una venta de hace 25 h, una anulada y su anulación, y una común → devuelve solo las de 24 h, más nuevo primero, con los estados `voidable` / `voided` / `void-ticket` (y `original` en la anulación); tope 20.
  - `reapply.test.ts`: un evento `sale` con `voidsSaleId`, `customerId: 'C1'` y pago `account` de -150 → `balance.get('C1') === -150`.
  - `outbox.test.ts`: `isLegacyOutboxType('sale-void') === true`.
  - `local-cleanup.test.ts`: una venta vieja cuya anulación está pendiente **sí** se borra (regla por su propia edad); la anulación pendiente no.

- [ ] **Step 2: correr y ver que fallan.**

- [ ] **Step 3: implementar**
  - `db.ts`: `this.version(6).stores({ sales: 'id, status, createdAt, voidsSaleId' });` con comentario (#99: índice para saber si una venta ya tiene anulación).
  - `sale-repository.ts`:
    - Extraer de `closeSaleAndPersist` un helper `persistSaleDocument(sale, { now, origin, openSession, pendingHold? })` que, **dentro** de una transacción que el caller abre, hace `db.sales.add`, `applyStockMovements` (movimientos de `buildStockMovementsForSale(sale, { reason, ... })`), `applyAccountMovements`, `db.outbox.bulkAdd` y, si `openSession !== undefined`, `db.cashSessions.put(recordSaleInCashSession(openSession, sale.id))`.
    - `voidSaleAndPersist(saleId, params)`:
      ```typescript
      const now = new Date().toISOString();
      const origin = currentEventOrigin();
      const existing = await db.sales.get(saleId);
      if (existing === undefined) return err('sale/not-found', { saleId });
      const isAlreadyVoided = (await db.sales.where('voidsSaleId').equals(saleId).count()) > 0;
      const voidResult = buildVoidSale(existing, { id: newId(), now, isAlreadyVoided, ...(params?.reason !== undefined ? { reason: params.reason } : {}) });
      if (!voidResult.ok) return voidResult;
      const openSession = await getCurrentOpenCashSession(); // hasta la Etapa 5 (#100); anular no lo exige
      // una sola transacción, mismas tablas que closeSaleAndPersist, con reason 'sale-void'
      ```
      Actualizar el JSDoc (documento propio; la original no se toca; el turno abierto es solo para el arqueo de `/CAJA` hasta la Etapa 5).
    - `listVoidCandidates(now)`: `db.sales.where('createdAt').above(new Date(Date.parse(now) - VOID_WINDOW_MS).toISOString())`, ordenar desc, `slice(0, 20)`; calcular `voidedIds` con `loadVoidedSaleIds`, y `originals` con `loadVoidOriginals` (`db.sales.bulkGet` de los `voidsSaleId`).
  - `outbox.ts`: sacar la variante `sale-void` y `buildOutboxEventForVoid`; `LEGACY_OUTBOX_TYPES = new Set(['cash-session', 'sale-void'])` con comentario.
  - `reapply.ts`: sacar `case 'sale-void'`; el comentario del `default` menciona los dos tipos legados.
  - `local-cleanup.ts` (dominio): borrar `pendingVoidSaleIds` y su uso; actualizar el JSDoc ("cada venta por su propia edad y su propio evento; una anulación es otra venta").
  - Arreglar los usos de `sale-void` en `sync/`, conectores y tests (`grep -rn "sale-void" src e2e`): el `StockMovement.reason` `'sale-void'` se queda.

- [ ] **Step 4: correr** `pnpm test -- src` y `pnpm typecheck` → PASS.

- [ ] **Step 5: commit** `feat(storage): la anulación se persiste como venta propia y viaja como evento sale (#99)`

---

### Task 10: `/ANULAR` y `/RESUMEN` con marcas de anulado

**Files:**
- Modify: `src/ui/keyboard/void-controller.ts`, `src/ui/keyboard/void-controller.test.ts`, `src/ui/state/void-sale.ts`, `src/ui/screens/void-sale-screen.tsx`, `src/ui/screens/void-sale-screen.test.tsx`, `src/storage/cash-summary-repository.ts`, `src/ui/state/cash-summary.ts` (si hace falta), `src/ui/screens/cash-summary-screen.tsx`, `src/ui/screens/cash-summary-screen.test.tsx`, `e2e/void-sale.spec.ts`

**Interfaces:**
- Consumes: `listVoidCandidates`, `loadVoidedSaleIds`, `loadVoidOriginals` (Task 9).
- Produces: `voidableSalesSignal: Signal<VoidCandidate[]>`; `CashSummaryContext` suma `voidedSaleIds: Set<string>` y `voidOriginals: Map<string, Sale>`.

- [ ] **Step 1: tests que fallan**
  - Controller: `loadVoidableSales()` carga candidatos y preselecciona el primer `voidable` (no la fila 0 si es `voided`/`void-ticket`); `moveVoidSelection` saltea las filas sin acción; `activateVoidRow` sobre una fila sin acción no hace nada; sin ninguna `voidable` la selección queda `null` y `selectForVoid` no confirma.
  - Pantalla: una original anulada se ve con el texto "Anulada" y opacidad reducida; una anulación dice "Anulación de HH:MM · $X"; el vacío dice "No hay ventas de las últimas 24 horas para anular." cuando no hay ninguna `voidable`.
  - `/RESUMEN`: un ticket anulado muestra "Anulada" y una anulación "Anulación de HH:MM".

- [ ] **Step 2: correr y ver que fallan.**

- [ ] **Step 3: implementar**
  - `void-controller.ts`: `loadVoidableSales` usa `listVoidCandidates(new Date().toISOString())` (deja de leer Dexie directo); la selección inicial es el índice del primer `voidable` o `null`; `moveVoidSelection(direction)` busca el siguiente índice `voidable` en esa dirección (sin ciclar); `activateVoidRow(index)` sale si el candidato no es `voidable`; `confirmVoid` usa `candidate.sale.id` y, al terminar, `refreshStockSnapshot()`.
  - `void-sale-screen.tsx`: cada fila muestra fecha/hora y total; `voided` → sufijo "Anulada", `opacity: 0.5`, `cursor: default`; `void-ticket` → texto `Anulación de ${hora del original} · ${formatMoney(original.total)}` (si `original` falta: "Anulación"), `opacity: 0.5`. La confirmación sigue igual. El JSDoc cita la ventana de 24 h y #110 (búsqueda y ticket completo quedan ahí).
  - `cash-summary-repository.ts::getCashSummaryContext`: suma `voidedSaleIds` (`loadVoidedSaleIds(session.sales)` unido a los `status === 'voided'`) y `voidOriginals`. `cash-summary-screen.tsx`: en la cabecera de cada ticket, la marca "Anulada" (texto, `color-text-muted`) o "Anulación de HH:MM".
  - `e2e/void-sale.spec.ts`: ajustar a lo nuevo — después de anular, en IndexedDB hay dos ventas, la segunda con `voidsSaleId`; volver a `/ANULAR` muestra la original con "Anulada".

- [ ] **Step 4: correr** `pnpm test -- src/ui` → PASS.

- [ ] **Step 5: commit** `feat(ui): /ANULAR con ventana de 24 h y marcas de anulado, también en /RESUMEN (#99, #110)`

---

### Task 11: Contrato 4.0.0 en el POS — compatibilidad, `getInfo` y conector REST

**Files:**
- Create: `src/domain/contract-version.ts`, `src/domain/contract-version.test.ts`
- Modify: `src/sync/connector.ts`, `src/domain/result.ts`, `src/ui/errors.ts`, `src/connectors/rest/rest-fetch-connector.ts`, `src/connectors/rest/rest-fetch-connector.test.ts`, `src/test/fake-connector.ts`, cualquier `Connector` literal en tests (`grep -rn "pullBatch:" src`).

**Interfaces:**
- Produces:
  ```typescript
  // domain/contract-version.ts
  export const POS_CONTRACT_VERSION = '4.0.0';
  export function isCompatibleContract(backendVersion: string, posVersion?: string): boolean;
  // sync/connector.ts
  export const CONTRACT_VERSION_HEADER = 'X-POS-Contract-Version';
  export const backendInfoSchema: z.ZodType<...>;
  export type BackendInfo = { contractVersion: string; status: 'ok' | 'maintenance'; message?: string; backend?: { name: string; version: string } };
  export function toBackendInfo(data: z.infer<typeof backendInfoSchema>): BackendInfo;
  export const incompatibleContractBodySchema = z.object({ code: z.literal('incompatible-contract'), contractVersion: z.string() });
  // Connector suma:
  getInfo(): Promise<Result<BackendInfo>>;
  ```
  `ErrorMeta`: `'sync/incompatible-contract': { backend: string; pos: string }`, `'sync/backend-maintenance': { message?: string }`.

- [ ] **Step 1: tests que fallan**
  - `contract-version.test.ts`: `isCompatibleContract('4.0.0')` true; `'4.2.1'` true; `'3.9.0'` false; `'5.0.0'` false; `isCompatibleContract('4.0.0', '4.1.0')` false (backend en un minor anterior); `'abc'` false.
  - REST: `getInfo` hace `GET {baseUrl}/info` con `Authorization` y `X-POS-Contract-Version: 4.0.0`, y valida la respuesta; `pushBatch`/`pullBatch`/`requestAccountHold` mandan el header; una respuesta 409 con `{ code: 'incompatible-contract', contractVersion: '3.0.0' }` → `err('sync/incompatible-contract', { backend: '3.0.0', pos: '4.0.0' })`; un 409 con otro cuerpo → `sync/request-failed` como hoy.

- [ ] **Step 2: correr y ver que fallan.**

- [ ] **Step 3: implementar**
  - `contract-version.ts`:
    ```typescript
    /** Versión del Connector API que habla este POS (epic #94, Etapa 4 — #99). */
    export const POS_CONTRACT_VERSION = '4.0.0';

    function parseVersion(version: string): [number, number, number] | undefined {
      const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
    }

    /** Compatible: mismo major y el backend en un minor igual o mayor (si no, puede no entender algo que el POS manda). */
    export function isCompatibleContract(backendVersion: string, posVersion: string = POS_CONTRACT_VERSION): boolean {
      const backend = parseVersion(backendVersion);
      const pos = parseVersion(posVersion);
      if (backend === undefined || pos === undefined) return false;
      return backend[0] === pos[0] && backend[1] >= pos[1];
    }
    ```
  - `connector.ts`: `backendInfoSchema = z.object({ contractVersion: z.string(), status: z.enum(['ok', 'maintenance']), message: z.string().optional(), backend: z.object({ name: z.string(), version: z.string() }).optional() })` y `toBackendInfo` que omite los opcionales ausentes; `getInfo` en `Connector` con JSDoc.
  - REST: `buildHeaders` suma siempre `[CONTRACT_VERSION_HEADER]: POS_CONTRACT_VERSION`. Un helper `failedResponse(response)`: si `status === 409`, intentar `response.json()` y `incompatibleContractBodySchema.safeParse`; si matchea → `err('sync/incompatible-contract', { backend: body.contractVersion, pos: POS_CONTRACT_VERSION })`; si no, `sync/request-failed`. `getInfo` con `fetch(\`${baseUrl}/info\`, { method: 'GET', headers })` y el mismo manejo de errores que `postJson` (extraer `requestJson(method, path, idempotencyKey, body?)`).
  - `errors.ts`: `sync/incompatible-contract` → `El backend usa el contrato ${backend}; esta versión del POS necesita ${major}.x.` (con `major = pos.split('.')[0]`); `sync/backend-maintenance` → `El backend está en mantenimiento${message ? `: ${message}` : '.'}`.
  - `fake-connector.ts` y los conectores literales de tests: `getInfo: () => Promise.resolve(ok({ contractVersion: '4.0.0', status: 'ok' }))`.

- [ ] **Step 4: correr** `pnpm test -- src` y `pnpm typecheck` → PASS (el conector de Sheets todavía no implementa `getInfo`: agregar un stub temporal que devuelva `ok({ contractVersion: POS_CONTRACT_VERSION, status: 'ok' })`, reemplazado en la Task 12).

- [ ] **Step 5: commit** `feat(sync): contrato 4.0.0 — getInfo, versión en cada request y 409 incompatible en REST (#99)`

---

### Task 12: Conector de Google Sheets y `bridge.gs` en 4.0.0

**Files:**
- Modify: `src/connectors/google-sheets/bridge-client.ts`, `bridge-client.test.ts`, `google-sheets-connector.ts`, `google-sheets-connector.test.ts`, `bridge.gs`, `columnas.gs`, `bridge.test.ts`, `README.md` (del conector)

**Interfaces:**
- Consumes: `POS_CONTRACT_VERSION`, `backendInfoSchema`, `toBackendInfo` (Task 11).
- Produces: el envelope suma `contractVersion` en el request; la respuesta de error puede traer `code: 'incompatible-contract'` y `contractVersion`; acción `info`.

- [ ] **Step 1: tests que fallan**
  - `bridge-client.test.ts`: el body enviado incluye `contractVersion: '4.0.0'`; una respuesta `{ ok: false, error: 'x', code: 'incompatible-contract', contractVersion: '3.0.0' }` → `sync/incompatible-contract { backend: '3.0.0', pos: '4.0.0' }`.
  - `google-sheets-connector.test.ts`: `getInfo` llama la acción `info` y devuelve `BackendInfo`.
  - `bridge.test.ts` (planilla falsa): acción `info` → `{ ok: true, data: { contractVersion: '4.0.0', status: 'ok', backend: { name: 'pos-sheets-bridge', version: '4.0.0' } } }`; un request con `contractVersion: '3.0.0'` → `{ ok: false, code: 'incompatible-contract', contractVersion: '4.0.0', error: … }` sin escribir nada; un request sin `contractVersion` se procesa (criterio del backend); un evento `sale` con `voidsSaleId` escribe sus filas en Ventas con la columna "Anula a" y marca `estado: 'anulada'` en las filas del original si existen (sin fallar si no existen); ya no hay acción ni rama `sale-void`.

- [ ] **Step 2: correr y ver que fallan.**

- [ ] **Step 3: implementar**
  - `bridge-client.ts`: el body suma `contractVersion: POS_CONTRACT_VERSION`; el schema del envelope de error suma `code: z.string().optional()` y `contractVersion: z.string().optional()`; si `code === 'incompatible-contract' && contractVersion !== undefined` → `err('sync/incompatible-contract', { backend: contractVersion, pos: POS_CONTRACT_VERSION })`.
  - `google-sheets-connector.ts`: `getInfo()` → `callBridge(config, { action: 'info' }, backendInfoSchema)` y `toBackendInfo`.
  - `bridge.gs`:
    - `var CONTRACT_VERSION = '4.0.0';` arriba, con comentario.
    - `ACTIONS` suma `info: infoAction` (`function infoAction() { return { contractVersion: CONTRACT_VERSION, status: 'ok', backend: { name: 'pos-sheets-bridge', version: CONTRACT_VERSION } }; }`).
    - En `doPost`, antes del lock: si `request.contractVersion` es string y su major difiere del de `CONTRACT_VERSION` → `respond({ ok: false, code: 'incompatible-contract', contractVersion: CONTRACT_VERSION, error: 'Contrato incompatible: el puente habla ' + CONTRACT_VERSION })`. `info` no toma el lock ni llama `ensureSheetsExist` (liviano): resolverlo antes del `lock.waitLock`.
    - `applyBatchEvent`: sacar `case 'sale-void'` y `pushSaleVoid`; `pushSale` escribe `anulaA: sale.voidsSaleId` y `motivoAnulacion: sale.voidReason` en cada fila de Ventas, y si `sale.voidsSaleId` viene, `markSaleRows('Ventas', sale.voidsSaleId, { estado: 'anulada' })` y lo mismo en Pagos (sin error si no encuentra filas).
    - `SCHEMA.Ventas`: sumar `['anulaA', 'text', true]`; sacar `anuladaEn`, `anulacionBranch`, `anulacionPointOfSale` (una planilla existente las conserva: `ensureColumns` solo agrega). `columnas.gs`: `anulaA: 'Anula a'` y sacar las tres etiquetas.
  - README del conector: sección "Contrato 4.0.0" (acción `info`, `contractVersion` en el cuerpo, anulación como venta con "Anula a", columnas de anulación viejas quedan sin uso).

- [ ] **Step 4: correr** `pnpm test -- src/connectors` → PASS.

- [ ] **Step 5: commit** `feat(sheets): puente 4.0.0 — acción info, contractVersion y anulación como venta (#99)`

---

### Task 13: Motor de sync — estado del backend, barra de estado, diagnóstico y prueba de conexión

**Files:**
- Create: `src/sync/backend-status.ts`, `src/sync/backend-status.test.ts`
- Modify: `src/ui/state/sync.ts`, `src/sync/engine.ts`, `src/sync/engine.test.ts`, `src/sync/connection.ts`, `src/sync/connection.test.ts`, `src/sync/pull-snapshot.ts` (si la prueba vive ahí), `src/ui/components/StatusBar.tsx` y su test, `src/sync/diagnostics.ts`, `src/ui/screens/diagnostico-screen.tsx` y su test, `src/ui/state/sync.ts::SyncLogEntry` (`kind` suma `'info'`)

**Interfaces:**
- Consumes: `Connector.getInfo`, `isCompatibleContract`, errores nuevos (Task 11).
- Produces:
  ```typescript
  // ui/state/sync.ts
  export type BackendStatus =
    | { kind: 'unknown' }
    | { kind: 'ok'; info: BackendInfo }
    | { kind: 'incompatible'; backendVersion: string; info?: BackendInfo }
    | { kind: 'maintenance'; info: BackendInfo };
  export const backendStatusSignal: Signal<BackendStatus>;
  export const backendCheckDueSignal: Signal<boolean>; // true al arrancar
  // sync/backend-status.ts
  export function classifyBackendInfo(info: BackendInfo): BackendStatus;       // pura
  export function isNetworkFailure(failure: Failure): boolean;                 // pura
  export async function refreshBackendStatus(connector: Connector, now: string): Promise<BackendStatus>;
  export function noteSyncFailure(failure: Failure): void;
  export function blocksSync(status: BackendStatus): boolean;
  ```

- [ ] **Step 1: tests que fallan**
  - `backend-status.test.ts`: `classifyBackendInfo` (ok / maintenance / incompatible con `'3.0.0'` — `incompatible` gana sobre `maintenance`); `isNetworkFailure` (`sync/request-failed` sin `status` y `sync/timeout` → true; con `status`, `sync/remote-error`, `sync/invalid-payload` → false); `refreshBackendStatus` con `getInfo` ok → setea `backendStatusSignal` y apaga `backendCheckDueSignal`; con error de red → no cambia el estado; con `sync/incompatible-contract` → `incompatible`; `noteSyncFailure(sync/incompatible-contract)` → estado `incompatible`; `noteSyncFailure(sync/remote-error)` → `backendCheckDueSignal === true`; `noteSyncFailure(red)` → sin cambios.
  - `engine.test.ts`: (a) arranque con `getInfo` en mantenimiento → `pushBatch` y `pullBatch` no se llaman; un ciclo siguiente con `getInfo` ok → corre push; (b) `getInfo` informa `3.0.0` → no corre nada y `backendStatusSignal.kind === 'incompatible'`; (c) `pushBatch` responde `sync/incompatible-contract` → estado `incompatible` y el lote sigue en curso (no se marca enviado); (d) `getInfo` falla por red con estado `unknown` → los ciclos corren como siempre; (e) un `sync/remote-error` en el pull deja `backendCheckDueSignal` en true y el ciclo siguiente llama `getInfo` primero.
  - `connection.test.ts`: la prueba llama `getInfo` antes del pull; `3.0.0` → `sync/incompatible-contract` sin llamar `pullBatch`; `maintenance` → `sync/backend-maintenance` con el mensaje.
  - StatusBar: con `incompatible` muestra "Backend incompatible (contrato 3.0.0, se necesita 4.x)" con el color de error; con `maintenance` "Backend en mantenimiento: <mensaje>"; offline tiene precedencia.
  - `/DIAGNOSTICO`: muestra "Backend: contrato 4.0.0 · ok" (o el estado) y el nombre/versión si vienen.

- [ ] **Step 2: correr y ver que fallan.**

- [ ] **Step 3: implementar**
  - `sync/backend-status.ts`: las funciones puras y:
    ```typescript
    export async function refreshBackendStatus(connector: Connector, now: string): Promise<BackendStatus> {
      const result = await connector.getInfo();
      logSyncAttempt('info', now, { contractVersion: POS_CONTRACT_VERSION }, result);
      if (result.ok) {
        const status = classifyBackendInfo(result.value);
        backendStatusSignal.value = status;
        backendCheckDueSignal.value = false;
        return status;
      }
      noteSyncFailure(result);
      return backendStatusSignal.value;
    }

    export function noteSyncFailure(failure: Failure): void {
      if (failure.error === 'sync/incompatible-contract') {
        backendStatusSignal.value = { kind: 'incompatible', backendVersion: failure.meta.backend };
        return;
      }
      if (!isNetworkFailure(failure)) {
        backendCheckDueSignal.value = true;
      }
    }

    export function blocksSync(status: BackendStatus): boolean {
      return status.kind === 'incompatible' || status.kind === 'maintenance';
    }
    ```
    Mover `logSyncAttempt` de `engine.ts` a un módulo propio (`sync/sync-log.ts`) para que `backend-status.ts` lo use sin un import circular; `kind` suma `'info'`.
  - `engine.ts::withConnectorCycle`: después de armar el conector,
    ```typescript
    if (backendCheckDueSignal.value || blocksSync(backendStatusSignal.value)) {
      await refreshBackendStatus(connector, now);
    }
    if (blocksSync(backendStatusSignal.value)) {
      return undefined;
    }
    ```
    En `pushPendingLot` y en el pull (`finishPullCycle`), después de `logSyncAttempt`, si `!result.ok` → `noteSyncFailure(result)` (en el engine, no en `sync-log.ts`, para no crear un import circular con `backend-status.ts`). `syncNow` pone `backendCheckDueSignal.value = true` antes de correr. Actualizar el JSDoc de `withConnectorCycle` ("ni el backend está en mantenimiento o es incompatible").
  - `connection.ts::probeConnection`: dentro del cerrojo, antes de `pullEverything`:
    ```typescript
    const info = await connector.getInfo();
    if (!info.ok) return info;
    const status = classifyBackendInfo(info.value);
    if (status.kind === 'incompatible') return err('sync/incompatible-contract', { backend: info.value.contractVersion, pos: POS_CONTRACT_VERSION });
    if (status.kind === 'maintenance') return err('sync/backend-maintenance', info.value.message !== undefined ? { message: info.value.message } : {});
    ```
    (todo dentro del mismo `withTimeout`). Al aplicar la conexión (`applyConnection`), `backendStatusSignal.value = { kind: 'ok', info }` no hace falta: basta con `backendCheckDueSignal.value = true`.
  - `StatusBar.tsx`: `statusText`/`statusColor` consultan `backendStatusSignal` después de offline y "sin configurar", antes del resto.
  - `diagnostics.ts`: `SyncDiagnostics.backendStatus: BackendStatus`; la pantalla lo muestra en la sección de conexión; `pos.status()` lo hereda solo.

- [ ] **Step 4: correr** `pnpm test -- src/sync src/ui` y `pnpm typecheck` → PASS.

- [ ] **Step 5: commit** `feat(sync): estado del backend (info, mantenimiento, incompatible) sin bloquear la venta (#99)`

---

### Task 14: Minibackend en 4.0.0

**Files:**
- Modify: `demo-backend/src/db.ts` (sin `sale_voids`, `SCHEMA_VERSION = 4`), `demo-backend/src/lots.ts` (sin `sale-void`; la venta con `voidsSaleId` ya ajusta saldo por su pago `account` sin `reference`), `demo-backend/src/router.ts` (CORS + chequeo de contrato), `demo-backend/src/routes/*` (nueva `info.ts`, settings), `demo-backend/src/panel.html`, tests en `demo-backend/test/`.

**Interfaces:**
- Produces: `GET /info` (requiere auth, igual que el resto); `RouteDef.checksContract?: boolean`; settings `maintenance: { enabled: boolean; message: string }`, `simulateContract3: boolean`; `backendContractVersion(db): '4.0.0' | '3.0.0'`.

- [ ] **Step 1: tests que fallan** (`demo-backend/test/routes/info.test.ts` y `sync.test.ts`):
  - `GET /info` → `200 { contractVersion: '4.0.0', status: 'ok', backend: { name: 'offline-pos-demo-backend', version: '4.0.0' } }`.
  - Con `maintenance` activado → `status: 'maintenance'` y `message`.
  - Con `simulateContract3` → `/info` informa `3.0.0` y `POST /sync/push` con `X-POS-Contract-Version: 4.0.0` → `409 { code: 'incompatible-contract', contractVersion: '3.0.0' }` sin guardar nada.
  - Sin `simulateContract3`, un push con `X-POS-Contract-Version: 3.1.0` → 409 con `contractVersion: '4.0.0'`; sin el header se procesa.
  - Un lote con una venta a cuenta sin hold de 150 y después su anulación (`voidsSaleId`, pago `account` -150) deja el saldo en 0 al procesarse.
  - El preflight `OPTIONS` devuelve `X-POS-Contract-Version` en `Access-Control-Allow-Headers`.

- [ ] **Step 2: correr y ver que fallan** — `pnpm test:backend`

- [ ] **Step 3: implementar**
  - `router.ts`: CORS suma `X-POS-Contract-Version`; antes de invocar un handler con `checksContract: true`, leer `req.headers['x-pos-contract-version']`; si es string y `major(header) !== major(backendContractVersion(db))`, o si `simulateContract3` está activo y hay header → `sendJson(res, 409, { code: 'incompatible-contract', contractVersion: backendContractVersion(db) })`. Marcar `checksContract: true` en `/sync/push`, `/sync/pull` y `/account-holds`.
  - `routes/info.ts`: `GET /info` con `requiresAuth: true`, arma la respuesta desde los settings.
  - Settings (`lots.ts` ya tiene `demo_settings`): funciones `getDemoSettings(db)`/`setDemoSettings(db, partial)` que leen/escriben `maintenance` (JSON) y `simulateContract3`; `GET/PUT /_demo/api/settings` las exponen junto a `delayLots`.
  - `panel.html`: dos controles nuevos en la sección de ajustes ("Modo mantenimiento" con un campo de mensaje y "Simular contrato 3.0.0"), y la tabla de ventas suma la columna "Anula a" (`sale.voidsSaleId`). Sacar cualquier listado de anulaciones.
  - `db.ts`: sacar `sale_voids`; `SCHEMA_VERSION = 4`.
  - `lots.ts`: sacar `case 'sale-void'`.

- [ ] **Step 4: correr** `pnpm test:backend` y `pnpm typecheck:backend` → PASS.

- [ ] **Step 5: commit** `feat(demo-backend): contrato 4.0.0 — /info, 409 incompatible, toggles y anulación como venta (#99)`

---

### Task 15: OpenAPI 4.0.0

**Files:**
- Modify: `docs/connector-api.openapi.yaml`

- [ ] **Step 1: editar**
  - `info.version: 4.0.0` y un párrafo de cambios respecto de 3.0.0 (anulación como venta, `/info`, header, 409).
  - `GET /info` con `BackendInfo` (`contractVersion`, `status` `ok|maintenance`, `message`, `backend`), autenticado, que **nunca** responde 409.
  - Parámetro de header `X-POS-Contract-Version` (componente reutilizable) en todos los endpoints, con la descripción de qué hace el backend si no es compatible y la respuesta `409` (`IncompatibleContract`: `code: incompatible-contract`, `contractVersion`) en push, pull y account-holds, con el razonamiento ("no es un rechazo de contenido: sin ack el lote queda en el outbox del POS").
  - `Sale`: `voidsSaleId` con descripción (anulación como ticket negativo, líneas y pagos invertidos, pago `account` sin `reference` = acreditación); `status` enum solo `closed`; sin `voidedAt`/`syncedAt`.
  - Sacar `SaleVoidEvent` del `oneOf` y de los schemas; `EventEnvelope` dice "7 tipos".
  - `StockMovement.reason`: `sale-void` marca los movimientos de una anulación.
- [ ] **Step 2: validar** que el YAML parsea: `node -e "require('js-yaml')"` si está disponible; si no, `pnpm dlx @redocly/cli lint docs/connector-api.openapi.yaml` (o el comando que use el repo: `grep -n openapi package.json`).
- [ ] **Step 3: commit** `docs(api): contrato 4.0.0 — /info, versión en cada request, 409 y anulación como venta (#99)`

---

### Task 16: E2E

**Files:**
- Create: `e2e/sale-stage-4.spec.ts`
- Modify: `e2e/offline-sale.spec.ts`, `e2e/keyboard-only.spec.ts`, `e2e/void-sale.spec.ts` y los specs que confirmen el cobro con Ctrl+Enter sobre campos vacíos (ahora Efectivo viene precargado; revisar que sigan pasando), `e2e/minibackend-sync.spec.ts` (si arma el backend con `sale-void`).

- [ ] **Step 1: escribir** `sale-stage-4.spec.ts` (con `test`/`expect` de `./fixtures.ts`, turno abierto con `openCashSession`):
  - Enter + Ctrl+Enter: agregar un producto por código, Enter con la barra vacía abre Cobro, Efectivo tiene el total seleccionado, Ctrl+Enter cierra y aparece el comprobante.
  - Cantidad `1,5*<código>` + Enter → la línea muestra `1,5`; con la línea seleccionada, `-2` + Enter → `-2`.
  - Devolución: `-1*regalo$100`, Enter → título "Devolver $ 100,00"; Ctrl+Enter cierra; en IndexedDB la venta tiene `total: -100` y un pago `cash` de `-100`.
  - Anular: cerrar una venta, `/ANULAR`, Enter, Enter → en IndexedDB hay dos ventas y la nueva tiene `voidsSaleId`; volver a `/ANULAR` → la original muestra "Anulada".
- [ ] **Step 2: correr** `pnpm build && pnpm test:e2e` → PASS (arreglar los specs viejos afectados).
- [ ] **Step 3: commit** `test(e2e): Enter para cobrar, cantidades, devolución y anulación como ticket (#99)`

---

### Task 17: Documentación, issues y prueba manual

**Files:**
- Modify: `CLAUDE.md`, `README.md` (si menciona Ctrl+Enter o `sale-void`), `docs/superpowers/specs/2026-09-24-venta-enter-cantidades-advertencias-design.md` (estado: implementado; desviaciones: stock en memoria de la tabla entera, Task 7; en Sheets la anulación nunca tuvo pestaña propia — eran columnas de Ventas, que dejan de escribirse, Task 12)

- [ ] **Step 1: CLAUDE.md**: actualizar "Patrón outbox" (sin `sale-void`; `LEGACY_OUTBOX_TYPES`), "Connector API" (4.0.0, 7 tipos, `/info`, header, 409, estado del backend), "UX keyboard-first" (Enter con la barra vacía, cantidades con signo y decimales), "Teclado y mouse" (Cobro y carrito ya incluidos), "Turno de caja" (anulación registrada en el turno hasta la Etapa 5), limpieza a 7 días (regla por venta), la barra de estado (dos estados nuevos), y una entrada en "Estado del proyecto" para la Etapa 4 con las desviaciones del plan.
- [ ] **Step 2: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`**, `pnpm test:backend` y `pnpm typecheck:backend` → todo verde.
- [ ] **Step 3: commit** `docs: CLAUDE.md y spec para la Etapa 4 (#99)`
- [ ] **Step 4: issues** (el usuario nunca edita issues a mano): comentar #100 (saldo de efectivo sin "− anulaciones"; `/RESUMEN` ya marca anuladas), #110 (hecho: ventana de 24 h y marcas; pendiente: búsqueda y ticket completo), #61 y #12 (se cierran con el PR), y tildar la Etapa 4 en #94 al mergear.
- [ ] **Step 5: prueba manual**: levantar el minibackend y la app (`pnpm preview` contra el build) y armar las instrucciones paso a paso para el usuario: vender con Enter + Ctrl+Enter, cantidades decimales y negativas, devolución, advertencias (bloquear un producto y un cliente desde `/_demo`, vender más que el stock), anular y ver las marcas en `/ANULAR` y `/RESUMEN`, toggles de mantenimiento y de contrato 3.0.0 (barra de estado, `/DIAGNOSTICO` y la prueba del wizard).
