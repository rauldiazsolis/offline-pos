# `/RESUMEN` (consulta de turno de caja) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar el comando `/RESUMEN` (tickets con detalle, cantidades de producto vendidas y
desglose por medio de pago del turno de caja) y simplificar `/CAJA` para que quede puramente
transaccional.

**Architecture:** Dos agregados nuevos en `domain/cash-session.ts` (puros, sin IO), un repositorio
nuevo (`storage/cash-summary-repository.ts`) que compone `CashSession`/`Sale[]`, un hook nuevo para
la navegación de teclado de la pestaña Tickets (`ui/hooks/use-ticket-list-navigation.ts`), y una
pantalla nueva (`ui/screens/cash-summary-screen.tsx`) con panel lateral fijo + 3 pestañas. `/CAJA`
pierde el bloque de resumen que hoy muestra en el paso `'open'` — sin otros cambios de código (el
resto del alcance de ese issue es el pase visual a modal, fuera de este plan).

**Tech Stack:** Preact + `@preact/signals`, Dexie, FlexSearch (ad-hoc, sin puerto de dominio nuevo
— ver spec), Vitest + Testing Library (preact) para unit/componentes, Playwright para e2e.

**Spec:** [`docs/superpowers/specs/2026-09-16-resumen-caja-design.md`](../specs/2026-09-16-resumen-caja-design.md)

## Global Constraints

- `any` prohibido; `unknown` solo en el borde de una función que valida con Zod en la línea
  siguiente (no aplica a este plan — no hay payloads externos nuevos).
- Toda función de negocio devuelve `Result<T>`, nunca lanza. `domain/` no importa `ui/`, `storage/`
  ni `sync/`.
- Nombres de campo/tipo nuevos, exactos, para que las tareas posteriores los consuman sin
  adivinar: `CashSessionSummary.totalCollected`, `CashSessionSummary.adjustmentTotal`,
  `ProductQuantity`, `calculateProductQuantities`, `getCashSummaryContext`, `CashSummaryContext`,
  `formatQuantity`, `useTicketListNavigation`.
- Tests de `storage/`/`ui/keyboard/`/`ui/screens/` que tocan Dexie importan `'fake-indexeddb/auto'`
  al principio del archivo. Tests de componentes usan aserciones planas de DOM
  (`expect(x).not.toBeNull()`), no `@testing-library/jest-dom`.
- Commits frecuentes, uno por tarea (o por sub-paso donde se indique), mensajes en el estilo ya
  usado en el repo (`feat:`/`fix:`/`test:`/`docs:` + descripción corta en español).

---

## Task 1: Código de error `cash-session/none-ever`

**Files:**
- Modify: `src/domain/result.ts`
- Modify: `src/ui/errors.ts`
- Test: `src/ui/errors.test.ts` (nuevo)

**Interfaces:**
- Produces: `ErrorMeta['cash-session/none-ever'] = undefined` (código de error nuevo, distinto de
  `cash-session/none-open` — este último exige un turno *abierto*, éste exige que exista
  *cualquier* turno, abierto o cerrado).

- [x] **Step 1: Escribir el test que falla**

```typescript
// src/ui/errors.test.ts
import { describe, expect, it } from 'vitest';
import { describeError } from './errors.ts';

describe('describeError', () => {
  it('cash-session/none-ever', () => {
    const message = describeError({ ok: false, error: 'cash-session/none-ever', meta: undefined });

    expect(message).toBe('No hay ningún turno de caja para consultar.');
  });
});
```

- [x] **Step 2: Confirmar que falla**

Run: `pnpm vitest run src/ui/errors.test.ts`
Expected: FAIL — TypeScript no compila todavía (`'cash-session/none-ever'` no es un `ErrorCode`
válido hasta el Step 3).

- [x] **Step 3: Agregar el código al registro central y traducirlo**

En `src/domain/result.ts`, dentro de `ErrorMeta`, justo debajo de `'cash-session/persist-failed'`:

```typescript
  // cash-session.ts, storage/cash-session-repository.ts
  'cash-session/invalid-amount': { amount: number };
  'cash-session/already-open': undefined;
  'cash-session/none-open': undefined;
  'cash-session/already-closed': undefined;
  'cash-session/persist-failed': { message: string };
  'cash-session/none-ever': undefined; // storage/cash-summary-repository.ts
```

En `src/ui/errors.ts`, dentro del `switch`, justo debajo del `case 'cash-session/persist-failed':`:

```typescript
    case 'cash-session/persist-failed':
      return `No se pudo guardar el turno de caja (${failure.meta.message}).`;
    case 'cash-session/none-ever':
      return 'No hay ningún turno de caja para consultar.';
```

- [x] **Step 4: Confirmar que pasa**

Run: `pnpm vitest run src/ui/errors.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/domain/result.ts src/ui/errors.ts src/ui/errors.test.ts
git commit -m "feat: código de error cash-session/none-ever para /RESUMEN"
```

---

## Task 2: Dominio — `totalCollected` y `adjustmentTotal` en `CashSessionSummary`

**Files:**
- Modify: `src/domain/cash-session.ts`
- Modify: `src/domain/cash-session.test.ts`
- Modify: `src/storage/cash-session-repository.test.ts` (sus `toEqual` sobre `summary` ganan los
  dos campos nuevos)

**Interfaces:**
- Produces: `CashSessionSummary.totalCollected: number`, `CashSessionSummary.adjustmentTotal: number`
  (además de los campos que ya existían: `salesCount`, `totalsByMethod`, `expectedCash`,
  `countedCash?`, `difference?`).

- [x] **Step 1: Escribir los tests que fallan**

En `src/domain/cash-session.test.ts`, dentro de `describe('calculateCashSessionSummary', ...)`,
agregar (y ajustar los `toEqual` existentes en el mismo `describe`, ver Step 2b):

```typescript
  it('adjustmentTotal suma el ajuste (línea + global) de las ventas cerradas, con signo', () => {
    const session: CashSession = { id: 'cs1', openedAt: '2026-01-01T09:00:00.000Z', openingAmount: 0, sales: ['s1', 's2'] };
    const sales = [
      // Línea de $200 con un descuento de línea de $20 → total $180 (subtotal bruto $200).
      buildSale({
        id: 's1',
        lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100, discount: { type: 'amount', value: 20 } }],
        payments: [{ method: 'cash', amount: 180 }],
        total: 180,
      }),
      // Subtotal bruto $100, recargo global aplicado → total $110.
      buildSale({
        id: 's2',
        lines: [{ kind: 'product', productId: 'p2', qty: 1, unitPrice: 100 }],
        payments: [{ method: 'cash', amount: 110 }],
        total: 110,
        globalAdjustmentPercentage: 10,
      }),
    ];

    const summary = calculateCashSessionSummary(session, sales);

    expect(summary.adjustmentTotal).toBe(-10); // -20 (descuento) + 10 (recargo)
  });

  it('totalCollected es la suma de todos los medios de pago', () => {
    const session: CashSession = { id: 'cs1', openedAt: '2026-01-01T09:00:00.000Z', openingAmount: 0, sales: ['s1'] };
    const sales = [buildSale({ id: 's1', payments: [{ method: 'cash', amount: 60 }, { method: 'debit', amount: 40 }], total: 100 })];

    const summary = calculateCashSessionSummary(session, sales);

    expect(summary.totalCollected).toBe(100);
  });
```

**Step 2b — ajustar los 3 `toEqual` que ya existen en `calculateCashSessionSummary`** (en el mismo
archivo, y en `src/storage/cash-session-repository.test.ts::closeCashSessionAndPersist`) para
incluir los dos campos nuevos. Ejemplo del primero en `cash-session.test.ts`:

```typescript
    expect(summary).toEqual({
      salesCount: 2,
      totalsByMethod: { cash: 100, debit: 200, credit: 0, transfer: 0, qr: 0, account: 0 },
      totalCollected: 300,
      adjustmentTotal: 0,
      expectedCash: 600,
    });
```

Mismo criterio para el segundo (`agrega countedCash/difference...`, agrega `totalCollected: 100,
adjustmentTotal: 0,`), el tercero (`excluye una venta anulada...`, agrega `totalCollected: 100,
adjustmentTotal: 0,` — la venta anulada no debe sumar a ninguno de los dos), y el de
`cash-session-repository.test.ts` (`totalCollected: 100, adjustmentTotal: 0,`).

- [x] **Step 2: Confirmar que fallan**

Run: `pnpm vitest run src/domain/cash-session.test.ts src/storage/cash-session-repository.test.ts`
Expected: FAIL — `summary.adjustmentTotal`/`summary.totalCollected` son `undefined`, y los
`toEqual` no matchean (les faltan los campos nuevos en el objeto real).

- [x] **Step 3: Implementar**

En `src/domain/cash-session.ts`, actualizar el tipo y la función:

```typescript
export type CashSessionSummary = {
  salesCount: number;
  totalsByMethod: Record<Payment['method'], number>;
  totalCollected: number;
  adjustmentTotal: number;
  expectedCash: number;
  countedCash?: number;
  difference?: number;
};

/** Subtotal bruto de una venta, sin descuentos ni ajustes — para derivar `adjustmentTotal`. */
function rawLinesSubtotal(lines: Sale['lines']): number {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
}

export function calculateCashSessionSummary(
  session: CashSession,
  sales: Sale[],
): CashSessionSummary {
  const closedSales = sales.filter((sale) => sale.status === 'closed');
  const totalsByMethod: Record<Payment['method'], number> = {
    cash: 0,
    debit: 0,
    credit: 0,
    transfer: 0,
    qr: 0,
    account: 0,
  };
  let adjustmentTotal = 0;
  for (const sale of closedSales) {
    for (const payment of sale.payments) {
      totalsByMethod[payment.method] += payment.amount;
    }
    adjustmentTotal += sale.total - rawLinesSubtotal(sale.lines);
  }
  const totalCollected = Object.values(totalsByMethod).reduce((sum, amount) => sum + amount, 0);
  const expectedCash = session.openingAmount + totalsByMethod.cash;
  const base: CashSessionSummary = {
    salesCount: closedSales.length,
    totalsByMethod,
    totalCollected,
    adjustmentTotal,
    expectedCash,
  };
  return session.closingAmount !== undefined
    ? { ...base, countedCash: session.closingAmount, difference: session.closingAmount - expectedCash }
    : base;
}
```

(`Sale` ya está importado en el archivo; no hace falta un import nuevo.)

- [x] **Step 4: Confirmar que pasan**

Run: `pnpm vitest run src/domain/cash-session.test.ts src/storage/cash-session-repository.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/domain/cash-session.ts src/domain/cash-session.test.ts src/storage/cash-session-repository.test.ts
git commit -m "feat: totalCollected y adjustmentTotal en CashSessionSummary"
```

---

## Task 3: Dominio — `calculateProductQuantities`

**Files:**
- Modify: `src/domain/cash-session.ts`
- Modify: `src/domain/cash-session.test.ts`

**Interfaces:**
- Consumes: `Sale`, `SaleLine` (`domain/sale.ts`, ya existentes).
- Produces: `export type ProductQuantity = { productId: string; qty: number }`,
  `export function calculateProductQuantities(sales: Sale[]): ProductQuantity[]`.

- [x] **Step 1: Escribir el test que falla**

Agregar a `src/domain/cash-session.test.ts`:

```typescript
describe('calculateProductQuantities', () => {
  it('agrupa por productId, sumando cantidades entre ventas', () => {
    const sales = [
      buildSale({ id: 's1', lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }] }),
      buildSale({ id: 's2', lines: [{ kind: 'product', productId: 'p1', qty: 3, unitPrice: 100 }, { kind: 'product', productId: 'p2', qty: 1, unitPrice: 50 }] }),
    ];

    const result = calculateProductQuantities(sales);

    expect(result).toEqual(
      expect.arrayContaining([{ productId: 'p1', qty: 5 }, { productId: 'p2', qty: 1 }]),
    );
    expect(result).toHaveLength(2);
  });

  it('ignora líneas libres (sin identidad de producto)', () => {
    const sales = [
      buildSale({ id: 's1', lines: [{ kind: 'freeform', description: 'Regalo', qty: 1, unitPrice: 100 }] }),
    ];

    expect(calculateProductQuantities(sales)).toEqual([]);
  });

  it('excluye ventas anuladas', () => {
    const sales = [
      buildSale({ id: 's1', lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }], status: 'voided', voidedAt: '2026-01-01T11:00:00.000Z' }),
    ];

    expect(calculateProductQuantities(sales)).toEqual([]);
  });
});
```

- [x] **Step 2: Confirmar que falla**

Run: `pnpm vitest run src/domain/cash-session.test.ts`
Expected: FAIL — `calculateProductQuantities` no existe todavía.

- [x] **Step 3: Implementar**

Agregar al final de `src/domain/cash-session.ts`:

```typescript
export type ProductQuantity = { productId: string; qty: number };

/**
 * Cantidad total vendida de cada producto del catálogo, sobre ventas cerradas de las `Sale[]`
 * pasadas — pura, sin ordenar ni redondear (eso es responsabilidad de la UI). Solo agrupa líneas
 * `kind: 'product'`: una línea libre no tiene identidad de producto contra la que fusionar (mismo
 * criterio que `domain/cart.ts::addFreeformLine`).
 */
export function calculateProductQuantities(sales: Sale[]): ProductQuantity[] {
  const closedSales = sales.filter((sale) => sale.status === 'closed');
  const qtyByProduct = new Map<string, number>();
  for (const sale of closedSales) {
    for (const line of sale.lines) {
      if (line.kind !== 'product') continue;
      qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.qty);
    }
  }
  return [...qtyByProduct].map(([productId, qty]) => ({ productId, qty }));
}
```

- [x] **Step 4: Confirmar que pasa**

Run: `pnpm vitest run src/domain/cash-session.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/domain/cash-session.ts src/domain/cash-session.test.ts
git commit -m "feat: calculateProductQuantities en el dominio de caja"
```

---

## Task 4: Storage — `getMostRecentClosedCashSession`

**Files:**
- Modify: `src/storage/cash-session-repository.ts`
- Modify: `src/storage/cash-session-repository.test.ts`

**Interfaces:**
- Produces: `export async function getMostRecentClosedCashSession(): Promise<CashSession | undefined>`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `src/storage/cash-session-repository.test.ts`:

```typescript
describe('getMostRecentClosedCashSession', () => {
  it('undefined si no hay ningún turno cerrado', async () => {
    expect(await getMostRecentClosedCashSession()).toBeUndefined();
  });

  it('devuelve el turno cerrado más reciente, no el más viejo', async () => {
    await openCashSessionAndPersist({ openingAmount: 100 });
    await closeCashSessionAndPersist({ closingAmount: 100 });
    await openCashSessionAndPersist({ openingAmount: 200 });
    await closeCashSessionAndPersist({ closingAmount: 200 });

    const mostRecent = await getMostRecentClosedCashSession();

    expect(mostRecent?.openingAmount).toBe(200);
  });

  it('ignora un turno abierto — solo mira cerrados', async () => {
    await openCashSessionAndPersist({ openingAmount: 100 });
    await closeCashSessionAndPersist({ closingAmount: 100 });
    await openCashSessionAndPersist({ openingAmount: 999 }); // queda abierto

    const mostRecent = await getMostRecentClosedCashSession();

    expect(mostRecent?.openingAmount).toBe(100);
  });
});
```

Y sumar `getMostRecentClosedCashSession` al `import` del archivo.

- [ ] **Step 2: Confirmar que falla**

Run: `pnpm vitest run src/storage/cash-session-repository.test.ts`
Expected: FAIL — la función no existe.

- [ ] **Step 3: Implementar**

En `src/storage/cash-session-repository.ts`, debajo de `getCurrentOpenCashSession`:

```typescript
/** El turno cerrado más reciente, si hay alguno — mismo criterio de "toArray() alcanza" que getCurrentOpenCashSession. */
export async function getMostRecentClosedCashSession(): Promise<CashSession | undefined> {
  const sessions = await db.cashSessions.toArray();
  const closed = sessions.filter((session) => session.closedAt !== undefined);
  closed.sort((a, b) => (b.closedAt as string).localeCompare(a.closedAt as string));
  return closed[0];
}
```

- [ ] **Step 4: Confirmar que pasa**

Run: `pnpm vitest run src/storage/cash-session-repository.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/cash-session-repository.ts src/storage/cash-session-repository.test.ts
git commit -m "feat: getMostRecentClosedCashSession"
```

---

## Task 5: Storage — `cash-summary-repository.ts` (`getCashSummaryContext`)

**Files:**
- Create: `src/storage/cash-summary-repository.ts`
- Test: `src/storage/cash-summary-repository.test.ts`

**Interfaces:**
- Consumes: `getCurrentOpenCashSession`, `getMostRecentClosedCashSession` (Task 4,
  `storage/cash-session-repository.ts`), `calculateCashSessionSummary` (Task 2,
  `domain/cash-session.ts`), `db` (`storage/db.ts`).
- Produces: `export type CashSummaryContext = { session: CashSession; summary: CashSessionSummary;
  sales: Sale[]; isClosed: boolean }`, `export async function getCashSummaryContext():
  Promise<CashSummaryContext | undefined>` (`undefined` = gate caso 1, "nunca hubo ningún turno").

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/storage/cash-summary-repository.test.ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeCashSessionAndPersist, getCurrentOpenCashSession, openCashSessionAndPersist } from './cash-session-repository.ts';
import { getCashSummaryContext } from './cash-summary-repository.ts';
import { db } from './db.ts';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('getCashSummaryContext', () => {
  it('undefined si nunca hubo ningún turno', async () => {
    expect(await getCashSummaryContext()).toBeUndefined();
  });

  it('con un turno abierto, isClosed es false y trae sus ventas', async () => {
    await openCashSessionAndPersist({ openingAmount: 100 });
    const open = await getCurrentOpenCashSession();
    await db.sales.add({ id: 's1', lines: [], payments: [{ method: 'cash', amount: 50 }], total: 50, status: 'closed', createdAt: '2026-01-01T10:00:00.000Z' });
    if (open !== undefined) await db.cashSessions.put({ ...open, sales: ['s1'] });

    const context = await getCashSummaryContext();

    expect(context?.isClosed).toBe(false);
    expect(context?.sales).toHaveLength(1);
    expect(context?.summary.salesCount).toBe(1);
  });

  it('sin turno abierto, cae al turno cerrado más reciente con isClosed true', async () => {
    await openCashSessionAndPersist({ openingAmount: 100 });
    await closeCashSessionAndPersist({ closingAmount: 100 });

    const context = await getCashSummaryContext();

    expect(context?.isClosed).toBe(true);
    expect(context?.session.closingAmount).toBe(100);
  });
});
```

- [ ] **Step 2: Confirmar que falla**

Run: `pnpm vitest run src/storage/cash-summary-repository.test.ts`
Expected: FAIL — el archivo `cash-summary-repository.ts` no existe.

- [ ] **Step 3: Implementar**

```typescript
// src/storage/cash-summary-repository.ts
import { calculateCashSessionSummary, type CashSession, type CashSessionSummary } from '../domain/cash-session.ts';
import type { Sale } from '../domain/sale.ts';
import { getCurrentOpenCashSession, getMostRecentClosedCashSession } from './cash-session-repository.ts';
import { db } from './db.ts';

export type CashSummaryContext = {
  session: CashSession;
  summary: CashSessionSummary;
  sales: Sale[];
  isClosed: boolean;
};

/**
 * Compone los datos para `/RESUMEN` — a diferencia de `cash-session-repository.ts` (enfocado en el
 * ciclo de vida abrir/cerrar), esto arma la vista de consulta: el turno abierto si hay uno, si no
 * el cerrado más reciente (gate caso 3), o `undefined` si nunca hubo ningún turno (gate caso 1).
 */
export async function getCashSummaryContext(): Promise<CashSummaryContext | undefined> {
  const open = await getCurrentOpenCashSession();
  const session = open ?? (await getMostRecentClosedCashSession());
  if (session === undefined) {
    return undefined;
  }
  const sales = (await db.sales.bulkGet(session.sales)).filter((sale): sale is Sale => sale !== undefined);
  return {
    session,
    summary: calculateCashSessionSummary(session, sales),
    sales,
    isClosed: session.closedAt !== undefined,
  };
}
```

- [ ] **Step 4: Confirmar que pasa**

Run: `pnpm vitest run src/storage/cash-summary-repository.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/cash-summary-repository.ts src/storage/cash-summary-repository.test.ts
git commit -m "feat: storage/cash-summary-repository.ts (getCashSummaryContext)"
```

---

## Task 6: `ui/format.ts` — `formatQuantity`

**Files:**
- Modify: `src/ui/format.ts`
- Test: `src/ui/format.test.ts` (crear si no existe — confirmar primero con `ls src/ui/format.test.ts`;
  si ya existe, agregar el `describe` ahí)

**Interfaces:**
- Produces: `export function formatQuantity(qty: number): string` — redondea a 3 decimales, sin
  ceros de más a la derecha (`5.950` → `"5.95"`, `5.9514999` → `"5.951"`, `3` → `"3"`).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/ui/format.test.ts
import { describe, expect, it } from 'vitest';
import { formatQuantity } from './format.ts';

describe('formatQuantity', () => {
  it('entero sin decimales', () => {
    expect(formatQuantity(3)).toBe('3');
  });

  it('redondea a 3 decimales', () => {
    expect(formatQuantity(5.9514999)).toBe('5.951');
  });

  it('sin ceros de más a la derecha', () => {
    expect(formatQuantity(5.95)).toBe('5.95');
    expect(formatQuantity(5.9500000000000005)).toBe('5.95');
  });
});
```

- [ ] **Step 2: Confirmar que falla**

Run: `pnpm vitest run src/ui/format.test.ts`
Expected: FAIL — `formatQuantity` no existe.

- [ ] **Step 3: Implementar**

Agregar a `src/ui/format.ts`:

```typescript
/**
 * Cantidad vendida, redondeada a 3 decimales sin ceros de más a la derecha — necesario para
 * productos vendidos por peso, donde puede haber arrastre de punto flotante (ej.
 * `5.9510000000000005`). `Number(...toFixed(3))` recorta y también saca los ceros de sobra al
 * volver a stringificar.
 */
export function formatQuantity(qty: number): string {
  return String(Number(qty.toFixed(3)));
}
```

- [ ] **Step 4: Confirmar que pasa**

Run: `pnpm vitest run src/ui/format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/format.ts src/ui/format.test.ts
git commit -m "feat: formatQuantity"
```

---

## Task 7: Estado — `ActiveScreen` + `ui/state/cash-summary.ts`

**Files:**
- Modify: `src/ui/state/screen.ts`
- Create: `src/ui/state/cash-summary.ts`

**Interfaces:**
- Produces: `ActiveScreen` incluye `'cash-summary'`. Signals:
  `cashSummaryContextSignal: Signal<CashSummaryContext | undefined>`,
  `cashSummaryTabSignal: Signal<'tickets' | 'products' | 'payments'>`,
  `ticketFilterSignal: Signal<string>`, `productFilterSignal: Signal<string>`,
  `selectedTicketIndexSignal: Signal<number>`, `selectedProductIndexSignal: Signal<number | null>`.

Sin lógica que testear (son declaraciones de signals, mismo criterio que `ui/state/cash-session.ts`
— no tiene test propio). No hay ciclo TDD acá; es la base que consumen las tareas siguientes.

- [ ] **Step 1: `ActiveScreen`**

En `src/ui/state/screen.ts`:

```typescript
export type ActiveScreen = 'sale' | 'checkout' | 'receipt' | 'void' | 'config' | 'cash' | 'cash-summary' | 'demo-reset';
```

- [ ] **Step 2: Nuevo módulo de estado**

```typescript
// src/ui/state/cash-summary.ts
import { signal } from '@preact/signals';
import type { CashSummaryContext } from '../../storage/cash-summary-repository.ts';

/**
 * Estado de `/RESUMEN` — un signal por responsabilidad, mismo patrón que `cash-session.ts`.
 * `selectedTicketIndexSignal` arranca en `0` (no `null`): a diferencia de los overlays de la barra
 * de comandos, acá siempre hay "algún" ticket seleccionado apenas hay al menos uno (no hay ningún
 * estado "nada elegido" con la lista no vacía).
 */
export const cashSummaryContextSignal = signal<CashSummaryContext | undefined>(undefined);
export const cashSummaryTabSignal = signal<'tickets' | 'products' | 'payments'>('tickets');
export const ticketFilterSignal = signal('');
export const productFilterSignal = signal('');
export const selectedTicketIndexSignal = signal(0);
export const selectedProductIndexSignal = signal<number | null>(null);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck` (o `tsc --noEmit`, según el script real del `package.json`)
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add src/ui/state/screen.ts src/ui/state/cash-summary.ts
git commit -m "feat: estado de /RESUMEN (ActiveScreen + ui/state/cash-summary.ts)"
```

---

## Task 8: Hook — `use-ticket-list-navigation.ts`

Esta es la pieza más delicada del plan — la mecánica de scroll/selección de la pestaña Tickets, ya
validada contra un prototipo interactivo (ver la sección correspondiente del spec). El hook expone
el mismo comportamiento probado ahí, ahora como código de producción con tests.

**Files:**
- Create: `src/ui/hooks/use-ticket-list-navigation.ts`
- Test: `src/ui/hooks/use-ticket-list-navigation.test.ts`

**Interfaces:**
- Consumes: un `Signal<number>` externo para la selección (`selectedTicketIndexSignal`, Task 7) y
  una lista de elementos DOM (vía refs, igual criterio que `useScrollSelectedIntoView`).
- Produces:

```typescript
export type TicketListNavigation = {
  /** Ref callback para el contenedor con scroll (el `<div>` que envuelve todos los tickets). */
  containerRef: (el: HTMLDivElement | null) => void;
  /** Ref callback para el ticket de índice `i` — se llama una vez por fila renderizada. */
  ticketRef: (index: number) => (el: HTMLDivElement | null) => void;
  /** Maneja ArrowUp/ArrowDown/PageUp/PageDown — `false` si la tecla no es ninguna de esas (el caller decide qué hacer). */
  handleKeyDown: (event: KeyboardEvent) => boolean;
};

export function useTicketListNavigation(
  selectedIndex: Signal<number>,
  ticketCount: number,
): TicketListNavigation;
```

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// src/ui/hooks/use-ticket-list-navigation.test.ts
import { signal } from '@preact/signals';
import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { useTicketListNavigation } from './use-ticket-list-navigation.ts';

/**
 * jsdom no calcula layout real (`offsetTop`/`offsetHeight` son 0 salvo que se los fuerce a mano) —
 * el harness de este test define geometría explícita por ticket para poder probar la mecánica sin
 * un navegador real. Cada entrada es la altura en px; las cabeceras se fuerzan a 40px.
 */
function TestHarness({
  heights,
  headerHeight = 40,
  clientHeight = 300,
  selectedIndex,
  onKeyDownResult,
}: {
  heights: number[];
  headerHeight?: number;
  clientHeight?: number;
  selectedIndex: ReturnType<typeof signal<number>>;
  onKeyDownResult?: (handled: boolean) => void;
}) {
  const nav = useTicketListNavigation(selectedIndex, heights.length);
  let offsetTop = 0;
  const offsets = heights.map((h) => {
    const top = offsetTop;
    offsetTop += h;
    return top;
  });

  return (
    <div
      data-testid="container"
      ref={(el) => {
        nav.containerRef(el);
        if (el !== null) {
          Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
          Object.defineProperty(el, 'scrollHeight', { value: offsetTop, configurable: true });
        }
      }}
      onKeyDown={(e) => {
        const handled = nav.handleKeyDown(e as unknown as KeyboardEvent);
        onKeyDownResult?.(handled);
      }}
    >
      {heights.map((h, i) => (
        <div
          key={i}
          data-testid={`ticket-${i}`}
          ref={(el) => {
            nav.ticketRef(i)(el);
            if (el !== null) {
              Object.defineProperty(el, 'offsetTop', { value: offsets[i], configurable: true });
              Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true });
              const header = document.createElement('div');
              header.className = 'ticket__header';
              Object.defineProperty(header, 'offsetHeight', { value: headerHeight, configurable: true });
              el.appendChild(header);
            }
          }}
        />
      ))}
    </div>
  );
}

describe('useTicketListNavigation', () => {
  it('ArrowDown repetido recorre los 3 tickets en orden, sin saltear el corto', () => {
    const selectedIndex = signal(0);
    // Ticket 1 corto (60px, ventana angosta comparada al paso de 64px).
    const { getByTestId } = render(
      <TestHarness heights={[400, 60, 400]} selectedIndex={selectedIndex} />,
    );
    const container = getByTestId('container');

    const seen = new Set([selectedIndex.value]);
    for (let i = 0; i < 30; i++) {
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      seen.add(selectedIndex.value);
    }

    expect(seen).toEqual(new Set([0, 1, 2]));
    expect(selectedIndex.value).toBe(2); // termina en el último
  });

  it('PageDown salta directo al siguiente índice', () => {
    const selectedIndex = signal(0);
    const { getByTestId } = render(<TestHarness heights={[400, 400, 400]} selectedIndex={selectedIndex} />);
    const container = getByTestId('container');

    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));

    expect(selectedIndex.value).toBe(1);
  });

  it('en el tramo final más corto que el viewport, ArrowDown sigue avanzando el cursor sin scroll disponible', () => {
    const selectedIndex = signal(0);
    // clientHeight 300, últimos dos tickets suman 150px — menos que el viewport.
    const { getByTestId } = render(
      <TestHarness heights={[400, 80, 70]} clientHeight={300} selectedIndex={selectedIndex} />,
    );
    const container = getByTestId('container');

    for (let i = 0; i < 15; i++) {
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    }

    expect(selectedIndex.value).toBe(2);
  });

  it('ignora teclas que no son de navegación', () => {
    const selectedIndex = signal(0);
    let handled: boolean | undefined;
    const { getByTestId } = render(
      <TestHarness heights={[400]} selectedIndex={selectedIndex} onKeyDownResult={(h) => { handled = h; }} />,
    );

    getByTestId('container').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));

    expect(handled).toBe(false);
  });
});
```

- [ ] **Step 2: Confirmar que falla**

Run: `pnpm vitest run src/ui/hooks/use-ticket-list-navigation.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```typescript
// src/ui/hooks/use-ticket-list-navigation.ts
import type { Signal } from '@preact/signals';
import { useRef } from 'preact/hooks';

const STEP_PX = 64;

export type TicketListNavigation = {
  containerRef: (el: HTMLDivElement | null) => void;
  ticketRef: (index: number) => (el: HTMLDivElement | null) => void;
  handleKeyDown: (event: KeyboardEvent) => boolean;
};

/**
 * Navegación de teclado de la pestaña Tickets de `/RESUMEN` — mecánica validada contra un
 * prototipo interactivo (ver spec, sección "Interacción de teclado, pestaña Tickets"). Resumen:
 *
 * - Selección por ticket completo, geométrica: qué ticket tiene la cabecera pegada arriba en una
 *   posición de scroll dada (`indexAtScrollPosition`), con la corrección de que una cabecera
 *   `position: sticky` se empuja fuera de vista una franja tan ancha como ella misma *antes* de
 *   llegar al `offsetTop` del siguiente ticket (no puede stickear más allá del borde inferior de
 *   su propio contenedor).
 * - Scroll instantáneo, no animado (`behavior: 'smooth'` se pisa a sí mismo con teclas repetidas
 *   rápido — auto-repeat real del teclado).
 * - Un paso de flecha se recorta si saltearía la ventana de selección completa de un ticket corto,
 *   para pararse justo en su borde en vez de seguir de largo.
 * - Cuando ya no hay scroll disponible en una dirección pero todavía quedan tickets (tramo final
 *   más corto que el viewport, donde ningún ticket ahí llega a pegar su cabecera del todo arriba),
 *   el cursor camina directo, un ticket a la vez, sin acompañarse de scroll.
 */
export function useTicketListNavigation(
  selectedIndex: Signal<number>,
  ticketCount: number,
): TicketListNavigation {
  const containerElRef = useRef<HTMLDivElement | null>(null);
  const ticketElsRef = useRef(new Map<number, HTMLDivElement>());
  const scrollTargetRef = useRef(0);

  function els(): HTMLDivElement[] {
    const map = ticketElsRef.current;
    const result: HTMLDivElement[] = [];
    for (let i = 0; i < ticketCount; i++) {
      const el = map.get(i);
      if (el !== undefined) result.push(el);
    }
    return result;
  }

  function maxScroll(container: HTMLDivElement): number {
    return container.scrollHeight - container.clientHeight;
  }

  function indexAtScrollPosition(pos: number): number {
    const list = els();
    if (list.length === 0) return 0;
    let chosen = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].offsetTop > pos) break;
      chosen = i;
    }
    const header = list[chosen].querySelector<HTMLElement>('.ticket__header');
    const headerH = header !== null ? header.offsetHeight : 0;
    const pushOff = list[chosen].offsetTop + list[chosen].offsetHeight - headerH;
    if (pos >= pushOff && chosen < list.length - 1) chosen += 1;
    return chosen;
  }

  function applyScroll(container: HTMLDivElement, target: number): void {
    const max = maxScroll(container);
    scrollTargetRef.current = Math.max(0, Math.min(target, max));
    container.scrollTop = scrollTargetRef.current;
    selectedIndex.value = indexAtScrollPosition(scrollTargetRef.current);
  }

  function selectIndex(container: HTMLDivElement, idx: number): void {
    const list = els();
    if (idx < 0 || idx >= list.length) return;
    const max = maxScroll(container);
    scrollTargetRef.current = Math.min(list[idx].offsetTop, max);
    container.scrollTop = scrollTargetRef.current;
    selectedIndex.value = idx;
  }

  function stepScroll(container: HTMLDivElement, direction: 1 | -1): void {
    const list = els();
    if (list.length === 0) return;
    const curIdx = selectedIndex.value;
    const max = maxScroll(container);
    let proposed = Math.max(0, Math.min(scrollTargetRef.current + direction * STEP_PX, max));
    const proposedIdx = indexAtScrollPosition(proposed);
    if (direction > 0 && proposedIdx > curIdx + 1 && curIdx + 1 < list.length) {
      proposed = Math.min(list[curIdx + 1].offsetTop, max);
    } else if (direction < 0 && proposedIdx < curIdx - 1 && curIdx - 1 >= 0) {
      proposed = Math.min(list[curIdx - 1].offsetTop, max);
    }
    if (proposed === scrollTargetRef.current) {
      if (direction > 0 && curIdx < list.length - 1) selectIndex(container, curIdx + 1);
      else if (direction < 0 && curIdx > 0) selectIndex(container, curIdx - 1);
      return;
    }
    applyScroll(container, proposed);
  }

  function handleKeyDown(event: KeyboardEvent): boolean {
    const container = containerElRef.current;
    if (container === null) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      stepScroll(container, 1);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      stepScroll(container, -1);
      return true;
    }
    if (event.key === 'PageDown') {
      event.preventDefault();
      selectIndex(container, Math.min(selectedIndex.value + 1, ticketCount - 1));
      return true;
    }
    if (event.key === 'PageUp') {
      event.preventDefault();
      selectIndex(container, Math.max(selectedIndex.value - 1, 0));
      return true;
    }
    return false;
  }

  return {
    containerRef: (el) => {
      containerElRef.current = el;
    },
    ticketRef: (index) => (el) => {
      if (el === null) ticketElsRef.current.delete(index);
      else ticketElsRef.current.set(index, el);
    },
    handleKeyDown,
  };
}
```

- [ ] **Step 4: Confirmar que pasa**

Run: `pnpm vitest run src/ui/hooks/use-ticket-list-navigation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/use-ticket-list-navigation.ts src/ui/hooks/use-ticket-list-navigation.test.ts
git commit -m "feat: hook de navegación de teclado para la pestaña Tickets de /RESUMEN"
```

---

## Task 9: Controller — `cash-summary-controller.ts` + comando `/RESUMEN`

**Files:**
- Create: `src/ui/keyboard/cash-summary-controller.ts`
- Test: `src/ui/keyboard/cash-summary-controller.test.ts`
- Modify: `src/ui/keyboard/commands.ts`
- Modify: `src/ui/keyboard/command-bar-controller.ts`

**Interfaces:**
- Consumes: `getCashSummaryContext` (Task 5), `activeScreenSignal` (`ui/state/screen.ts`), los
  signals de Task 7, `commandBarErrorSignal`/`clearBuffer` (ya existentes en
  `ui/state/command-bar.ts`/`command-bar-controller.ts`), `describeError` (`ui/errors.ts`).
- Produces: `export async function triggerCashSummary(): Promise<void>`,
  `export function exitCashSummaryScreen(): void`,
  `export function setCashSummaryTab(tab: 'tickets' | 'products' | 'payments'): void`,
  `export function updateTicketFilter(value: string): void`,
  `export function updateProductFilter(value: string): void`.

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// src/ui/keyboard/cash-summary-controller.test.ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openCashSessionAndPersist } from '../../storage/cash-session-repository.ts';
import { db } from '../../storage/db.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { cashSummaryContextSignal, cashSummaryTabSignal, selectedTicketIndexSignal, ticketFilterSignal } from '../state/cash-summary.ts';
import { commandBarErrorSignal } from '../state/command-bar.ts';
import { exitCashSummaryScreen, setCashSummaryTab, triggerCashSummary, updateTicketFilter } from './cash-summary-controller.ts';

beforeEach(async () => {
  await db.open();
  activeScreenSignal.value = 'sale';
  cashSummaryContextSignal.value = undefined;
  cashSummaryTabSignal.value = 'tickets';
  ticketFilterSignal.value = '';
  selectedTicketIndexSignal.value = 0;
  commandBarErrorSignal.value = null;
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('triggerCashSummary', () => {
  it('sin ningún turno, error en la barra de comandos y no navega', async () => {
    await triggerCashSummary();

    expect(activeScreenSignal.value).toBe('sale');
    expect(commandBarErrorSignal.value).toBe('No hay ningún turno de caja para consultar.');
  });

  it('con un turno abierto, navega y carga el contexto', async () => {
    await openCashSessionAndPersist({ openingAmount: 100 });

    await triggerCashSummary();

    expect(activeScreenSignal.value).toBe('cash-summary');
    expect(cashSummaryContextSignal.value?.isClosed).toBe(false);
  });
});

describe('exitCashSummaryScreen', () => {
  it('resetea el estado y vuelve a la venta', async () => {
    await openCashSessionAndPersist({ openingAmount: 100 });
    await triggerCashSummary();
    ticketFilterSignal.value = 'algo';

    exitCashSummaryScreen();

    expect(activeScreenSignal.value).toBe('sale');
    expect(cashSummaryContextSignal.value).toBeUndefined();
    expect(ticketFilterSignal.value).toBe('');
  });
});

describe('setCashSummaryTab', () => {
  it('cambia de pestaña y limpia el filtro de la que se abandona', () => {
    ticketFilterSignal.value = 'algo';

    setCashSummaryTab('products');

    expect(cashSummaryTabSignal.value).toBe('products');
    expect(ticketFilterSignal.value).toBe('');
  });
});

describe('updateTicketFilter', () => {
  it('actualiza el signal de filtro de tickets', () => {
    updateTicketFilter('torres');

    expect(ticketFilterSignal.value).toBe('torres');
  });
});
```

- [ ] **Step 2: Confirmar que falla**

Run: `pnpm vitest run src/ui/keyboard/cash-summary-controller.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

`src/ui/keyboard/commands.ts` — agregar al array, después de `'CAJA'`:

```typescript
  { name: 'CAJA', description: 'Abrir o cerrar el turno de caja' },
  { name: 'RESUMEN', description: 'Consultar tickets, productos y medios de pago del turno' },
```

`src/ui/keyboard/cash-summary-controller.ts`:

```typescript
import { getCashSummaryContext } from '../../storage/cash-summary-repository.ts';
import { describeError } from '../errors.ts';
import { commandBarErrorSignal } from '../state/command-bar.ts';
import {
  cashSummaryContextSignal,
  cashSummaryTabSignal,
  productFilterSignal,
  selectedProductIndexSignal,
  selectedTicketIndexSignal,
  ticketFilterSignal,
} from '../state/cash-summary.ts';
import { activeScreenSignal } from '../state/screen.ts';

/** Capa de glue entre `/RESUMEN` y `storage/cash-summary-repository.ts` — mismo rol que `cash-session-controller.ts`. */
export async function triggerCashSummary(): Promise<void> {
  const context = await getCashSummaryContext();
  if (context === undefined) {
    commandBarErrorSignal.value = describeError({ ok: false, error: 'cash-session/none-ever', meta: undefined });
    return;
  }
  cashSummaryContextSignal.value = context;
  cashSummaryTabSignal.value = 'tickets';
  ticketFilterSignal.value = '';
  productFilterSignal.value = '';
  selectedTicketIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
  activeScreenSignal.value = 'cash-summary';
}

export function exitCashSummaryScreen(): void {
  cashSummaryContextSignal.value = undefined;
  cashSummaryTabSignal.value = 'tickets';
  ticketFilterSignal.value = '';
  productFilterSignal.value = '';
  selectedTicketIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
  activeScreenSignal.value = 'sale';
}

export function setCashSummaryTab(tab: 'tickets' | 'products' | 'payments'): void {
  cashSummaryTabSignal.value = tab;
  ticketFilterSignal.value = '';
  productFilterSignal.value = '';
  selectedTicketIndexSignal.value = 0;
  selectedProductIndexSignal.value = null;
}

export function updateTicketFilter(value: string): void {
  ticketFilterSignal.value = value;
}

export function updateProductFilter(value: string): void {
  productFilterSignal.value = value;
}
```

`src/ui/keyboard/command-bar-controller.ts` — agregar el import y el `case`:

```typescript
import { triggerCashSummary } from './cash-summary-controller.ts';
```

```typescript
    case 'CAJA':
      enterCashScreen();
      clearBuffer();
      return;
    case 'RESUMEN':
      void triggerCashSummary();
      clearBuffer();
      return;
```

- [ ] **Step 4: Confirmar que pasa**

Run: `pnpm vitest run src/ui/keyboard/cash-summary-controller.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/keyboard/cash-summary-controller.ts src/ui/keyboard/cash-summary-controller.test.ts src/ui/keyboard/commands.ts src/ui/keyboard/command-bar-controller.ts
git commit -m "feat: comando /RESUMEN"
```

---

## Task 10: Pantalla — shell de `/RESUMEN` (chrome, panel lateral, pestañas) + wiring en `app.tsx`

Esta tarea arma el esqueleto navegable: chrome con input de filtro, panel lateral con los 5
valores agregados, y las 3 pestañas como botones que cambian `cashSummaryTabSignal` — el contenido
de cada pestaña (Tickets/Productos/Medios de pago) lo llenan las tareas 11-13, que modifican este
mismo archivo.

**Files:**
- Create: `src/ui/screens/cash-summary-screen.tsx`
- Test: `src/ui/screens/cash-summary-screen.test.tsx`
- Modify: `src/ui/app.tsx`

**Interfaces:**
- Consumes: `cashSummaryContextSignal`, `cashSummaryTabSignal` (Task 7),
  `exitCashSummaryScreen`, `setCashSummaryTab` (Task 9), `useFocusOnMount`
  (`ui/hooks/use-focus-on-mount.ts`, ya existente), `PAYMENT_METHOD_LABELS`
  (`ui/payment-labels.ts`, ya existente), `formatMoney` (`ui/format.ts`, ya existente).
- Produces: `export function CashSummaryScreen(): JSX.Element`.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/ui/screens/cash-summary-screen.test.tsx
import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../storage/db.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { cashSummaryContextSignal, cashSummaryTabSignal } from '../state/cash-summary.ts';
import { CashSummaryScreen } from './cash-summary-screen.tsx';

beforeEach(async () => {
  await db.open();
  activeScreenSignal.value = 'cash-summary';
  cashSummaryContextSignal.value = {
    session: { id: 'cs1', openedAt: '2026-01-01T09:00:00.000Z', openingAmount: 100, sales: [] },
    summary: {
      salesCount: 2,
      totalsByMethod: { cash: 300, debit: 50, credit: 0, transfer: 0, qr: 0, account: 0 },
      totalCollected: 350,
      adjustmentTotal: -10,
      expectedCash: 400,
    },
    sales: [],
    isClosed: false,
  };
  cashSummaryTabSignal.value = 'tickets';
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('CashSummaryScreen', () => {
  it('muestra los 5 valores del panel lateral', () => {
    render(<CashSummaryScreen />);

    expect(screen.getByText('$350,00')).not.toBeNull(); // Total recaudado
    expect(screen.getByText('2')).not.toBeNull(); // Tickets emitidos
    expect(screen.getByText('$300,00')).not.toBeNull(); // Efectivo
    expect(screen.getByText('$50,00')).not.toBeNull(); // Otros pagos (debit)
  });

  it('Tab cambia de pestaña', () => {
    render(<CashSummaryScreen />);

    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'Tab' });

    expect(cashSummaryTabSignal.value).toBe('products');
  });

  it('Esc vuelve a la venta', () => {
    render(<CashSummaryScreen />);

    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });
});
```

- [ ] **Step 2: Confirmar que falla**

Run: `pnpm vitest run src/ui/screens/cash-summary-screen.test.tsx`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```typescript
// src/ui/screens/cash-summary-screen.tsx
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import type { PaymentMethod } from '../../domain/sale.ts';
import { formatMoney } from '../format.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import {
  exitCashSummaryScreen,
  setCashSummaryTab,
  updateProductFilter,
  updateTicketFilter,
} from '../keyboard/cash-summary-controller.ts';
import { PAYMENT_METHOD_LABELS } from '../payment-labels.ts';
import { cashSummaryContextSignal, cashSummaryTabSignal, productFilterSignal, ticketFilterSignal } from '../state/cash-summary.ts';

const NON_CASH_METHODS: PaymentMethod[] = ['debit', 'credit', 'transfer', 'qr', 'account'];

const sidebarCardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-3)',
};
const sectionLabelStyle = {
  fontSize: 'var(--font-size-xs)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: 'var(--color-text-muted)',
  margin: '0 0 var(--space-1)',
};

const TAB_ORDER: ('tickets' | 'products' | 'payments')[] = ['tickets', 'products', 'payments'];
const TAB_LABELS: Record<(typeof TAB_ORDER)[number], string> = {
  tickets: 'Tickets',
  products: 'Productos',
  payments: 'Medios de pago',
};

/**
 * `/RESUMEN`: panel lateral fijo + 3 pestañas (Tickets/Productos/Medios de pago). El contenido de
 * cada pestaña se agrega en tareas siguientes del plan — acá va el esqueleto: chrome, panel
 * lateral con los 5 agregados, y el cambio de pestaña con Tab.
 */
export function CashSummaryScreen() {
  const filterRef = useFocusOnMount<HTMLInputElement>();
  const context = cashSummaryContextSignal.value;
  const tab = cashSummaryTabSignal.value;

  if (context === undefined) {
    return null; // invariante: no se entra a esta pantalla sin contexto (ver triggerCashSummary)
  }

  const { summary, isClosed } = context;
  const otherPayments = NON_CASH_METHODS.reduce((sum, method) => sum + summary.totalsByMethod[method], 0);

  const filterValue = tab === 'products' ? productFilterSignal.value : ticketFilterSignal.value;
  const updateFilter = tab === 'products' ? updateProductFilter : updateTicketFilter;

  const handleFilterInput = (event: TargetedEvent<HTMLInputElement>) => {
    updateFilter(event.currentTarget.value);
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      exitCashSummaryScreen();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const currentIdx = TAB_ORDER.indexOf(tab);
      const nextIdx = (currentIdx + (event.shiftKey ? -1 : 1) + TAB_ORDER.length) % TAB_ORDER.length;
      setCashSummaryTab(TAB_ORDER[nextIdx]);
    }
  };

  return (
    <div
      style={{
        height: 'var(--app-height)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        style={{
          background: 'var(--color-chrome-bg)',
          color: 'var(--color-chrome-text)',
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Resumen del turno</h1>
        {isClosed && (
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-chrome-text-muted)' }}>
            Turno cerrado
          </span>
        )}
        {TAB_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setCashSummaryTab(t); filterRef.current?.focus(); }}
            style={{
              background: t === tab ? 'var(--color-accent)' : 'transparent',
              color: t === tab ? 'var(--color-chrome-bg)' : 'var(--color-chrome-text)',
              border: '1px solid var(--color-chrome-border)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-1) var(--space-2)',
              cursor: 'pointer',
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        <input
          ref={filterRef}
          type="text"
          aria-label="Buscar"
          placeholder={tab === 'products' ? 'Buscar producto' : 'Buscar ticket, cliente o producto'}
          value={filterValue}
          onInput={handleFilterInput}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1,
            background: 'var(--color-chrome-bg-2)',
            color: 'var(--color-chrome-text)',
            border: '1px solid var(--color-chrome-border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-1) var(--space-2)',
          }}
        />
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-chrome-text-muted)' }}>
          [Esc] Cerrar
        </span>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr clamp(240px, 25%, 320px)', minHeight: 0 }}>
        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          {tab === 'tickets' && <div>{/* Task 11 */}</div>}
          {tab === 'products' && <div>{/* Task 12 */}</div>}
          {tab === 'payments' && <div>{/* Task 13 */}</div>}
        </div>
        <div
          style={{
            borderLeft: '1px solid var(--color-border)',
            padding: 'var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            overflowY: 'auto',
          }}
        >
          <div style={sidebarCardStyle}>
            <p style={sectionLabelStyle}>Total recaudado</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>
              {formatMoney(summary.totalCollected)}
            </p>
          </div>
          <div style={sidebarCardStyle}>
            <p style={sectionLabelStyle}>Tickets emitidos</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{summary.salesCount}</p>
          </div>
          <div style={sidebarCardStyle}>
            <p style={sectionLabelStyle}>Desc/Recargos</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)', color: summary.adjustmentTotal < 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>
              {formatMoney(summary.adjustmentTotal)}
            </p>
          </div>
          <div style={sidebarCardStyle}>
            <p style={sectionLabelStyle}>Efectivo</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{formatMoney(summary.totalsByMethod.cash)}</p>
          </div>
          <div style={sidebarCardStyle}>
            <p style={sectionLabelStyle}>Otros pagos</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{formatMoney(otherPayments)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

`PAYMENT_METHOD_LABELS` queda importado para las tareas 11/13 que lo van a usar al llenar sus
pestañas — si el linter marca "importado sin usar" en esta tarea puntual, sacar el import acá y
volver a agregarlo en la Task 13 (que sí lo consume).

En `src/ui/app.tsx`, agregar el import y el `case`:

```typescript
import { CashSummaryScreen } from './screens/cash-summary-screen.tsx';
```

```typescript
    case 'cash':
      return <CashSessionScreen />;
    case 'cash-summary':
      return <CashSummaryScreen />;
```

- [ ] **Step 4: Confirmar que pasa**

Run: `pnpm vitest run src/ui/screens/cash-summary-screen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/cash-summary-screen.tsx src/ui/screens/cash-summary-screen.test.tsx src/ui/app.tsx
git commit -m "feat: esqueleto de la pantalla /RESUMEN (chrome, panel lateral, pestañas)"
```

---

## Task 11: Pantalla — pestaña Tickets

**Files:**
- Modify: `src/ui/screens/cash-summary-screen.tsx`
- Modify: `src/ui/screens/cash-summary-screen.test.tsx`

**Interfaces:**
- Consumes: `useTicketListNavigation` (Task 8), `selectedTicketIndexSignal`,
  `ticketFilterSignal` (Task 7), `getCatalogRepository`/`getCustomerRepository`
  (`ui/state/catalog.ts`/`ui/state/customer-repository.ts`, ya existentes), `PAYMENT_METHOD_LABELS`.
- Produces: filtrado difuso de `context.sales` vía un `flexsearch.Index` ad-hoc construido con
  `useMemo` a partir de `context.sales` (corpus: nombre de cliente + nombre de cada
  producto/línea libre, indexado por `sale.id`).

- [ ] **Step 1: Escribir el test que falla**

Agregar a `src/ui/screens/cash-summary-screen.test.tsx` (ajustar el `cashSummaryContextSignal.value`
del `beforeEach` para incluir `sales` reales — reemplazar `sales: []` por lo siguiente, y agregar
el `describe`):

```typescript
// En el beforeEach, reemplazar `sales: []` por:
    sales: [
      {
        id: 's1',
        lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 100 }],
        payments: [{ method: 'cash', amount: 200 }],
        total: 200,
        status: 'closed',
        createdAt: '2026-01-01T10:00:00.000Z',
        customerId: 'c1',
      },
      {
        id: 's2',
        lines: [{ kind: 'freeform', description: 'Regalo', qty: 1, unitPrice: 50 }],
        payments: [{ method: 'debit', amount: 50 }],
        total: 50,
        status: 'closed',
        createdAt: '2026-01-01T11:00:00.000Z',
      },
    ],
```

```typescript
describe('pestaña Tickets', () => {
  it('muestra cada ticket con su detalle', () => {
    render(<CashSummaryScreen />);

    expect(screen.getByText('$200,00', { selector: '.ticket__total' })).not.toBeNull();
    expect(screen.getByText('Regalo')).not.toBeNull(); // línea libre
  });

  it('el filtro de texto reduce la lista', () => {
    render(<CashSummaryScreen />);

    fireEvent.input(screen.getByLabelText('Buscar'), { target: { value: 'Regalo' } });

    expect(screen.queryByText('$200,00', { selector: '.ticket__total' })).toBeNull();
    expect(screen.getByText('Regalo')).not.toBeNull();
  });
});
```

(`fireEvent` ya está importado en el archivo desde la Task 10.)

- [ ] **Step 2: Confirmar que falla**

Run: `pnpm vitest run src/ui/screens/cash-summary-screen.test.tsx`
Expected: FAIL — la pestaña Tickets todavía no renderiza nada (placeholder de la Task 10).

- [ ] **Step 3: Implementar**

Agregar imports al principio de `cash-summary-screen.tsx`:

```typescript
import { Index } from 'flexsearch';
import { useMemo } from 'preact/hooks';
import type { Sale, SaleLine } from '../../domain/sale.ts';
import { formatQuantity } from '../format.ts';
import { useTicketListNavigation } from '../hooks/use-ticket-list-navigation.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import { getCustomerRepository } from '../state/customer-repository.ts';
import { selectedTicketIndexSignal } from '../state/cash-summary.ts';
```

Helpers y componente, antes de `export function CashSummaryScreen()`:

```typescript
function lineLabel(line: SaleLine): string {
  return line.kind === 'product'
    ? (getCatalogRepository().getProduct(line.productId)?.name ?? line.productId)
    : line.description;
}

function filterSales(sales: Sale[], query: string): Sale[] {
  if (query.trim() === '') return sales;
  const index = new Index({ tokenize: 'forward' });
  for (const sale of sales) {
    const customerName = sale.customerId !== undefined ? getCustomerRepository().getCustomer(sale.customerId)?.name ?? '' : '';
    const lineNames = sale.lines.map(lineLabel).join(' ');
    index.add(sale.id, `${customerName} ${lineNames}`);
  }
  const ids = new Set(index.search(query).map(String));
  return sales.filter((sale) => ids.has(sale.id));
}

function TicketsTab({ sales, filter }: { sales: Sale[]; filter: string }) {
  const filtered = useMemo(() => filterSales(sales, filter), [sales, filter]);
  const nav = useTicketListNavigation(selectedTicketIndexSignal, filtered.length);

  return (
    <div
      ref={nav.containerRef}
      style={{ height: '100%', overflowY: 'auto', outline: 'none' }}
    >
      {filtered.length === 0 && (
        <p style={{ padding: 'var(--space-3)', color: 'var(--color-text-muted)' }}>
          Ningún ticket coincide con la búsqueda.
        </p>
      )}
      {filtered.map((sale, index) => {
        const customer = sale.customerId !== undefined ? getCustomerRepository().getCustomer(sale.customerId) : undefined;
        const isSelected = index === selectedTicketIndexSignal.value;
        return (
          <div
            key={sale.id}
            ref={nav.ticketRef(index)}
            style={{
              background: isSelected ? 'var(--color-selected-bg)' : 'transparent',
              borderTop: index > 0 ? '1px solid var(--color-border)' : undefined,
            }}
          >
            <div
              className="ticket__header"
              style={{
                position: 'sticky',
                top: 0,
                background: isSelected ? 'var(--color-selected-bg)' : 'var(--color-bg)',
                padding: 'var(--space-2) var(--space-3)',
                boxShadow: isSelected ? 'inset 3px 0 0 var(--color-accent)' : undefined,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600 }}>Ticket #{sale.id}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
                  {new Date(sale.createdAt).toLocaleString()}
                </span>
              </div>
              {customer !== undefined && (
                <p style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                  Cliente: <b style={{ color: 'var(--color-text)' }}>{customer.name}</b>
                </p>
              )}
            </div>
            <div style={{ padding: 'var(--space-1) var(--space-3)' }}>
              {sale.lines.map((line, lineIndex) => (
                <div key={lineIndex} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 'var(--space-2)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>{formatQuantity(line.qty)}x</span>
                  <span>{lineLabel(line)}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(line.unitPrice * line.qty)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-1) var(--space-3) var(--space-3)' }}>
              <span>{sale.payments.map((p) => PAYMENT_METHOD_LABELS[p.method]).join(', ')}</span>
              <span className="ticket__total" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{formatMoney(sale.total)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

Reemplazar el placeholder de la Task 10 dentro del render principal:

```typescript
          {tab === 'tickets' && <TicketsTab sales={context.sales} filter={ticketFilterSignal.value} />}
```

- [ ] **Step 4: Confirmar que pasa**

Run: `pnpm vitest run src/ui/screens/cash-summary-screen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/cash-summary-screen.tsx src/ui/screens/cash-summary-screen.test.tsx
git commit -m "feat: pestaña Tickets de /RESUMEN"
```

---

## Task 12: Pantalla — pestaña Productos

**Files:**
- Modify: `src/ui/screens/cash-summary-screen.tsx`
- Modify: `src/ui/screens/cash-summary-screen.test.tsx`

**Interfaces:**
- Consumes: `calculateProductQuantities` (Task 3), `formatQuantity` (Task 6),
  `useScrollSelectedIntoView` (ya existente), `selectedProductIndexSignal`,
  `productFilterSignal` (Task 7).

- [ ] **Step 1: Escribir el test que falla**

Agregar a `src/ui/screens/cash-summary-screen.test.tsx`:

```typescript
describe('pestaña Productos', () => {
  it('cantidad total por producto, orden por cantidad descendente por defecto', () => {
    cashSummaryTabSignal.value = 'products';
    render(<CashSummaryScreen />);

    const rows = screen.getAllByTestId('product-row').map((el) => el.textContent);
    expect(rows[0]).toContain('2'); // p1 vendido 2 veces, único producto (freeform no cuenta)
  });
});
```

- [ ] **Step 2: Confirmar que falla**

Run: `pnpm vitest run src/ui/screens/cash-summary-screen.test.tsx`
Expected: FAIL — la pestaña Productos todavía no renderiza nada.

- [ ] **Step 3: Implementar**

Agregar imports:

```typescript
import { calculateProductQuantities, type ProductQuantity } from '../../domain/cash-session.ts';
import { useScrollSelectedIntoView } from '../hooks/use-scroll-selected-into-view.ts';
import { selectedProductIndexSignal } from '../state/cash-summary.ts';
```

Helper y componente:

```typescript
function sortedProducts(sales: Sale[], filter: string): (ProductQuantity & { name: string; sku: string })[] {
  const quantities = calculateProductQuantities(sales).map((pq) => {
    const product = getCatalogRepository().getProduct(pq.productId);
    return { ...pq, name: product?.name ?? pq.productId, sku: product?.sku ?? '' };
  });
  if (filter.trim() === '') {
    return quantities.sort((a, b) => b.qty - a.qty);
  }
  const index = new Index({ tokenize: 'forward' });
  for (const q of quantities) index.add(q.productId, q.name);
  const rankedIds = index.search(filter).map(String);
  const byId = new Map(quantities.map((q) => [q.productId, q]));
  return rankedIds.map((id) => byId.get(id)).filter((q): q is (typeof quantities)[number] => q !== undefined);
}

function ProductsTab({ sales, filter }: { sales: Sale[]; filter: string }) {
  const products = useMemo(() => sortedProducts(sales, filter), [sales, filter]);
  const rowRef = useScrollSelectedIntoView(selectedProductIndexSignal);

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--color-bg)' }}>
          <tr>
            <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>Código</th>
            <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>Producto</th>
            <th style={{ textAlign: 'right', padding: 'var(--space-2) var(--space-3)' }}>Cant.</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, index) => (
            <tr
              key={p.productId}
              data-testid="product-row"
              ref={rowRef(index)}
              style={{ background: index === selectedProductIndexSignal.value ? 'var(--color-selected-bg)' : undefined }}
            >
              <td style={{ padding: 'var(--space-1) var(--space-3)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>{p.sku}</td>
              <td style={{ padding: 'var(--space-1) var(--space-3)' }}>{p.name}</td>
              <td style={{ padding: 'var(--space-1) var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatQuantity(p.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Reemplazar el placeholder de la Task 10:

```typescript
          {tab === 'products' && <ProductsTab sales={context.sales} filter={productFilterSignal.value} />}
```

- [ ] **Step 4: Confirmar que pasa**

Run: `pnpm vitest run src/ui/screens/cash-summary-screen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/cash-summary-screen.tsx src/ui/screens/cash-summary-screen.test.tsx
git commit -m "feat: pestaña Productos de /RESUMEN"
```

---

## Task 13: Pantalla — pestaña Medios de pago

**Files:**
- Modify: `src/ui/screens/cash-summary-screen.tsx`
- Modify: `src/ui/screens/cash-summary-screen.test.tsx`

**Interfaces:**
- Consumes: `summary.totalsByMethod`, `PAYMENT_METHOD_LABELS` — sin signal de selección ni filtro
  (6 filas fijas, siempre completas).

- [ ] **Step 1: Escribir el test que falla**

```typescript
describe('pestaña Medios de pago', () => {
  it('desglosa los 6 medios, sin agrupar', () => {
    cashSummaryTabSignal.value = 'payments';
    render(<CashSummaryScreen />);

    expect(screen.getByText('Efectivo')).not.toBeNull();
    expect(screen.getByText('Tarjeta de Débito')).not.toBeNull();
    expect(screen.getByText('Tarjeta de Crédito')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Confirmar que falla**

Run: `pnpm vitest run src/ui/screens/cash-summary-screen.test.tsx`
Expected: FAIL — la pestaña Medios de pago todavía no renderiza nada.

- [ ] **Step 3: Implementar**

```typescript
const ALL_METHODS: PaymentMethod[] = ['cash', 'debit', 'credit', 'transfer', 'qr', 'account'];

function PaymentsTab({ totalsByMethod }: { totalsByMethod: Record<PaymentMethod, number> }) {
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)' }}>Medio de pago</th>
            <th style={{ textAlign: 'right', padding: 'var(--space-2) var(--space-3)' }}>Monto</th>
          </tr>
        </thead>
        <tbody>
          {ALL_METHODS.map((method) => (
            <tr key={method}>
              <td style={{ padding: 'var(--space-1) var(--space-3)', fontWeight: 600 }}>{PAYMENT_METHOD_LABELS[method]}</td>
              <td style={{ padding: 'var(--space-1) var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatMoney(totalsByMethod[method])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Reemplazar el placeholder de la Task 10:

```typescript
          {tab === 'payments' && <PaymentsTab totalsByMethod={summary.totalsByMethod} />}
```

- [ ] **Step 4: Confirmar que pasa**

Run: `pnpm vitest run src/ui/screens/cash-summary-screen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/cash-summary-screen.tsx src/ui/screens/cash-summary-screen.test.tsx
git commit -m "feat: pestaña Medios de pago de /RESUMEN"
```

---

## Task 14: `/CAJA` — sacar el resumen del paso `'open'`

**Files:**
- Modify: `src/ui/screens/cash-session-screen.tsx`

Sin test nuevo dedicado (es una poda de UI ya cubierta por la auditoría de teclado e2e — Task 15 —
y por inspección visual manual, mismo criterio que el resto de pulidos visuales de este proyecto
que no tienen test de componente propio).

- [ ] **Step 1: Sacar el bloque de resumen del paso `'open'`**

En `src/ui/screens/cash-session-screen.tsx`, el bloque
`{summary !== undefined && session !== undefined && (...)}` (líneas ~114-172 del archivo actual)
solo debe renderizarse en los pasos `'confirming-close'` y `'closed'` — no en `'open'`. Cambiar la
condición:

```typescript
      {summary !== undefined && session !== undefined && step !== 'open' && (
```

El resto del bloque (efectivo esperado, arqueo con `showArqueo`) queda igual — en `'open'` ya no se
monta nada de esto, en `'confirming-close'` se sigue viendo el preview de la diferencia (como
siempre), y en `'closed'` solo la diferencia final (`showArqueo` ya lo acota, no hace falta tocar
esa parte).

- [ ] **Step 2: Verificar manualmente**

Run: `pnpm dev`, abrir la app, `/CAJA` para abrir un turno con alguna venta ya cargada, volver a
`/CAJA` — confirmar que el paso `'open'` ya no muestra ningún resumen, solo pide el efectivo
contado; que al tipear un monto y confirmar aparece el preview de la diferencia; y que al confirmar
el cierre solo se ve la diferencia final.

- [ ] **Step 3: Commit**

```bash
git add src/ui/screens/cash-session-screen.tsx
git commit -m "fix: /CAJA ya no muestra el resumen agregado en el paso 'open'"
```

---

## Task 15: e2e — `/RESUMEN` en la auditoría de accesibilidad por teclado

**Files:**
- Modify: `e2e/keyboard-only.spec.ts`

**Interfaces:**
- Consumes: `openCashSession`, `seedCatalog` (`e2e/helpers.ts`, ya existentes).

- [ ] **Step 1: Escribir el test que falla**

Agregar a `e2e/keyboard-only.spec.ts`, después del test de `/CAJA`:

```typescript
test('venta → /RESUMEN → Esc → la barra de comandos recupera el foco', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await openCashSession(page);

  await commandBar.fill('/RESUMEN');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Resumen del turno' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(commandBar).toBeFocused();
});

test('/RESUMEN sin ningún turno muestra error y no navega', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');

  await commandBar.fill('/RESUMEN');
  await commandBar.press('Enter');

  await expect(page.getByText('No hay ningún turno de caja para consultar.')).toBeVisible();
  await expect(commandBar).toBeFocused();
});
```

- [ ] **Step 2: Confirmar que falla**

Run: `pnpm exec playwright test e2e/keyboard-only.spec.ts`
Expected: FAIL — el build todavía no tiene `/RESUMEN` corriendo contra el build real hasta que las
tareas anteriores estén todas commiteadas (si se ejecuta este paso después de completar las tareas
1-14, en cambio, ya debería pasar — ver nota).

- [ ] **Step 3: Confirmar que pasa**

Run: `pnpm build && pnpm exec playwright test e2e/keyboard-only.spec.ts` (recordar: Playwright corre
contra el build real, no el dev server — ver CLAUDE.md "Testing")
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add e2e/keyboard-only.spec.ts
git commit -m "test: /RESUMEN en la auditoría de accesibilidad por teclado"
```

---

## Self-Review

**Cobertura del spec:** gate de 3 casos (Task 5 + 9), `/CAJA` simplificado (Task 14), panel lateral
con los 5 valores (Task 10), 3 pestañas (Tasks 11-13), mecánica de scroll de Tickets (Task 8),
filtro difuso ad-hoc sin puerto nuevo (Tasks 11-12), `formatQuantity` (Task 6), resolución de
nombres en la UI, no en `storage/` (Tasks 11-12, usan `getCatalogRepository`/`getCustomerRepository`
directamente). Cubierto todo lo que la spec describe como parte de esta iteración; lo marcado
"fuera de alcance" en la spec no tiene tarea acá, a propósito.

**Placeholders:** ninguno — cada paso trae código real, cada test trae aserciones concretas.

**Consistencia de tipos:** `CashSummaryContext` (Task 5) se consume igual en Task 7 (signal),
Task 9 (controller) y Task 10 (pantalla) — mismo shape en los tres lugares.
`useTicketListNavigation(selectedIndex, ticketCount)` (Task 8) se llama con esa firma exacta en
Task 11. `formatQuantity` (Task 6) se usa igual en Tasks 11 y 12. `calculateProductQuantities`
(Task 3) se consume con esa firma exacta en Task 12.
