# Caja sin turnos, `/RESUMEN` por fecha y numeración de tickets — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. En este repo se ejecuta **inline** con executing-plans, con TDD, un commit y un resumen por tarea.

**Goal:** Etapa 5 del epic #94 (#100) más #120: se vende sin turnos, `/CAJA` registra arqueos, ingresos y egresos con un saldo de efectivo continuo, `/RESUMEN` muestra un día calendario, cada ticket tiene un número por día, y el contrato pasa a 4.1.0 (POS, Sheets, minibackend y mini-erp).

**Architecture:** El dominio puro absorbe las reglas nuevas (numeración, saldo, arqueo, ingreso/egreso, ranking de conceptos, resumen del día, limpieza con el ancla nueva); `storage/` suma tres tablas (Dexie v7) y asigna el número de ticket dentro de la transacción de la venta; la UI reemplaza el `/CAJA` de turnos por un modal con modelo puro, rehace `/RESUMEN` por fecha y suma un aviso en la barra de estado; los tres backends del repo hablan 4.1.0.

**Tech Stack:** Preact + `@preact/signals`, Dexie, Zod, FlexSearch, Vitest + Testing Library, Playwright, Node `node:sqlite` (minibackend), Apps Script (`bridge.gs`), Express + `node:sqlite` + Zod 3 (mini-erp).

**Spec:** `docs/superpowers/specs/2026-09-24-caja-sin-turnos-y-numeracion-design.md`

## Global Constraints

- TypeScript estricto: sin `any`; `unknown` solo en el borde y validado con Zod en la línea siguiente.
- Funciones de negocio devuelven `Result<T>`, nunca lanzan. Todo `ErrorCode` nuevo se traduce en `ui/errors.ts` (el `switch` exhaustivo no compila si falta); un código que deja de usarse se saca de `ErrorMeta` y de su traducción.
- `exactOptionalPropertyTypes`: los opcionales se omiten, nunca `undefined` explícito.
- Importes redondeados a 2 decimales con `domain/rounding.ts::roundAmount`; nunca redondear en otro lado.
- IDs nuevos (`CashCount`, `CashMovement`) son ULID vía `storage/ids.ts::newId`; `domain/` los recibe por parámetro.
- Numeración: `Sale.ticket?: { date: 'YYYY-MM-DD'; number: number }` con fecha **local** de la terminal; `offline-pos:ticket-counter` en `localStorage` con `{ date, last }`, best-effort.
- Saldo: `(lastCount?.counted ?? 0) + Σ pagos 'cash' con signo posteriores + Σ ingresos 'manual' − Σ egresos 'manual'`; "posterior" es `createdAt > lastCount.createdAt`; los `count-adjustment` nunca suman.
- Conceptos: vida media de 14 días, tope de 8 sugerencias, sin preselección.
- Aviso "Sin arqueo en 24 h": sin arqueo o el último con más de 24 h.
- Contrato: `POS_CONTRACT_VERSION = '4.1.0'`; la regla de compatibilidad (`domain/contract-version.ts::isCompatibleContract`) no cambia.
- Patrón teclado + mouse (CLAUDE.md, "Teclado y mouse"): `keepFocusOnMouseDown`, botón con el atajo en la etiqueta, `.btn`/`.btn-primary`/`.btn-danger`, grupos de opciones con comportamiento de radio.
- Cargar datos al entrar a una pantalla es responsabilidad del `useLayoutEffect` de esa pantalla, y cualquier reset va **antes** del primer `await` (CLAUDE.md, "Patrones establecidos").
- Textos de UI, comentarios y commits en español. Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comandos (desde la raíz del worktree, en PowerShell — el `node` de Git Bash no está en el PATH): `pnpm test -- <ruta>` (Vitest), `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` (Playwright, contra el build), `pnpm test:backend`, `pnpm typecheck:backend`. Mini-erp: `pnpm --dir mini-erp typecheck`, `pnpm --dir mini-erp lint`, `pnpm --dir mini-erp test`.
- Mini-erp: por acuerdo con el usuario para esta etapa (excepción puntual a su `AGENTS.md`), se modifica y se commitea desde el branch de la etapa. Sigue sus reglas técnicas: imports relativos con extensión `.ts`, sin parameter properties, Zod 3.

## Desvíos respecto de la spec (a confirmar con el usuario al aprobar el plan)

1. **Minibackend sin columnas nuevas** (§8 decía "columnas nuevas; sube `SCHEMA_VERSION`"): `demo-backend` guarda la venta entera como JSON en `sales.payload` y `/_demo/api/sales` la devuelve desarmada, así que `ticket` ya llega al panel sin tocar el schema. Se agrega la columna al panel y un test; `SCHEMA_VERSION` queda igual. El mini-erp está en la misma situación.
2. **"Comprobante de la anulación"** (§3): hoy anular vuelve a la venta sin mostrar comprobante, así que no existe esa pantalla para una anulación. El comprobante de una venta muestra "Ticket #12"; la regla "Anulación del #12" se aplica en `/ANULAR` y `/RESUMEN`. Mostrar un comprobante al anular queda fuera de alcance.
3. **`lastCashCountAtSignal` después de una limpieza** (§6): la limpieza nunca borra el último arqueo (es el ancla), así que el valor no puede cambiar; no se agrega esa actualización.
4. **Mensaje de backend incompatible**: con el POS en 4.1.0, "se necesita 4.x" sería falso frente a un backend 4.0.0. Pasa a "se necesita 4.1 o posterior" (barra de estado y `ui/errors.ts`).
5. **Schemas Zod compartidos** (§8): `sync/connector.ts` no tiene schema de venta (las ventas solo se empujan, nunca se validan del lado del POS), así que no hay nada que aceptar ahí.
6. **Error de persistencia de caja**: la spec nombra `cash/invalid-amount` y `cash/concept-required`; se suma `cash/persist-failed` (mismo patrón que `sale/persist-failed`) para el `try/catch` del repositorio.

---

### Task 1: Numeración de tickets — dominio y contador

**Files:**
- Create: `src/domain/ticket-number.ts`, `src/domain/ticket-number.test.ts`, `src/sync/ticket-counter.ts`, `src/sync/ticket-counter.test.ts`
- Modify: `src/domain/sale.ts` (campo `ticket`)

**Interfaces:**
- Produces (`domain/ticket-number.ts`): `type TicketNumber = { date: string; number: number }`, `type TicketCounter = { date: string; last: number }`, `localDateKey(iso: string): string`, `localDayRange(date: string): { from: string; to: string }` (`to` exclusivo), `shiftDateKey(date: string, days: number): string`, `saleDateKey(sale: Pick<Sale, 'createdAt' | 'ticket'>): string`, `lastTicketNumberOn(sales: readonly Pick<Sale, 'ticket'>[], date: string): number | undefined`, `nextTicketNumber(params: { date: string; stored: TicketCounter | undefined; lastLocal: number | undefined }): number`.
- Produces (`sync/ticket-counter.ts`): `TICKET_COUNTER_KEY = 'offline-pos:ticket-counter'`, `getTicketCounter(): TicketCounter | undefined`, `setTicketCounter(counter: TicketCounter): void`.
- Produces (`domain/sale.ts`): `Sale.ticket?: TicketNumber`.

- [ ] **Step 1: tests que fallan**

`src/domain/ticket-number.test.ts` (las fechas se arman con `new Date(año, mes, día, hora)` para no depender de la zona horaria del entorno):
```typescript
import { describe, expect, it } from 'vitest';
import {
  lastTicketNumberOn,
  localDateKey,
  localDayRange,
  nextTicketNumber,
  saleDateKey,
  shiftDateKey,
} from './ticket-number.ts';

const at = (y: number, m: number, d: number, h = 12, min = 0): string =>
  new Date(y, m - 1, d, h, min).toISOString();

describe('ticket-number', () => {
  it('localDateKey usa la fecha local, con ceros a la izquierda', () => {
    expect(localDateKey(at(2026, 9, 4, 0, 5))).toBe('2026-09-04');
    expect(localDateKey(at(2026, 9, 24, 23, 59))).toBe('2026-09-24');
  });
  it('localDayRange cubre el día local entero, con el fin exclusivo', () => {
    const { from, to } = localDayRange('2026-09-24');
    expect(from).toBe(at(2026, 9, 24, 0));
    expect(to).toBe(at(2026, 9, 25, 0));
  });
  it('shiftDateKey cruza meses', () => {
    expect(shiftDateKey('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDateKey('2026-10-01', -1)).toBe('2026-09-30');
  });
  it('saleDateKey usa ticket.date si lo tiene; si no, la fecha local de createdAt', () => {
    expect(saleDateKey({ createdAt: at(2026, 9, 24), ticket: { date: '2026-09-23', number: 4 } })).toBe(
      '2026-09-23',
    );
    expect(saleDateKey({ createdAt: at(2026, 9, 24) })).toBe('2026-09-24');
  });
  it('lastTicketNumberOn toma el mayor número de esa fecha', () => {
    const sales = [
      { ticket: { date: '2026-09-24', number: 3 } },
      { ticket: { date: '2026-09-24', number: 7 } },
      { ticket: { date: '2026-09-23', number: 40 } },
      {},
    ];
    expect(lastTicketNumberOn(sales, '2026-09-24')).toBe(7);
    expect(lastTicketNumberOn(sales, '2026-09-22')).toBeUndefined();
  });
  it('día nuevo: contador de otra fecha y sin ventas de hoy → 1', () => {
    expect(
      nextTicketNumber({ date: '2026-09-24', stored: { date: '2026-09-23', last: 50 }, lastLocal: undefined }),
    ).toBe(1);
  });
  it('mismo día: sigue el contador', () => {
    expect(
      nextTicketNumber({ date: '2026-09-24', stored: { date: '2026-09-24', last: 5 }, lastLocal: 5 }),
    ).toBe(6);
  });
  it('contador perdido: retoma desde las ventas locales', () => {
    expect(nextTicketNumber({ date: '2026-09-24', stored: undefined, lastLocal: 9 })).toBe(10);
  });
  it('datos locales borrados: el contador evita repetir', () => {
    expect(
      nextTicketNumber({ date: '2026-09-24', stored: { date: '2026-09-24', last: 12 }, lastLocal: undefined }),
    ).toBe(13);
  });
  it('reloj que retrocede: contador de otra fecha, usa lo local de la fecha actual', () => {
    expect(
      nextTicketNumber({ date: '2026-09-22', stored: { date: '2026-09-24', last: 30 }, lastLocal: 4 }),
    ).toBe(5);
  });
});
```

`src/sync/ticket-counter.test.ts`:
```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { getTicketCounter, setTicketCounter, TICKET_COUNTER_KEY } from './ticket-counter.ts';

describe('ticket-counter', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it('guarda y lee el contador', () => {
    setTicketCounter({ date: '2026-09-24', last: 3 });
    expect(getTicketCounter()).toEqual({ date: '2026-09-24', last: 3 });
  });
  it('sin clave → undefined', () => {
    expect(getTicketCounter()).toBeUndefined();
  });
  it('un valor con otra forma se ignora', () => {
    localStorage.setItem(TICKET_COUNTER_KEY, JSON.stringify({ date: 'ayer', last: -1 }));
    expect(getTicketCounter()).toBeUndefined();
    localStorage.setItem(TICKET_COUNTER_KEY, 'no es json');
    expect(getTicketCounter()).toBeUndefined();
  });
});
```

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/ticket-number.test.ts src/sync/ticket-counter.test.ts`

- [ ] **Step 3: implementar**

`src/domain/ticket-number.ts`:
```typescript
import type { Sale } from './sale.ts';

/**
 * Número de ticket (#120): un contador por día local de la terminal. `date` es la fecha con la
 * que se numeró (`'YYYY-MM-DD'`), así un ticket conserva su número aunque después se lo mire desde
 * otra zona horaria. Las anulaciones son tickets propios y consumen número.
 */
export type TicketNumber = { date: string; number: number };

/** Último número usado, guardado en `localStorage` (`sync/ticket-counter.ts`). */
export type TicketCounter = { date: string; last: number };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function fromDateKey(date: string, days = 0): Date {
  return new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)) + days,
  );
}

function toDateKey(value: Date): string {
  return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Fecha local (`'YYYY-MM-DD'`) de un instante ISO, en la zona horaria de la terminal. */
export function localDateKey(iso: string): string {
  return toDateKey(new Date(iso));
}

/** El día local entero como rango ISO, `to` exclusivo — para consultar por el índice `createdAt`. */
export function localDayRange(date: string): { from: string; to: string } {
  return { from: fromDateKey(date).toISOString(), to: fromDateKey(date, 1).toISOString() };
}

/** Día calendario `days` días antes (negativo) o después. */
export function shiftDateKey(date: string, days: number): string {
  return toDateKey(fromDateKey(date, days));
}

/** El día al que pertenece una venta: el de su número si lo tiene, si no el de su hora local. */
export function saleDateKey(sale: Pick<Sale, 'createdAt' | 'ticket'>): string {
  return sale.ticket?.date ?? localDateKey(sale.createdAt);
}

/** Mayor número de ticket de `date` entre las ventas dadas. */
export function lastTicketNumberOn(
  sales: readonly Pick<Sale, 'ticket'>[],
  date: string,
): number | undefined {
  let last: number | undefined;
  for (const sale of sales) {
    if (sale.ticket?.date === date && (last === undefined || sale.ticket.number > last)) {
      last = sale.ticket.number;
    }
  }
  return last;
}

/**
 * El próximo número (spec de #120, §3): el mayor entre el contador guardado (si es de la misma
 * fecha) y el último local de esa fecha, más uno. El contador cubre los datos locales borrados;
 * las ventas locales cubren un contador perdido.
 */
export function nextTicketNumber(params: {
  date: string;
  stored: TicketCounter | undefined;
  lastLocal: number | undefined;
}): number {
  const stored = params.stored?.date === params.date ? params.stored.last : 0;
  return Math.max(stored, params.lastLocal ?? 0) + 1;
}
```

`src/sync/ticket-counter.ts`:
```typescript
import { z } from 'zod';
import type { TicketCounter } from '../domain/ticket-number.ts';

/**
 * Último número de ticket usado (#120). Best-effort, mismo criterio que `sync/cursor.ts`: si se
 * pierde, el próximo número se deriva de las ventas locales de ese día. Vive fuera de IndexedDB a
 * propósito: "Borrar" en `/CONFIG`, `/DEMO_RESET` y la pérdida del id de dispositivo vacían las
 * tablas pero no esta clave, así la numeración no se repite. `pos.reset()` sí la borra (prefijo
 * `offline-pos:`).
 */
export const TICKET_COUNTER_KEY = 'offline-pos:ticket-counter';

const ticketCounterSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  last: z.number().int().min(1),
});

export function getTicketCounter(): TicketCounter | undefined {
  try {
    const raw = localStorage.getItem(TICKET_COUNTER_KEY);
    if (raw === null) {
      return undefined;
    }
    const parsed = ticketCounterSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function setTicketCounter(counter: TicketCounter): void {
  try {
    localStorage.setItem(TICKET_COUNTER_KEY, JSON.stringify(counter));
  } catch {
    /* best-effort, ver comentario de arriba */
  }
}
```

`src/domain/sale.ts`: importar `type TicketNumber` de `./ticket-number.ts` y agregar a `Sale`, después de `createdAt`:
```typescript
  /**
   * Número del ticket en su día (#120). Una venta anterior a la Etapa 5 no lo tiene y nunca se
   * le inventa uno.
   */
  ticket?: TicketNumber;
```
(`ticket-number.ts` importa `type Sale` y `sale.ts` importa `type TicketNumber`: los dos son `import type`, no hay ciclo en runtime.)

- [ ] **Step 4: correr** `pnpm test -- src/domain/ticket-number.test.ts src/sync/ticket-counter.test.ts` → PASS; `pnpm typecheck` → PASS.

- [ ] **Step 5: commit** `feat(domain): numeración de tickets por día local y contador guardado (#120)`

---

### Task 2: Número de ticket en la venta y en la anulación

**Files:**
- Modify: `src/storage/sale-repository.ts`, `src/storage/sale-repository.test.ts`

**Interfaces:**
- Consumes: `localDateKey`, `localDayRange`, `shiftDateKey`, `lastTicketNumberOn`, `nextTicketNumber` (Task 1); `getTicketCounter`, `setTicketCounter` (Task 1).
- Produces: `closeSaleAndPersist` y `voidSaleAndPersist` devuelven la `Sale` con `ticket`; el evento `sale` del outbox lleva el `ticket`.

- [ ] **Step 1: tests que fallan** (`sale-repository.test.ts`, con `'fake-indexeddb/auto'` y `localStorage.clear()` en el `beforeEach`; las ventas del test siguen abriendo un turno mientras exista el gate — se saca en la Task 8):
  - Dos ventas seguidas → `ticket.number` 1 y 2, `ticket.date === localDateKey(sale.createdAt)`; `getTicketCounter()` queda en `{ date, last: 2 }`.
  - El evento `sale` en `db.outbox` tiene `sale.ticket` igual al de la venta devuelta.
  - Anular la segunda → el ticket de anulación tiene número 3.
  - Contador perdido: cerrar una venta, `localStorage.removeItem(TICKET_COUNTER_KEY)`, cerrar otra → número 2.
  - Datos locales borrados: cerrar dos ventas, `await db.sales.clear()`, cerrar otra → número 3.
  - Día nuevo: `setTicketCounter({ date: '2000-01-01', last: 99 })` y sin ventas de hoy → número 1.

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/storage/sale-repository.test.ts`

- [ ] **Step 3: implementar** en `persistSaleDocument`:
  - Recibe la venta **sin número** y devuelve `Promise<Result<Sale & { ticket: TicketNumber }>>` con el número asignado.
  - Antes de la transacción, igual que hoy: `trackedProductIds`, `movements`, y además `const stored = getTicketCounter()` (lectura síncrona; se pasa adentro).
  - Adentro de la transacción (`db.sales` ya está en la lista), **antes** de `db.sales.add`:
    ```typescript
    const date = localDateKey(sale.createdAt);
    // Un día más ancho a cada lado por si una venta de hoy se numeró con otra fecha (reloj
    // corregido): manda `ticket.date`, no la hora.
    const nearby = await db.sales
      .where('createdAt')
      .between(
        localDayRange(shiftDateKey(date, -1)).from,
        localDayRange(shiftDateKey(date, 1)).to,
        true,
        false,
      )
      .toArray();
    const numbered = {
      ...sale,
      ticket: {
        date,
        number: nextTicketNumber({ date, stored, lastLocal: lastTicketNumberOn(nearby, date) }),
      },
    };
    ```
  - Los eventos del outbox se arman **adentro**, con `numbered` (son funciones puras: no rompen la transacción de Dexie): `buildOutboxEventForSale(numbered, …)`, los de stock y el `account-hold-confirm`.
  - `db.sales.add(numbered)`; `applyAccountMovements(numbered, now)`; el resto igual. La transacción devuelve `numbered`.
  - Después del commit: `setTicketCounter({ date: numbered.ticket.date, last: numbered.ticket.number })`.
  - `closeSaleAndPersist` y `voidSaleAndPersist` devuelven el `Sale` que devuelve `persistSaleDocument` (no el armado antes).
  - JSDoc de `persistSaleDocument`: por qué el número se asigna adentro de la transacción (dos cierres casi simultáneos no pueden leer el mismo "último") y por qué el contador se escribe después del commit (si la escritura falla, el próximo número se deriva de las ventas locales).

- [ ] **Step 4: correr** `pnpm test -- src/storage` → PASS.

- [ ] **Step 5: commit** `feat(storage): número de ticket asignado dentro de la transacción de la venta y de la anulación (#120)`

---

### Task 3: Caja — dominio (saldo, arqueo, ingreso/egreso)

**Files:**
- Create: `src/domain/cash-count.ts`, `src/domain/cash-count.test.ts`
- Modify: `src/domain/cash-movement.ts`, `src/domain/cash-movement.test.ts` (crear si no existe), `src/domain/result.ts`, `src/ui/errors.ts`, `src/ui/errors.test.ts`

**Interfaces:**
- Produces (`domain/cash-count.ts`): `type CashCount = { id: string; expected: number; counted: number; createdAt: string; adjustmentId?: string }`, `calculateCashBalance(params: { lastCount: Pick<CashCount, 'counted' | 'createdAt'> | undefined; sales: readonly Pick<Sale, 'createdAt' | 'payments'>[]; movements: readonly Pick<CashMovement, 'createdAt' | 'direction' | 'amount' | 'source'>[] }): number`, `buildCashCount(params: { id: string; adjustmentId: string; expected: number; counted: number; now: string }): Result<{ count: CashCount; adjustment?: CashMovement }>`, `CASH_COUNT_OVERDUE_MS = 24 * 60 * 60 * 1000`, `isCashCountOverdue(lastCountAt: string | undefined, now: string): boolean`.
- Produces (`domain/cash-movement.ts`): `buildManualCashMovement(params: { id: string; direction: 'in' | 'out'; amount: number; concept: string; description?: string; now: string }): Result<CashMovement>`.
- Produces (`ErrorMeta`): `'cash/invalid-amount': { amount: number }`, `'cash/concept-required': undefined`, `'cash/persist-failed': { message: string }`.

- [ ] **Step 1: tests que fallan**

`src/domain/cash-count.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { buildCashCount, calculateCashBalance, isCashCountOverdue } from './cash-count.ts';

const sale = (createdAt: string, ...cash: number[]) => ({
  createdAt,
  payments: [
    ...cash.map((amount) => ({ method: 'cash' as const, amount })),
    { method: 'debit' as const, amount: 1000 },
  ],
});
const manual = (createdAt: string, direction: 'in' | 'out', amount: number) => ({
  createdAt,
  direction,
  amount,
  source: 'manual' as const,
});

describe('calculateCashBalance', () => {
  it('sin arqueo, todo cuenta desde base 0 (solo efectivo)', () => {
    expect(
      calculateCashBalance({
        lastCount: undefined,
        sales: [sale('2026-09-24T10:00:00.000Z', 500)],
        movements: [manual('2026-09-24T09:00:00.000Z', 'in', 1000)],
      }),
    ).toBe(1500);
  });
  it('con arqueo, parte de lo contado y suma solo lo posterior', () => {
    expect(
      calculateCashBalance({
        lastCount: { counted: 2000, createdAt: '2026-09-24T12:00:00.000Z' },
        sales: [sale('2026-09-24T11:00:00.000Z', 700), sale('2026-09-24T13:00:00.000Z', 300)],
        movements: [
          manual('2026-09-24T11:30:00.000Z', 'in', 50),
          manual('2026-09-24T14:00:00.000Z', 'out', 200),
        ],
      }),
    ).toBe(2100);
  });
  it('lo creado en el mismo instante del arqueo no cuenta (posterior es estricto)', () => {
    expect(
      calculateCashBalance({
        lastCount: { counted: 100, createdAt: '2026-09-24T12:00:00.000Z' },
        sales: [sale('2026-09-24T12:00:00.000Z', 999)],
        movements: [],
      }),
    ).toBe(100);
  });
  it('anulaciones y devoluciones restan por su signo', () => {
    expect(
      calculateCashBalance({
        lastCount: undefined,
        sales: [sale('2026-09-24T10:00:00.000Z', 500), sale('2026-09-24T10:05:00.000Z', -500)],
        movements: [],
      }),
    ).toBe(0);
  });
  it('los ajustes por arqueo nunca suman', () => {
    expect(
      calculateCashBalance({
        lastCount: { counted: 300, createdAt: '2026-09-24T12:00:00.000Z' },
        sales: [],
        movements: [
          { createdAt: '2026-09-24T12:00:01.000Z', direction: 'in', amount: 80, source: 'count-adjustment' },
        ],
      }),
    ).toBe(300);
  });
});

describe('buildCashCount', () => {
  const base = { id: 'c1', adjustmentId: 'm1', now: '2026-09-24T12:00:00.000Z' };
  it('con diferencia arma el ajuste y lo referencia', () => {
    const result = buildCashCount({ ...base, expected: 1000, counted: 1200 });
    expect(result).toEqual({
      ok: true,
      value: {
        count: { id: 'c1', expected: 1000, counted: 1200, createdAt: base.now, adjustmentId: 'm1' },
        adjustment: {
          id: 'm1',
          direction: 'in',
          amount: 200,
          concept: 'Ajuste por arqueo',
          source: 'count-adjustment',
          count: { expected: 1000, counted: 1200 },
          createdAt: base.now,
        },
      },
    });
  });
  it('sin diferencia no hay ajuste', () => {
    const result = buildCashCount({ ...base, expected: 1000, counted: 1000 });
    expect(result).toEqual({
      ok: true,
      value: { count: { id: 'c1', expected: 1000, counted: 1000, createdAt: base.now } },
    });
  });
  it('contado negativo o no finito es cash/invalid-amount', () => {
    expect(buildCashCount({ ...base, expected: 0, counted: -1 })).toMatchObject({
      ok: false,
      error: 'cash/invalid-amount',
    });
    expect(buildCashCount({ ...base, expected: 0, counted: Number.NaN })).toMatchObject({
      ok: false,
      error: 'cash/invalid-amount',
    });
  });
});

describe('isCashCountOverdue', () => {
  it('sin arqueo, o con uno de más de 24 h', () => {
    expect(isCashCountOverdue(undefined, '2026-09-24T12:00:00.000Z')).toBe(true);
    expect(isCashCountOverdue('2026-09-23T11:59:00.000Z', '2026-09-24T12:00:00.000Z')).toBe(true);
    expect(isCashCountOverdue('2026-09-23T12:01:00.000Z', '2026-09-24T12:00:00.000Z')).toBe(false);
  });
});
```

En `cash-movement.test.ts`, agregar:
```typescript
describe('buildManualCashMovement', () => {
  const base = { id: 'm1', direction: 'out' as const, now: '2026-09-24T12:00:00.000Z' };
  it('recorta concepto y descripción, redondea el monto', () => {
    expect(
      buildManualCashMovement({ ...base, amount: 150.456, concept: '  Proveedor  ', description: '  Pan ' }),
    ).toEqual({
      ok: true,
      value: {
        id: 'm1',
        direction: 'out',
        amount: 150.46,
        concept: 'Proveedor',
        description: 'Pan',
        source: 'manual',
        createdAt: base.now,
      },
    });
  });
  it('una descripción vacía se omite', () => {
    const result = buildManualCashMovement({ ...base, amount: 10, concept: 'X', description: '   ' });
    expect(result.ok && 'description' in result.value).toBe(false);
  });
  it('monto 0, negativo o no finito es cash/invalid-amount', () => {
    for (const amount of [0, -5, Number.NaN, 0.001]) {
      expect(buildManualCashMovement({ ...base, amount, concept: 'X' })).toMatchObject({
        ok: false,
        error: 'cash/invalid-amount',
      });
    }
  });
  it('concepto vacío es cash/concept-required', () => {
    expect(buildManualCashMovement({ ...base, amount: 10, concept: '  ' })).toEqual({
      ok: false,
      error: 'cash/concept-required',
      meta: undefined,
    });
  });
});
```

En `errors.test.ts`: los tres códigos nuevos devuelven un texto no vacío (seguir el patrón existente del archivo).

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/cash-count.test.ts src/domain/cash-movement.test.ts src/ui/errors.test.ts`

- [ ] **Step 3: implementar**

`src/domain/cash-count.ts`:
```typescript
import { buildCountAdjustment, type CashMovement } from './cash-movement.ts';
import { err, ok, type Result } from './result.ts';
import { roundAmount } from './rounding.ts';
import type { Sale } from './sale.ts';

/**
 * Arqueo de caja (epic #94, Etapa 5 — #100). Se guarda siempre, tenga o no diferencia: es la base
 * del saldo de efectivo. Solo la diferencia viaja, como un `CashMovement` con
 * `source: 'count-adjustment'` (`adjustmentId`).
 */
export type CashCount = {
  id: string; // ULID
  expected: number;
  counted: number;
  createdAt: string; // ISO 8601
  /** El ajuste (`CashMovement` con `source: 'count-adjustment'`), si hubo diferencia. */
  adjustmentId?: string;
};

/** Pasadas 24 h sin arqueo, la barra de estado lo avisa (spec de #100, §6). */
export const CASH_COUNT_OVERDUE_MS = 24 * 60 * 60 * 1000;

/**
 * Saldo de efectivo (spec de #100, §1): lo contado en el último arqueo, más los pagos en efectivo
 * de las ventas posteriores (con su signo: anulaciones y devoluciones restan solas), más los
 * ingresos menos los egresos manuales posteriores. Los ajustes por arqueo nunca suman: el `counted`
 * de su arqueo ya los incluye. Sin arqueo, base 0 desde el inicio de la terminal. "Posterior" es
 * estricto (`createdAt > lastCount.createdAt`); los ISO de la app son todos UTC con `Z`, así que se
 * comparan como texto.
 */
export function calculateCashBalance(params: {
  lastCount: Pick<CashCount, 'counted' | 'createdAt'> | undefined;
  sales: readonly Pick<Sale, 'createdAt' | 'payments'>[];
  movements: readonly Pick<CashMovement, 'createdAt' | 'direction' | 'amount' | 'source'>[];
}): number {
  const since = params.lastCount?.createdAt;
  const isAfter = (iso: string): boolean => since === undefined || iso > since;
  let balance = params.lastCount?.counted ?? 0;
  for (const sale of params.sales) {
    if (!isAfter(sale.createdAt)) continue;
    for (const payment of sale.payments) {
      if (payment.method === 'cash') balance += payment.amount;
    }
  }
  for (const movement of params.movements) {
    if (movement.source !== 'manual' || !isAfter(movement.createdAt)) continue;
    balance += movement.direction === 'in' ? movement.amount : -movement.amount;
  }
  return roundAmount(balance);
}

/** Un arqueo y, si lo contado difiere de lo esperado, su ajuste. */
export function buildCashCount(params: {
  id: string;
  adjustmentId: string;
  expected: number;
  counted: number;
  now: string;
}): Result<{ count: CashCount; adjustment?: CashMovement }> {
  if (!Number.isFinite(params.counted) || params.counted < 0) {
    return err('cash/invalid-amount', { amount: params.counted });
  }
  const expected = roundAmount(params.expected);
  const counted = roundAmount(params.counted);
  const adjustment = buildCountAdjustment({
    id: params.adjustmentId,
    expected,
    counted,
    now: params.now,
  });
  const count: CashCount = {
    id: params.id,
    expected,
    counted,
    createdAt: params.now,
    ...(adjustment !== undefined ? { adjustmentId: adjustment.id } : {}),
  };
  return ok(adjustment !== undefined ? { count, adjustment } : { count });
}

export function isCashCountOverdue(lastCountAt: string | undefined, now: string): boolean {
  return lastCountAt === undefined || Date.parse(now) - Date.parse(lastCountAt) > CASH_COUNT_OVERDUE_MS;
}
```

En `src/domain/cash-movement.ts`, actualizar el JSDoc del tipo ("lo genera `/CAJA` desde la Etapa 5") y agregar (importando `err`, `ok`, `type Result` de `./result.ts`):
```typescript
/**
 * Ingreso o egreso manual (`/CAJA`, spec de #100, §1). El monto se redondea a 2 decimales y tiene
 * que quedar mayor que 0; el concepto se recorta y no puede quedar vacío; una descripción vacía se
 * omite.
 */
export function buildManualCashMovement(params: {
  id: string;
  direction: 'in' | 'out';
  amount: number;
  concept: string;
  description?: string;
  now: string;
}): Result<CashMovement> {
  const amount = roundAmount(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return err('cash/invalid-amount', { amount: params.amount });
  }
  const concept = params.concept.trim();
  if (concept === '') {
    return err('cash/concept-required', undefined);
  }
  const description = params.description?.trim() ?? '';
  return ok({
    id: params.id,
    direction: params.direction,
    amount,
    concept,
    ...(description !== '' ? { description } : {}),
    source: 'manual',
    createdAt: params.now,
  });
}
```

`src/domain/result.ts`: bloque nuevo `// cash-count.ts, cash-movement.ts, storage/cash-repository.ts (caja sin turnos, #100)` con los tres códigos. Los `cash-session/*` se quedan hasta la Task 9.

`src/ui/errors.ts`:
```typescript
    case 'cash/invalid-amount':
      return 'Monto inválido.';
    case 'cash/concept-required':
      return 'Falta el concepto.';
    case 'cash/persist-failed':
      return `No se pudo guardar el movimiento de caja (${failure.meta.message}).`;
```

- [ ] **Step 4: correr** los tests del Step 2 → PASS.

- [ ] **Step 5: commit** `feat(domain): saldo de efectivo, arqueo e ingreso/egreso de caja (#100)`

---

### Task 4: Conceptos sugeridos — ranking y búsqueda

**Files:**
- Create: `src/domain/concept-ranking.ts`, `src/domain/concept-ranking.test.ts`, `src/domain/concept-search.ts`, `src/storage/flexsearch-concept-search.ts`, `src/storage/flexsearch-concept-search.test.ts`

**Interfaces:**
- Produces (`domain/concept-ranking.ts`): `type CashConcept = { direction: 'in' | 'out'; concept: string; uses: number; lastUsedAt: string }`, `CONCEPT_HALF_LIFE_DAYS = 14`, `CONCEPT_SUGGESTIONS_LIMIT = 8`, `conceptKey(concept: string): string`, `conceptScore(concept: CashConcept, now: string): number`, `rankConcepts(concepts: readonly CashConcept[], now: string, limit?: number): CashConcept[]`, `recordConceptUse(existing: CashConcept | undefined, params: { direction: 'in' | 'out'; concept: string; now: string }): CashConcept`.
- Produces (`domain/concept-search.ts`): `interface ConceptSearch { search(query: string): string[] }` (devuelve `conceptKey`s).
- Produces (`storage/flexsearch-concept-search.ts`): `class FlexSearchConceptSearch implements ConceptSearch` con `constructor(concepts: readonly CashConcept[])`.

- [ ] **Step 1: tests que fallan**

`src/domain/concept-ranking.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { conceptKey, conceptScore, rankConcepts, recordConceptUse } from './concept-ranking.ts';

const now = '2026-09-24T12:00:00.000Z';
const daysAgo = (days: number): string => new Date(Date.parse(now) - days * 86_400_000).toISOString();
const c = (concept: string, uses: number, days: number) => ({
  direction: 'in' as const,
  concept,
  uses,
  lastUsedAt: daysAgo(days),
});

describe('concept-ranking', () => {
  it('conceptKey ignora mayúsculas y espacios de más', () => {
    expect(conceptKey('  Cambio   Inicial ')).toBe('cambio inicial');
  });
  it('el puntaje se reduce a la mitad cada 14 días', () => {
    expect(conceptScore(c('a', 8, 0), now)).toBe(8);
    expect(conceptScore(c('a', 8, 14), now)).toBeCloseTo(4);
    expect(conceptScore(c('a', 8, 28), now)).toBeCloseTo(2);
  });
  it('ordena por puntaje: uno reciente le gana a uno más usado pero viejo', () => {
    const ranked = rankConcepts([c('viejo', 10, 60), c('reciente', 3, 0), c('medio', 4, 7)], now);
    expect(ranked.map((x) => x.concept)).toEqual(['reciente', 'medio', 'viejo']);
  });
  it('tope de 8 por defecto', () => {
    const many = Array.from({ length: 12 }, (_, i) => c(`c${String(i)}`, i + 1, 0));
    expect(rankConcepts(many, now)).toHaveLength(8);
  });
  it('recordConceptUse suma un uso y conserva la grafía original', () => {
    expect(recordConceptUse(c('Cambio inicial', 2, 3), { direction: 'in', concept: 'cambio INICIAL', now })).toEqual({
      direction: 'in',
      concept: 'Cambio inicial',
      uses: 3,
      lastUsedAt: now,
    });
    expect(recordConceptUse(undefined, { direction: 'out', concept: '  Flete ', now })).toEqual({
      direction: 'out',
      concept: 'Flete',
      uses: 1,
      lastUsedAt: now,
    });
  });
});
```
(Puntajes del test de orden: reciente = 3, medio = 4 × 0,5^0,5 ≈ 2,83, viejo = 10 × 0,5^(60/14) ≈ 0,51.)

`src/storage/flexsearch-concept-search.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { FlexSearchConceptSearch } from './flexsearch-concept-search.ts';

const concept = (text: string) => ({
  direction: 'in' as const,
  concept: text,
  uses: 1,
  lastUsedAt: '2026-09-24T00:00:00.000Z',
});

describe('FlexSearchConceptSearch', () => {
  it('encuentra por prefijo de cualquier palabra y devuelve las claves', () => {
    const search = new FlexSearchConceptSearch([concept('Cambio inicial'), concept('Pago a proveedor')]);
    expect(search.search('prov')).toEqual(['pago a proveedor']);
    expect(search.search('cam')).toEqual(['cambio inicial']);
  });
});
```

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/concept-ranking.test.ts src/storage/flexsearch-concept-search.test.ts`

- [ ] **Step 3: implementar**

`src/domain/concept-ranking.ts`:
```typescript
/**
 * Estadística de uso de un concepto de ingreso o egreso (`/CAJA`, spec de #100, §1). Ingreso y
 * egreso llevan estadísticas separadas. La clave es `[direction+concept]` con la grafía de la
 * primera vez; la comparación ignora mayúsculas y espacios de más (`conceptKey`).
 */
export type CashConcept = {
  direction: 'in' | 'out';
  concept: string;
  uses: number;
  lastUsedAt: string; // ISO 8601
};

export const CONCEPT_HALF_LIFE_DAYS = 14;
export const CONCEPT_SUGGESTIONS_LIMIT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

function collapseSpaces(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function conceptKey(concept: string): string {
  return collapseSpaces(concept).toLocaleLowerCase();
}

/** Usos ponderados por recencia: la mitad cada 14 días desde el último uso. */
export function conceptScore(concept: CashConcept, now: string): number {
  const days = Math.max(0, (Date.parse(now) - Date.parse(concept.lastUsedAt)) / DAY_MS);
  return concept.uses * 0.5 ** (days / CONCEPT_HALF_LIFE_DAYS);
}

export function rankConcepts(
  concepts: readonly CashConcept[],
  now: string,
  limit = CONCEPT_SUGGESTIONS_LIMIT,
): CashConcept[] {
  return [...concepts]
    .sort(
      (a, b) =>
        conceptScore(b, now) - conceptScore(a, now) || a.concept.localeCompare(b.concept),
    )
    .slice(0, limit);
}

/** La estadística después de usar el concepto una vez más. */
export function recordConceptUse(
  existing: CashConcept | undefined,
  params: { direction: 'in' | 'out'; concept: string; now: string },
): CashConcept {
  if (existing !== undefined) {
    return { ...existing, uses: existing.uses + 1, lastUsedAt: params.now };
  }
  return {
    direction: params.direction,
    concept: collapseSpaces(params.concept),
    uses: 1,
    lastUsedAt: params.now,
  };
}
```

`src/domain/concept-search.ts`:
```typescript
/**
 * Puerto de búsqueda difusa de conceptos de caja — mismo patrón que `CustomerSearch` (la
 * implementación con FlexSearch vive en `storage/`). Devuelve `conceptKey`s; el orden final lo pone
 * `concept-ranking.ts`, no la relevancia de la búsqueda.
 */
export interface ConceptSearch {
  search(query: string): string[];
}
```

`src/storage/flexsearch-concept-search.ts`:
```typescript
import { Index } from 'flexsearch';
import { conceptKey, type CashConcept } from '../domain/concept-ranking.ts';
import type { ConceptSearch } from '../domain/concept-search.ts';

/** Implementación de `ConceptSearch` sobre FlexSearch, reusada (sin dependencia nueva). */
export class FlexSearchConceptSearch implements ConceptSearch {
  readonly #index = new Index({ tokenize: 'forward' });

  constructor(concepts: readonly CashConcept[]) {
    for (const concept of concepts) {
      this.#index.add(conceptKey(concept.concept), concept.concept);
    }
  }

  search(query: string): string[] {
    return this.#index.search(query).map(String);
  }
}
```

- [ ] **Step 4: correr** los tests del Step 2 → PASS.

- [ ] **Step 5: commit** `feat(domain): ranking y búsqueda de conceptos de caja por uso y recencia (#100)`

---

### Task 5: Caja — persistencia (Dexie v7 y `storage/cash-repository.ts`)

**Files:**
- Create: `src/storage/cash-repository.ts`, `src/storage/cash-repository.test.ts`
- Modify: `src/storage/db.ts`

**Interfaces:**
- Consumes: Tasks 3 y 4; `buildOutboxEventForCashMovement` (`domain/outbox.ts`); `currentEventOrigin` (`sync/terminal-identity.ts`); `newId`.
- Produces (`db.ts`): tablas `cashMovements: EntityTable<CashMovement, 'id'>`, `cashCounts: EntityTable<CashCount, 'id'>`, `cashConcepts: Table<CashConcept, [CashConcept['direction'], string]>`; `this.version(7)`.
- Produces (`cash-repository.ts`): `type CashBalance = { balance: number; lastCountAt?: string }`, `getCashBalance(): Promise<CashBalance>`, `recordCashCount(counted: number): Promise<Result<{ count: CashCount; adjustment?: CashMovement }>>`, `recordCashMovement(input: { direction: 'in' | 'out'; amount: number; concept: string; description?: string }): Promise<Result<CashMovement>>`, `listConceptSuggestions(direction: 'in' | 'out', query: string, now: string): Promise<string[]>`.

- [ ] **Step 1: tests que fallan** (`cash-repository.test.ts`, `'fake-indexeddb/auto'`, `await db.delete(); await db.open();` en el `beforeEach`; ventas sembradas con `db.sales.bulkAdd` y `createdAt` fijos):
  - `getCashBalance()` sin nada → `{ balance: 0 }` (sin `lastCountAt`).
  - Con una venta en efectivo de 500 → `recordCashCount(700)` guarda un `cashCount` `{ expected: 500, counted: 700, adjustmentId }`, un `cashMovement` `count-adjustment` `in` de 200 y un evento `cash-movement` `pending` en el outbox con `origin`; `getCashBalance()` → `{ balance: 700, lastCountAt: count.createdAt }`.
  - `recordCashCount(700)` otra vez sin nada nuevo → sin diferencia: un segundo `cashCount`, **ningún** movimiento ni evento nuevo.
  - `recordCashCount(-1)` → `cash/invalid-amount`, nada guardado.
  - `recordCashMovement({ direction: 'out', amount: 150, concept: 'Proveedor', description: 'Pan' })` → movimiento `manual`, su evento en el outbox, y `cashConcepts` con `{ direction: 'out', concept: 'Proveedor', uses: 1 }`; el saldo baja 150.
  - Un segundo egreso con concepto `'proveedor '` → la fila del concepto conserva `'Proveedor'` con `uses: 2` (una sola fila para `out`); un ingreso con `'Proveedor'` crea otra fila para `in`.
  - `recordCashMovement` con concepto vacío → `cash/concept-required`, nada guardado.
  - `listConceptSuggestions('out', '', now)` → los conceptos de egreso ordenados por `rankConcepts`; con `'prov'` → solo los que coinciden; nunca los de ingreso.
  - Migración: una base en versión 6 (abrir una `Dexie('offline-pos')` a mano con los `stores` de v1…v6, escribir una venta y cerrarla) se abre con `db` y conserva la venta, con las tablas nuevas vacías.

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/storage/cash-repository.test.ts`

- [ ] **Step 3: implementar**
  - `db.ts`: importar `type Table` de `dexie` y los tipos; declarar las tres tablas; agregar:
    ```typescript
    // Etapa 5 de #94 (#100): caja sin turnos. `cashMovements` son los del contrato (todos con su
    // evento en el outbox); `cashCounts` guarda cada arqueo, aunque no tenga diferencia (base del
    // saldo); `cashConcepts` es la estadística de conceptos, nunca se limpia a los 7 días.
    this.version(7).stores({
      cashMovements: 'id, createdAt',
      cashCounts: 'id, createdAt',
      cashConcepts: '[direction+concept], direction',
    });
    ```
    (`cashSessions: null` se agrega a esta **misma** versión en la Task 9, cuando nada la use: la versión 7 no se publicó todavía.)
  - `cash-repository.ts`:
    ```typescript
    /** Lo que entra en el saldo — se llama dentro de una transacción que incluye las tres tablas. */
    async function readBalanceInputs(): Promise<{
      lastCount: CashCount | undefined;
      sales: Sale[];
      movements: CashMovement[];
    }> {
      const lastCount = await db.cashCounts.orderBy('createdAt').last();
      const since = lastCount?.createdAt;
      const [sales, movements] = await Promise.all([
        since === undefined ? db.sales.toArray() : db.sales.where('createdAt').above(since).toArray(),
        since === undefined
          ? db.cashMovements.toArray()
          : db.cashMovements.where('createdAt').above(since).toArray(),
      ]);
      return { lastCount, sales, movements };
    }
    ```
    - `getCashBalance`: transacción `'r'` sobre `[db.cashCounts, db.sales, db.cashMovements]`; `calculateCashBalance(inputs)` y `lastCountAt` si hay arqueo (spread condicional).
    - `recordCashCount(counted)`: `now` y `origin = currentEventOrigin()` antes; transacción `'rw'` sobre `[db.cashCounts, db.sales, db.cashMovements, db.outbox]`: lee, calcula `expected`, `buildCashCount({ id: newId(), adjustmentId: newId(), expected, counted, now })`; si falla, devuelve el fallo sin escribir; si no, `cashCounts.add`, y con ajuste `cashMovements.add` + `outbox.add(buildOutboxEventForCashMovement(adjustment, { now, origin }))`. `try/catch` → `cash/persist-failed`. JSDoc: el esperado que vale es el recalculado acá, no el que vio la pantalla.
    - `recordCashMovement(input)`: `buildManualCashMovement` fuera de la transacción (puro); transacción `'rw'` sobre `[db.cashMovements, db.outbox, db.cashConcepts]`: `add` del movimiento, su evento y el concepto:
      ```typescript
      const rows = await db.cashConcepts.where('direction').equals(movement.direction).toArray();
      const existing = rows.find((row) => conceptKey(row.concept) === conceptKey(movement.concept));
      await db.cashConcepts.put(
        recordConceptUse(existing, { direction: movement.direction, concept: movement.concept, now }),
      );
      ```
    - `listConceptSuggestions(direction, query, now)`: `rows` de esa dirección; con `query.trim() === ''` → `rankConcepts(rows, now)`; si no, `const keys = new Set(new FlexSearchConceptSearch(rows).search(query))` y `rankConcepts(rows.filter((row) => keys.has(conceptKey(row.concept))), now)`. Devuelve `.map((row) => row.concept)`.

- [ ] **Step 4: correr** `pnpm test -- src/storage` → PASS.

- [ ] **Step 5: commit** `feat(storage): tablas de caja (Dexie v7), arqueo e ingreso/egreso en una transacción (#100)`

---

### Task 6: Resumen del día — dominio

**Files:**
- Create: `src/domain/sales-summary.ts`, `src/domain/sales-summary.test.ts`, `src/domain/day-summary.ts`, `src/domain/day-summary.test.ts`
- Modify: `src/domain/cash-session.ts` (se le saca `calculateProductQuantities`/`ProductQuantity`), `src/domain/cash-session.test.ts` (se mueven sus tests), `src/ui/screens/cash-summary-screen.tsx` (import)

**Interfaces:**
- Produces (`domain/sales-summary.ts`): `type ProductQuantity`, `calculateProductQuantities(sales: Sale[]): ProductQuantity[]` (movida sin cambios).
- Produces (`domain/day-summary.ts`):
  ```typescript
  type DaySummary = {
    totalSold: number;
    ticketCount: number;
    voidedCount: number;
    adjustmentTotal: number;
    totalsByMethod: Record<PaymentMethod, number>;
    otherPayments: number;
    cash: { sales: number; income: number; expense: number; countAdjustments: number };
  };
  type DayEntry =
    | { kind: 'sale'; at: string; sale: Sale }
    | { kind: 'movement'; at: string; movement: CashMovement }
    | { kind: 'count'; at: string; count: CashCount };
  calculateDaySummary(params: { sales: readonly Sale[]; movements: readonly CashMovement[]; voidedSaleIds: ReadonlySet<string> }): DaySummary
  buildDayEntries(params: { sales: readonly Sale[]; movements: readonly CashMovement[]; counts: readonly CashCount[] }): DayEntry[]
  ```

- [ ] **Step 1: tests que fallan**
  - `sales-summary.test.ts`: mover tal cual los tests de `calculateProductQuantities` de `cash-session.test.ts`, más uno nuevo: una anulación con líneas negativas resta la cantidad.
  - `day-summary.test.ts`:
    - `totalSold` suma `Sale.total` de las ventas `closed` (una venta legada `status: 'voided'` no suma); una venta de 1000 y su anulación de −1000 dan `totalSold: 0`, `ticketCount: 2`, `voidedCount: 1`.
    - `totalsByMethod` por medio con signo; `otherPayments` = todo menos `cash`.
    - `adjustmentTotal` = `Σ (total − Σ unitPrice × qty)` (el mismo cálculo que el viejo `calculateCashSessionSummary`).
    - `cash`: `sales` = pagos `cash` netos; `income`/`expense` = movimientos `manual` por dirección (positivos); `countAdjustments` = ajustes con signo (`in` suma, `out` resta).
    - `buildDayEntries` ordena por `at` ascendente mezclando los tres tipos (`at` = `createdAt`).

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/sales-summary.test.ts src/domain/day-summary.test.ts`

- [ ] **Step 3: implementar**
  - Mover `ProductQuantity` y `calculateProductQuantities` (con su JSDoc) a `sales-summary.ts`; `cash-summary-screen.tsx` importa de ahí.
  - `day-summary.ts`:
    ```typescript
    function rawLinesSubtotal(lines: Sale['lines']): number {
      return lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
    }

    /**
     * Números del panel lateral de `/RESUMEN` para un día (spec de #100, §5). Una venta legada con
     * `status: 'voided'` (anterior a la Etapa 4) no suma a ningún total, igual que antes; desde la
     * Etapa 4 la anulación es otro ticket y resta por su signo.
     */
    export function calculateDaySummary(params: {
      sales: readonly Sale[];
      movements: readonly CashMovement[];
      voidedSaleIds: ReadonlySet<string>;
    }): DaySummary {
      const totalsByMethod: Record<PaymentMethod, number> = {
        cash: 0,
        debit: 0,
        credit: 0,
        transfer: 0,
        qr: 0,
        account: 0,
      };
      let totalSold = 0;
      let adjustmentTotal = 0;
      for (const sale of params.sales) {
        if (sale.status !== 'closed') continue;
        totalSold += sale.total;
        adjustmentTotal += sale.total - rawLinesSubtotal(sale.lines);
        for (const payment of sale.payments) totalsByMethod[payment.method] += payment.amount;
      }
      let income = 0;
      let expense = 0;
      let countAdjustments = 0;
      for (const movement of params.movements) {
        if (movement.source === 'count-adjustment') {
          countAdjustments += movement.direction === 'in' ? movement.amount : -movement.amount;
        } else if (movement.direction === 'in') {
          income += movement.amount;
        } else {
          expense += movement.amount;
        }
      }
      const otherPayments =
        totalsByMethod.debit + totalsByMethod.credit + totalsByMethod.transfer + totalsByMethod.qr + totalsByMethod.account;
      return {
        totalSold: roundAmount(totalSold),
        ticketCount: params.sales.length,
        voidedCount: params.sales.filter((sale) => isVoided(sale, params.voidedSaleIds)).length,
        adjustmentTotal: roundAmount(adjustmentTotal),
        totalsByMethod,
        otherPayments: roundAmount(otherPayments),
        cash: {
          sales: roundAmount(totalsByMethod.cash),
          income: roundAmount(income),
          expense: roundAmount(expense),
          countAdjustments: roundAmount(countAdjustments),
        },
      };
    }

    /** La pestaña Movimientos: ventas, movimientos de caja y arqueos del día, por hora. */
    export function buildDayEntries(params: {
      sales: readonly Sale[];
      movements: readonly CashMovement[];
      counts: readonly CashCount[];
    }): DayEntry[] {
      return [
        ...params.sales.map((sale): DayEntry => ({ kind: 'sale', at: sale.createdAt, sale })),
        ...params.movements.map(
          (movement): DayEntry => ({ kind: 'movement', at: movement.createdAt, movement }),
        ),
        ...params.counts.map((count): DayEntry => ({ kind: 'count', at: count.createdAt, count })),
      ].sort((a, b) => a.at.localeCompare(b.at));
    }
    ```
    (`isVoided` de `./sale-lifecycle.ts`, `roundAmount` de `./rounding.ts`.)

- [ ] **Step 4: correr** `pnpm test -- src/domain` → PASS; `pnpm typecheck` → PASS.

- [ ] **Step 5: commit** `feat(domain): resumen del día con movimientos de caja y arqueos (#100)`

---

### Task 7: Limpieza a 7 días con el arqueo como ancla

**Files:**
- Modify: `src/domain/local-cleanup.ts`, `src/domain/local-cleanup.test.ts`, `src/storage/local-cleanup.ts`, `src/storage/local-cleanup.test.ts`, `src/sync/cleanup-schedule.ts`, `src/sync/cleanup-schedule.test.ts`, `src/ui/format-lot.ts`, `src/ui/format-lot.test.ts`, y los tests de `/DIAGNOSTICO`/`pos.status()` que muestren el ancla

**Interfaces:**
- Consumes: `CashCount` (Task 3), tablas de la Task 5.
- Produces: `CleanupCounts = { sales; stockMovements; accountMovements; outbox; cashMovements; cashCounts }`; `CleanupInput` sin `cashSessions`, con `cashMovements: readonly Dated[]`, `cashCounts: readonly (Dated & { adjustmentId?: string })[]` y `lastCount: Dated | undefined`; `CleanupPlan` con `cashMovements: string[]`, `cashCounts: string[]` y `anchorAt: string | undefined`; `CleanupReport = { counts: CleanupCounts; anchorAt?: string }`.

- [ ] **Step 1: tests que fallan** (`domain/local-cleanup.test.ts`, reemplazando los casos de turnos):
  - **Sin arqueo**: una venta sincronizada de 10 días no se borra; un movimiento de caja sincronizado de 10 días tampoco; un movimiento de stock sincronizado de 10 días sí.
  - **Con arqueo de hace 9 días** (`lastCount`): una venta de 10 días (anterior) se borra; una de 8 días (posterior al ancla, aunque tenga más de 7) se conserva; el propio arqueo se conserva; un arqueo de 12 días se borra; un movimiento de caja de 10 días con su evento sincronizado se borra, con su evento pendiente no.
  - Un arqueo viejo con `adjustmentId` cuyo evento sigue pendiente no se borra.
  - `anchorAt === lastCount.createdAt`; sin arqueo, `undefined`.
  - Se conservan los casos que ya había (pendientes, lotes protegidos, cuenta sin venta).
  - `storage/local-cleanup.test.ts`: con datos en las tablas nuevas, `runLocalCleanup` borra y cuenta `cashMovements`/`cashCounts` y devuelve `anchorAt`.
  - `cleanup-schedule.test.ts`: un registro guardado con la forma vieja (`counts.cashSessions`, `anchorClosedAt`) se lee como `undefined` (y la limpieza vuelve a estar pendiente).
  - `format-lot.test.ts`: `formatCleanup` muestra "N movimientos de caja, M arqueos" y el ancla "Último arqueo: <fecha>"; sin registro, "Sin arqueos".

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/local-cleanup.test.ts src/storage/local-cleanup.test.ts src/sync/cleanup-schedule.test.ts src/ui/format-lot.test.ts`

- [ ] **Step 3: implementar**
  - `planLocalCleanup`: sacar todo lo de turnos. Con `anchorAt = input.lastCount?.createdAt`:
    ```typescript
    const keptByAnchor = (iso: string): boolean => anchorAt !== undefined && iso >= anchorAt;
    // Sin ningún arqueo, las ventas y los movimientos de caja son la base 0 del saldo: no se borran.
    const sales =
      anchorAt === undefined
        ? []
        : input.sales
            .filter(
              (sale) =>
                isOld(sale.createdAt) && !pendingIds.has(sale.id) && !keptByAnchor(sale.createdAt),
            )
            .map((sale) => sale.id);
    ```
    Movimientos de stock y de cuenta: la condición `inAnchor` pasa a `keptByAnchor(movement.createdAt)`. `cashMovements`: `anchorAt === undefined ? [] :` viejos, no pendientes (`pendingIds.has(movement.id)`), no `keptByAnchor`. `cashCounts`: viejos, no `keptByAnchor`, y sin `adjustmentId` o con su ajuste no pendiente. Reescribir el JSDoc con la regla nueva (spec de #100, §7), sin mencionar turnos.
  - `storage/local-cleanup.ts`: transacción sobre `[db.sales, db.stockMovements, db.accountMovements, db.outbox, db.cashMovements, db.cashCounts]`; leer también `db.cashMovements.where('createdAt').below(cutoff)`, `db.cashCounts.where('createdAt').below(cutoff)` y `db.cashCounts.orderBy('createdAt').last()`; borrar y contar; `anchorAt` si hay.
  - `sync/cleanup-schedule.ts::getLastCleanup`: validar con Zod (reemplaza el `as CleanupRecord`):
    ```typescript
    const cleanupRecordSchema = z.object({
      at: z.string(),
      counts: z.object({
        sales: z.number(),
        stockMovements: z.number(),
        accountMovements: z.number(),
        outbox: z.number(),
        cashMovements: z.number(),
        cashCounts: z.number(),
      }),
      anchorAt: z.string().optional(),
    });
    ```
    Un registro de la forma anterior no valida → `undefined` → la limpieza corre de nuevo (nunca borra de más). Con `exactOptionalPropertyTypes`, armar el resultado sin `anchorAt: undefined` (spread condicional).
  - `ui/format-lot.ts::formatCleanup`: `last` suma `${cashMovements} movimientos de caja, ${cashCounts} arqueos` (reemplaza "turnos"); `anchor`: `Último arqueo: <toLocaleString>` o `'Sin arqueos'`.

- [ ] **Step 4: correr** `pnpm test -- src/domain src/storage src/sync src/ui` → PASS.

- [ ] **Step 5: commit** `feat(storage): la limpieza a 7 días usa el último arqueo como ancla (#100)`

---

### Task 8: `/CAJA` como modal, sin turnos para cobrar

**Files:**
- Create: `src/ui/keyboard/cash-form-model.ts`, `src/ui/keyboard/cash-form-model.test.ts`, `src/ui/state/cash.ts`, `src/ui/keyboard/cash-controller.ts`, `src/ui/keyboard/cash-controller.test.ts`, `src/ui/screens/cash-screen.tsx`, `src/ui/screens/cash-screen.test.tsx`
- Delete: `src/ui/screens/cash-session-screen.tsx`, `src/ui/keyboard/cash-session-controller.ts`, `src/ui/keyboard/cash-session-controller.test.ts`, `src/ui/state/cash-session.ts`
- Modify: `src/ui/app.tsx`, `src/ui/keyboard/commands.ts`, `src/ui/keyboard/command-bar-controller.ts` (+ test), `src/ui/state/command-bar.ts`, `src/ui/components/CommandBarInput.tsx` (+ test), `src/storage/sale-repository.ts` (+ test)

**Interfaces:**
- Consumes: `getCashBalance`, `CashBalance`, `recordCashCount`, `recordCashMovement`, `listConceptSuggestions` (Task 5); `localDateKey`, `shiftDateKey` (Task 1).
- Produces (`cash-form-model.ts`, puro): `type CashKind = 'count' | 'in' | 'out'`, `CASH_KINDS: readonly CashKind[]`, `CASH_KIND_LABELS: Record<CashKind, string>`, `type CashField = 'counted' | 'concept' | 'description' | 'amount'`, `fieldsFor(kind: CashKind): readonly CashField[]`, `moveCashField(kind: CashKind, from: CashField, direction: 1 | -1): CashField | undefined`, `type CountDifference = { kind: 'over' | 'short' | 'even'; amount: number }`, `countDifference(expected: number, counted: number | undefined): CountDifference | undefined`, `exceedsBalance(kind: CashKind, amount: number | undefined, balance: number): boolean`, `describeDifference(difference: CountDifference): string`, `describeLastCount(lastCountAt: string | undefined, now: string): string`, `countNotice(difference: CountDifference): string`, `MOVEMENT_NOTICE: Record<'in' | 'out', string>`.
- Produces (`ui/state/cash.ts`): `cashKindSignal`, `cashFieldsSignal: Signal<Record<CashField, string>>`, `cashErrorSignal: Signal<{ field: CashField; message: string } | null>`, `cashBalanceSignal: Signal<CashBalance | undefined>`, `conceptSuggestionsSignal: Signal<string[]>`, `conceptSuggestionIndexSignal: Signal<number | null>`, `conceptSuggestionsOpenSignal: Signal<boolean>`, `lastCashCountAtSignal: Signal<string | undefined>`.
- Produces (`cash-controller.ts`): `enterCashScreen(kind?: CashKind): void`, `loadCashScreen(): Promise<void>`, `setCashKind(kind: CashKind): void`, `updateCashField(field: CashField, value: string): void`, `openConceptSuggestions(): void`, `closeConceptSuggestions(): void`, `moveConceptSuggestion(direction: 1 | -1): void`, `chooseConceptSuggestion(index: number): void`, `submitCash(): Promise<void>`, `cancelCash(): void`.
- Produces (`ui/state/command-bar.ts`): `commandBarNoticeSignal: Signal<string | null>`.

- [ ] **Step 1: tests que fallan**
  - **Modelo** (`cash-form-model.test.ts`, con locale fijado como en los tests de `format.ts`):
    - `fieldsFor('count')` → `['counted']`; `fieldsFor('in')` → `['concept', 'description', 'amount']`.
    - `moveCashField('in', 'concept', 1)` → `'description'`; `('in', 'amount', 1)` → `undefined`; `('in', 'concept', -1)` → `undefined`.
    - `countDifference(1000, 1200)` → `{ kind: 'over', amount: 200 }`; `(1000, 900)` → `short` 100; `(1000, 1000)` → `even` 0; `(1000, undefined)` → `undefined`.
    - `describeDifference` → "Sobran $ 200,00" / "Faltan $ 100,00" / "Sin diferencia" (con `formatMoney`; ajustar el formato exacto a lo que devuelve `formatMoney` con el locale del test).
    - `exceedsBalance('out', 600, 500)` → `true`; `('out', 500, 500)` → `false`; `('in', 600, 500)` → `false`; `('out', undefined, 500)` → `false`.
    - `describeLastCount` con `now` fijo: mismo día → "Último arqueo: hoy 09:12"; día anterior → "Último arqueo: ayer 18:40"; antes → "Último arqueo: 23/09 18:40"; sin arqueo → "Sin arqueo previo · esperado desde el inicio de la terminal".
    - `countNotice` → "Arqueo registrado: sobran $ 200,00" / "Arqueo registrado: faltan $ 100,00" / "Arqueo registrado: sin diferencia"; `MOVEMENT_NOTICE.in` → "Ingreso registrado", `.out` → "Egreso registrado".
  - **Controller** (`cash-controller.test.ts`, con `vi.mock('../../storage/cash-repository.ts')`):
    - `enterCashScreen('out')` → `activeScreenSignal.value === 'cash'`, `cashKindSignal.value === 'out'`, campos vacíos (reset síncrono).
    - `loadCashScreen()` → `cashBalanceSignal` con lo que devuelve `getCashBalance`.
    - `submitCash()` en Arqueo con `counted: 'abc'` → `cashErrorSignal.value?.field === 'counted'`, no llama `recordCashCount`.
    - `submitCash()` en Arqueo con `counted: '1200'` y un `recordCashCount` que devuelve `{ count: { expected: 1000, counted: 1200, … } }` → vuelve a `'sale'`, `commandBarNoticeSignal.value` = "Arqueo registrado: sobran …", `lastCashCountAtSignal.value === count.createdAt`.
    - `submitCash()` en Egreso con `recordCashMovement` → `cash/concept-required` → `cashErrorSignal.value?.field === 'concept'`, sigue en `'cash'`; con `cash/invalid-amount` → `field === 'amount'`; con éxito → notice "Egreso registrado".
    - `updateCashField('concept', 'prov')` abre las sugerencias y llama `listConceptSuggestions('out', 'prov', …)`; una respuesta vieja que resuelve después de una más nueva no la pisa (token de carga).
    - `moveConceptSuggestion(1)` desde `null` → `0`; `chooseConceptSuggestion(0)` pone el concepto y cierra el overlay.
  - **Pantalla** (`cash-screen.test.tsx`, repositorio mockeado):
    - Al montar en Arqueo: foco en "Contado", se ven el esperado ("Esperado" con el saldo) y la línea del último arqueo; tipear un monto mayor muestra "Sobran …".
    - Alt+2 cambia a Ingreso y enfoca Concepto; el selector tiene `role="radiogroup"` y la opción elegida `aria-checked="true"`; ↑/↓ con foco en el selector cambian la opción.
    - Ingreso: Enter en Concepto (sin sugerencia elegida) pasa a Descripción; ↓ igual; ↑ en Descripción vuelve a Concepto; con sugerencias abiertas, ↓ recorre las sugerencias en vez de mover el foco; Esc con el overlay abierto lo cierra y no sale; Esc con el overlay cerrado vuelve a la venta.
    - Egreso con monto mayor que el saldo → "El egreso supera el saldo esperado (…)" con estilo de advertencia.
    - Ctrl+Enter confirma desde cualquier campo; botones "Cancelar (Esc)" (`.btn`) y "Confirmar (Ctrl+Enter)" (`.btn-primary`); un error selecciona el campo correspondiente.
  - **Venta sin turno**:
    - `command-bar-controller.test.ts`: `triggerCheckout()` con líneas y **sin** turno abre Cobro (reemplaza el test del gate).
    - `sale-repository.test.ts`: `closeSaleAndPersist` sin turno cierra la venta.
    - `CommandBarInput.test.tsx`: con `commandBarNoticeSignal.value = 'Ingreso registrado'` se ve el texto en el slot (`role="status"`, sin "⚠"); tipear una letra lo borra; un error tiene precedencia.

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/ui/keyboard/cash-form-model.test.ts src/ui/keyboard/cash-controller.test.ts src/ui/screens/cash-screen.test.tsx src/ui/keyboard/command-bar-controller.test.ts src/storage/sale-repository.test.ts src/ui/components/CommandBarInput.test.tsx`

- [ ] **Step 3: implementar**
  - `cash-form-model.ts`: funciones puras; `describeLastCount` compara `localDateKey(lastCountAt)` con `localDateKey(now)` y `shiftDateKey(today, -1)`; la hora con `formatTime`; la fecha corta `DD/MM` sale de la clave (`${key.slice(8, 10)}/${key.slice(5, 7)}`), no de `formatDate` (que usa UTC a propósito). Etiquetas: `{ count: 'Arqueo', in: 'Ingreso', out: 'Egreso' }`. `countDifference` usa `roundAmount(counted - expected)`.
  - `ui/state/cash.ts`: los signals de arriba, con `EMPTY_CASH_FIELDS = { counted: '', concept: '', description: '', amount: '' }`. JSDoc: `lastCashCountAtSignal` lo usa el aviso de la barra de estado (Task 10).
  - `cash-controller.ts`:
    - `enterCashScreen(kind = 'count')`: resetea todo (campos, error, sugerencias, balance a `undefined`), fija `kind` y `activeScreenSignal.value = 'cash'`. No carga nada (lo hace la pantalla).
    - `loadCashScreen()`: primero el reset de campos y error (antes del `await`), después `cashBalanceSignal.value = await getCashBalance()`.
    - `setCashKind(kind)`: fija el tipo, borra el error y cierra las sugerencias (los campos quedan: cambiar de Ingreso a Egreso no pierde lo tipeado).
    - `updateCashField(field, value)`: actualiza y borra el error; si es `concept`, abre y recarga sugerencias.
    - Sugerencias: `let suggestionsToken = 0`; `refreshSuggestions()` incrementa el token, pide `listConceptSuggestions(kind, concept, new Date().toISOString())` (solo con `kind` `in`/`out`) y solo aplica si el token sigue siendo el suyo; resetea el índice a `null` (sin preselección). `openConceptSuggestions()` (al enfocar Concepto) abre y recarga.
    - `submitCash()`:
      ```typescript
      const kind = cashKindSignal.value;
      const fields = cashFieldsSignal.value;
      if (kind === 'count') {
        const counted = parseNonNegativeAmount(fields.counted);
        if (counted === undefined) {
          setError('counted', describeError({ ok: false, error: 'cash/invalid-amount', meta: { amount: Number.NaN } }));
          return;
        }
        const result = await recordCashCount(counted);
        if (!result.ok) {
          setError('counted', describeError(result));
          return;
        }
        const { count } = result.value;
        lastCashCountAtSignal.value = count.createdAt;
        finish(countNotice(countDifference(count.expected, count.counted) ?? { kind: 'even', amount: 0 }));
        return;
      }
      const result = await recordCashMovement({
        direction: kind,
        amount: parseAmount(fields.amount) ?? Number.NaN,
        concept: fields.concept,
        ...(fields.description.trim() !== '' ? { description: fields.description } : {}),
      });
      if (!result.ok) {
        setError(result.error === 'cash/concept-required' ? 'concept' : 'amount', describeError(result));
        return;
      }
      finish(MOVEMENT_NOTICE[kind]);
      ```
      `finish(notice)`: `commandBarNoticeSignal.value = notice`, reset y `activeScreenSignal.value = 'sale'`.
    - `cancelCash()`: reset y vuelve a la venta.
  - `cash-screen.tsx` (misma estructura visual que `checkout-screen.tsx`: `overlayStyle` + `dialogStyle`, `onMouseDown={keepFocusOnMouseDown}` en el overlay):
    - `useLayoutEffect(() => { void loadCashScreen(); }, [])`.
    - Título "Caja" (`<h1>`); selector `role="radiogroup"` `aria-label="Tipo de movimiento"` con un `<button role="radio" aria-checked>` por tipo y el atajo en la etiqueta ("Arqueo (Alt+1)"); `tabIndex` 0 solo en el elegido; ↑/↓ sobre el selector llaman `setCashKind` con el anterior/siguiente (sin ciclar) y enfocan el nuevo.
    - Un `ref` por campo (`Map<CashField, HTMLInputElement>`); al cambiar `cashKindSignal` (efecto de layout) se enfoca el primer campo del tipo. El error tiene campo, así que en vez de `useSelectOnErrorSignal` un `useSignalEffect` sobre `cashErrorSignal` enfoca y selecciona `refs.get(error.field)`.
    - Arqueo: filas "Esperado" (`formatMoney(balance)`) y `describeLastCount(...)`; input `aria-label="Contado"`; debajo, en vivo, `describeDifference(countDifference(balance, parseNonNegativeAmount(counted)))` si hay monto.
    - Ingreso/Egreso: inputs "Concepto" (`autocomplete="off"`, `onFocus={openConceptSuggestions}`), "Descripción" y "Monto". Overlay de sugerencias bajo Concepto (`position: absolute`, se monta solo si está abierto y hay sugerencias), filas clickeables que llaman `chooseConceptSuggestion(index)` y después enfocan Descripción; `useScrollSelectedIntoView(conceptSuggestionIndexSignal)`.
    - Advertencia de egreso (`exceedsBalance`) en `var(--color-warning)`: "El egreso supera el saldo esperado (…)".
    - Slot de error de altura fija (`minHeight`) con `role="alert"`.
    - `onKeyDown` del contenedor: Alt+1/2/3 → `setCashKind` + foco al primer campo; Ctrl+Enter → `void submitCash()`; Esc → si las sugerencias están abiertas, `closeConceptSuggestions()`, si no `cancelCash()`. `onKeyDown` de cada campo: en Concepto con sugerencias abiertas, ↑/↓ → `moveConceptSuggestion`, Enter con índice → `chooseConceptSuggestion` + foco a Descripción; en el resto, Enter o ↓ → siguiente campo (`moveCashField`), y en Arqueo Enter confirma; ↑ → anterior. `event.preventDefault()` en todo lo que maneja.
    - Botones "Cancelar (Esc)" (`.btn`) y "Confirmar (Ctrl+Enter)" (`.btn btn-primary`); un botón enfocado con Tab + Enter se activa nativo (no repetir el atajo si `event.target` es un botón).
    - Texto de ayuda: "Alt+1/2/3 cambia el tipo. Enter o ↓ pasa al campo siguiente, ↑ al anterior. Ctrl+Enter confirma, Esc cancela."
  - `app.tsx`: `case 'cash': return <CashScreen />;` (sacar el import de `CashSessionScreen`).
  - `commands.ts`: `CAJA` → `'Arqueo, ingreso o egreso de caja'`; `RESUMEN` → `'Consultar tickets, productos, medios de pago y caja de un día'`.
  - `command-bar-controller.ts`: `CAJA` llama `enterCashScreen()` de `cash-controller.ts`; `triggerCheckout` pierde el chequeo de turno (y los imports de `cash-session-repository`/`cash-session-controller`). `updateCommandBarBuffer` también limpia `commandBarNoticeSignal`.
  - `CommandBarInput.tsx`: `const hasNotice = !hasError && !hasWarning && commandBarNoticeSignal.value !== null;` entra en `showOverlay`; en el slot, después de la advertencia: `<p role="status" style={{ margin: 0, padding: 'var(--space-2)', color: 'var(--color-chrome-text)' }}>{commandBarNoticeSignal.value}</p>`.
  - `sale-repository.ts::closeSaleAndPersist`: sacar el gate `getCurrentOpenCashSession` y el error `cash-session/none-open`; `persistSaleDocument` sigue registrando la venta en un turno abierto si lo hubiera (se va en la Task 9). JSDoc actualizado.

- [ ] **Step 4: correr** `pnpm test -- src/ui src/storage` → PASS; `pnpm typecheck` y `pnpm lint` → PASS.

- [ ] **Step 5: commit** `feat(ui): /CAJA como modal de arqueo, ingreso y egreso, y cobrar sin turno (#100)`

---

### Task 9: Sin turnos — se elimina el código de turnos

**Files:**
- Delete: `src/domain/cash-session.ts`, `src/domain/cash-session.test.ts`, `src/storage/cash-session-repository.ts`, `src/storage/cash-session-repository.test.ts`
- Modify: `src/storage/db.ts`, `src/storage/sale-repository.ts`, `src/storage/local-data.ts` (+ test), `src/ui/screens/config-wizard/summary.ts` (+ test si existe), `src/domain/result.ts`, `src/ui/errors.ts` (+ test), `src/storage/cash-summary-repository.ts` (+ test: solo lo necesario para compilar — se reescribe en la Task 12), `src/ui/keyboard/cash-summary-controller.ts` (ídem), y los tests que arman `LocalDataSummary` o abren un turno: `src/storage/demo-reset.test.ts`, `src/sync/apply-connection.test.ts`, `src/sync/url-auto-config.test.ts`, `src/ui/keyboard/config-wizard-model.test.ts`, `src/ui/keyboard/void-controller.test.ts`, `src/ui/keyboard/checkout-controller.test.ts`, `src/ui/screens/void-sale-screen.test.tsx`, `src/ui/components/CommandBarInput.test.tsx`; comentarios en `src/ui/payment-labels.ts` y `src/ui/bootstrap.ts`

**Interfaces:**
- Produces: `LocalDataSummary` con `cashMovements: number` y `cashCounts: number` en lugar de `cashSessions`; `hasUserData` los cuenta.

- [ ] **Step 1: tests que fallan**
  - `local-data.test.ts`: con un `cashCount` (y ninguna venta) `hasUserData` es `true`; con un `cashMovement` también; `summarizeLocalData()` los cuenta.
  - Test del resumen del wizard: `describeLocalDataLoss` con `cashCounts: 2, cashMovements: 1` → incluye "2 arqueos" y "1 movimiento de caja".
  - `cash-repository.test.ts` (migración): después de abrir `db`, `db.tables.map((table) => table.name)` no incluye `cashSessions`.

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/storage/local-data.test.ts src/ui/screens/config-wizard src/storage/cash-repository.test.ts`

- [ ] **Step 3: implementar**
  - `db.ts`: sacar `cashSessions!` y el import de `CashSession`; agregar `cashSessions: null` al `stores` de la versión 7 con el comentario "se elimina la tabla de turnos: un turno abierto al actualizar se pierde sin migración (no hay terminales en producción)". La versión 5 queda igual (nunca se tocan versiones publicadas).
  - `sale-repository.ts`: sacar `openSession`, `recordSaleInCashSession`, `db.cashSessions` de la transacción y el párrafo de la anulación registrada en el turno.
  - Borrar los archivos de turnos. Buscar lo que quede: `pnpm typecheck` y buscar `cash-session|cashSession|CashSession` en `src/` (en `src/` no puede quedar nada salvo `LEGACY_OUTBOX_TYPES`; `e2e/` se resuelve en la Task 17).
  - `cash-summary-repository.ts`/`cash-summary-controller.ts`: hasta la Task 12, `getCashSummaryContext` arma el contexto con las ventas de hoy (`localDayRange(localDateKey(now))`) y `calculateDaySummary` en vez del turno; el gate `none-ever` desaparece.
  - `result.ts` y `errors.ts`: sacar los seis `cash-session/*`.
  - `local-data.ts`: `cashMovements: db.cashMovements.count()`, `cashCounts: db.cashCounts.count()`; `hasUserData` con `summary.cashCounts > 0 || summary.cashMovements > 0`.
  - `summary.ts::describeLocalDataLoss`: `plural(summary.cashCounts, 'arqueo', 'arqueos')` y `plural(summary.cashMovements, 'movimiento de caja', 'movimientos de caja')` en lugar de turnos; "No hace falta: no hay ventas ni pendientes" pasa a "No hace falta: no hay ventas, caja ni pendientes".
  - Actualizar los fixtures de `LocalDataSummary` en los tests listados (sacar `cashSessions`, sumar los dos campos) y los tests que abrían un turno para vender.

- [ ] **Step 4: correr** `pnpm test`, `pnpm typecheck`, `pnpm lint` → todo verde.

- [ ] **Step 5: commit** `refactor: se eliminan los turnos de caja — dominio, repositorio, tabla y errores (#100)`

---

### Task 10: Aviso "Sin arqueo en 24 h" en la barra de estado

**Files:**
- Modify: `src/ui/state/cash.ts` (+ test), `src/ui/components/StatusBar.tsx`, `src/ui/components/StatusBar.test.tsx` (crear si no existe), `src/ui/bootstrap.ts`

**Interfaces:**
- Consumes: `isCashCountOverdue` (Task 3), `lastCashCountAtSignal`, `enterCashScreen` (Task 8), `getCashBalance` (Task 5).
- Produces (`ui/state/cash.ts`): `nowMinuteSignal: Signal<string>`, `startCashClock(): () => void`, `cashCountOverdueSignal: ReadonlySignal<boolean>`.

- [ ] **Step 1: tests que fallan**
  - `cash.test.ts`: `cashCountOverdueSignal` es `true` sin arqueo; con `lastCashCountAtSignal` de hace 1 h y `nowMinuteSignal` ahora → `false`; al avanzar `nowMinuteSignal` 24 h → `true`. `startCashClock()` con `vi.useFakeTimers()` actualiza `nowMinuteSignal` cada 60 s y la función devuelta lo detiene.
  - `StatusBar.test.tsx`: con el aviso activo se ve el botón "Sin arqueo en 24 h" con `tabIndex` −1; su click abre `/CAJA` en Arqueo (`activeScreenSignal.value === 'cash'`, `cashKindSignal.value === 'count'`) y **no** abre `/DIAGNOSTICO`; sin aviso no está; convive con el botón de modo demo.

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/ui/state/cash.test.ts src/ui/components/StatusBar.test.tsx`

- [ ] **Step 3: implementar**
  - `cash.ts`:
    ```typescript
    export const nowMinuteSignal = signal(new Date().toISOString());

    /** Reloj por minuto para el aviso de arqueo — lo arranca `bootstrap`. */
    export function startCashClock(): () => void {
      const timer = setInterval(() => {
        nowMinuteSignal.value = new Date().toISOString();
      }, 60_000);
      return () => {
        clearInterval(timer);
      };
    }

    export const cashCountOverdueSignal = computed(() =>
      isCashCountOverdue(lastCashCountAtSignal.value, nowMinuteSignal.value),
    );
    ```
  - `StatusBar.tsx`: envolver lo de la derecha en `<div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>` (sacar el `marginLeft: 'auto'` del botón de demo) y sumar antes del de demo:
    ```tsx
    {cashCountOverdueSignal.value && (
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={keepFocusOnMouseDown}
        onClick={(event) => {
          event.stopPropagation();
          enterCashScreen('count');
        }}
        title="Hacer un arqueo (/CAJA)"
        style={{
          background: 'transparent',
          color: 'var(--color-chrome-warning)',
          border: '1px solid var(--color-chrome-warning)',
          borderRadius: 'var(--radius-sm, 6px)',
          padding: '2px 8px',
          fontSize: 'var(--font-size-xs, 12px)',
          cursor: 'pointer',
        }}
      >
        Sin arqueo en 24 h
      </button>
    )}
    ```
    Actualizar el JSDoc del componente (el aviso es independiente del estado de sync y de la conectividad).
  - `bootstrap.ts`: después de `refreshStockSnapshot()`, `lastCashCountAtSignal.value = (await getCashBalance()).lastCountAt;` y `startCashClock();`.

- [ ] **Step 4: correr** `pnpm test -- src/ui` → PASS.

- [ ] **Step 5: commit** `feat(ui): aviso "Sin arqueo en 24 h" en la barra de estado que abre el arqueo (#100)`

---

### Task 11: Número de ticket en el comprobante y en `/ANULAR`

**Files:**
- Create: `src/ui/format-ticket.ts`, `src/ui/format-ticket.test.ts`
- Modify: `src/ui/screens/receipt-screen.tsx` (+ test), `src/ui/screens/void-sale-screen.tsx`, `src/ui/screens/void-sale-screen.test.tsx`

**Interfaces:**
- Produces (`format-ticket.ts`): `formatTicketDate(date: string): string` (`'DD/MM'`), `ticketLabel(sale: Pick<Sale, 'ticket'>): string`, `voidOfLabel(voidTicket: Pick<Sale, 'ticket' | 'createdAt'>, original: Pick<Sale, 'ticket' | 'createdAt'> | undefined): string`.

- [ ] **Step 1: tests que fallan**
  - `format-ticket.test.ts`:
    - `ticketLabel({ ticket: { date: '2026-09-24', number: 12 } })` → `'Ticket #12'`; sin `ticket` → `'Ticket'`.
    - `voidOfLabel` con los dos numerados el mismo día → `'Anulación del #12'`; original de otra fecha → `'Anulación del #12 del 23/09'`; original sin número → `'Anulación de 14:05'` (con `formatTime`); sin original → `'Anulación'`.
  - `receipt-screen`: el comprobante de una venta con `ticket` muestra "Ticket #12" (ya no el ULID).
  - `void-sale-screen.test.tsx`: cada fila muestra "Ticket #N"; la fila de una anulación muestra "Anulación del #N · …".

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/ui/format-ticket.test.ts src/ui/screens/receipt-screen.test.tsx src/ui/screens/void-sale-screen.test.tsx`

- [ ] **Step 3: implementar**
  ```typescript
  import type { Sale } from '../domain/sale.ts';
  import { localDateKey } from '../domain/ticket-number.ts';
  import { formatTime } from './format.ts';

  /** `'YYYY-MM-DD'` → `'DD/MM'`, sin pasar por `Date` (la fecha ya es local). */
  export function formatTicketDate(date: string): string {
    return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  }

  export function ticketLabel(sale: Pick<Sale, 'ticket'>): string {
    return sale.ticket !== undefined ? `Ticket #${String(sale.ticket.number)}` : 'Ticket';
  }

  /**
   * La marca de un ticket de anulación (spec de #120, §3): "Anulación del #12" si el original es de
   * la misma fecha de ticket, "Anulación del #12 del 23/09" si es de otra; un original sin número
   * (anterior a la Etapa 5) se nombra por su hora, como antes.
   */
  export function voidOfLabel(
    voidTicket: Pick<Sale, 'ticket' | 'createdAt'>,
    original: Pick<Sale, 'ticket' | 'createdAt'> | undefined,
  ): string {
    if (original === undefined) return 'Anulación';
    if (original.ticket === undefined) return `Anulación de ${formatTime(original.createdAt)}`;
    const voidDate = voidTicket.ticket?.date ?? localDateKey(voidTicket.createdAt);
    const suffix =
      original.ticket.date === voidDate ? '' : ` del ${formatTicketDate(original.ticket.date)}`;
    return `Anulación del #${String(original.ticket.number)}${suffix}`;
  }
  ```
  - `receipt-screen.tsx`: `Venta {sale.id}` → `{ticketLabel(sale)}`.
  - `void-sale-screen.tsx::candidateLabel`: `void-ticket` → `voidOfLabel(candidate.sale, candidate.original)` más `` ` · ${formatMoney(original.total)}` `` si hay original; cada fila antepone `ticketLabel(sale)` a la fecha (`Ticket #12 · <toLocaleString>`).

- [ ] **Step 4: correr** `pnpm test -- src/ui` → PASS.

- [ ] **Step 5: commit** `feat(ui): número de ticket en el comprobante y en /ANULAR (#120)`

---

### Task 12: `/RESUMEN` por fecha

**Files:**
- Create: `src/ui/format-day.ts`, `src/ui/format-day.test.ts`
- Modify: `src/storage/cash-summary-repository.ts` (+ test), `src/ui/state/cash-summary.ts`, `src/ui/keyboard/cash-summary-controller.ts` (+ test), `src/ui/screens/cash-summary-screen.tsx` (+ test si existe), y los tests que mockeen `getCashSummaryContext`

**Interfaces:**
- Consumes: `calculateDaySummary`, `buildDayEntries`, `DayEntry`, `DaySummary` (Task 6); `saleDateKey`, `localDayRange`, `shiftDateKey`, `localDateKey` (Task 1); `ticketLabel`, `voidOfLabel`, `formatTicketDate` (Task 11); `getCashBalance`, `CashBalance` (Task 5).
- Produces (`cash-summary-repository.ts`):
  ```typescript
  type DayView = {
    date: string;
    isToday: boolean;
    oldestDate: string;
    sales: Sale[];
    entries: DayEntry[];
    summary: DaySummary;
    voidedSaleIds: Set<string>;
    voidOriginals: Map<string, Sale>;
    balance?: CashBalance; // solo hoy
  };
  getDaySummary(date: string, now: string): Promise<DayView>
  ```
- Produces (`ui/state/cash-summary.ts`): `dayViewSignal: Signal<DayView | undefined>` (reemplaza `cashSummaryContextSignal`), `cashSummaryTabSignal: Signal<'movements' | 'products' | 'payments'>`, `movementFilterSignal` (reemplaza `ticketFilterSignal`), `selectedEntryIndexSignal` (reemplaza `selectedTicketIndexSignal`); los de productos y pagos quedan.
- Produces (`cash-summary-controller.ts`): `triggerCashSummary(): Promise<void>`, `showSummaryDay(date: string): Promise<void>`, `showPreviousDay(): Promise<void>`, `showNextDay(): Promise<void>`, `exitCashSummaryScreen(): void`, `setCashSummaryTab(tab): void`, `updateMovementFilter(value: string): void`, `updateProductFilter`, `updatePaymentFilter`.
- Produces (`format-day.ts`): `formatDayHeading(date: string, today: string): string`.

- [ ] **Step 1: tests que fallan**
  - Repositorio (`fake-indexeddb`): con ventas de ayer y de hoy, un ingreso y un arqueo de hoy → `getDaySummary(hoy, now)` trae solo lo de hoy, `entries` en orden, `isToday: true`, `balance` presente, `oldestDate` = ayer; `getDaySummary(ayer, now)` no trae `balance`. Una venta con `ticket.date` de ayer pero `createdAt` pasada la medianoche cuenta para ayer. Sin ningún dato, `oldestDate` = hoy.
  - `format-day.test.ts` (locale `es-AR`): `formatDayHeading('2026-09-24', '2026-09-24')` → `'Hoy · jueves 24/09'`; `('2026-09-23', '2026-09-24')` → `'Ayer · miércoles 23/09'`; `('2026-09-22', '2026-09-24')` → `'martes 22/09'`.
  - Controller: `triggerCashSummary()` abre en hoy con la pestaña `movements`; `showPreviousDay()` carga el día anterior y conserva pestaña y filtros, con `selectedEntryIndexSignal.value === 0`; en `oldestDate` no retrocede; en hoy no avanza. Sin datos también abre (no hay más error "nunca hubo turno").
  - Pantalla:
    - Encabezado "Resumen del día" con `formatDayHeading`, botones "‹ Anterior (Alt+←)" y "Siguiente (Alt+→) ›" (deshabilitados en los extremos); Alt+← y Alt+→ navegan.
    - Pestañas "Movimientos (Alt+1)", "Productos (Alt+2)", "Medios de pago (Alt+3)".
    - Movimientos: venta → "Ticket #12" con sus líneas y sin ULID; anulación → "Ticket #13 · Anulación del #12"; ingreso → "Ingreso · Cambio inicial" con la descripción y el monto con signo `+`; egreso con `−`; arqueo → "Arqueo · contado $ X · esperado $ Y · sobran $ Z" o "· sin diferencia".
    - Buscar "12" o "#12" encuentra el ticket 12; buscar un concepto encuentra el movimiento.
    - Panel lateral: Total vendido, "Tickets emitidos" con "(1 anuladas)", Desc/Recargos, Otros pagos, Efectivo (cobros, ingresos, egresos, ajustes) y, solo en hoy, "Saldo de efectivo actual" con "desde el arqueo de 09:12" o "sin arqueo previo".
    - Día vacío: "Sin movimientos este día"; en el día más viejo: "Los datos de más de 7 días se limpian de esta terminal".

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/storage/cash-summary-repository.test.ts src/ui/format-day.test.ts src/ui/keyboard/cash-summary-controller.test.ts src/ui/screens/cash-summary-screen.test.tsx`

- [ ] **Step 3: implementar**
  - Repositorio:
    ```typescript
    export async function getDaySummary(date: string, now: string): Promise<DayView> {
      const today = localDateKey(now);
      const day = localDayRange(date);
      // Un día más ancho para las ventas: manda `ticket.date` (una venta numerada antes de la
      // medianoche puede tener `createdAt` del día siguiente si el reloj se corrigió).
      const wideFrom = localDayRange(shiftDateKey(date, -1)).from;
      const wideTo = localDayRange(shiftDateKey(date, 1)).to;
      const [candidates, movements, counts, oldest] = await Promise.all([
        db.sales.where('createdAt').between(wideFrom, wideTo, true, false).toArray(),
        db.cashMovements.where('createdAt').between(day.from, day.to, true, false).toArray(),
        db.cashCounts.where('createdAt').between(day.from, day.to, true, false).toArray(),
        oldestDataAt(),
      ]);
      const sales = candidates.filter((sale) => saleDateKey(sale) === date);
      const voidedSaleIds = await loadVoidedSaleIds(sales.map((sale) => sale.id));
      for (const sale of sales) {
        if (sale.status === 'voided') voidedSaleIds.add(sale.id);
      }
      const oldestKey = oldest !== undefined ? localDateKey(oldest) : today;
      return {
        date,
        isToday: date === today,
        oldestDate: oldestKey < today ? oldestKey : today,
        sales,
        entries: buildDayEntries({ sales, movements, counts }),
        summary: calculateDaySummary({ sales, movements, voidedSaleIds }),
        voidedSaleIds,
        voidOriginals: await loadVoidOriginals(sales),
        ...(date === today ? { balance: await getCashBalance() } : {}),
      };
    }
    ```
    `oldestDataAt()`: el menor `createdAt` entre `db.sales.orderBy('createdAt').first()`, `db.cashMovements.orderBy('createdAt').first()` y `db.cashCounts.orderBy('createdAt').first()`. Borrar `getCashSummaryContext` y `CashSummaryContext`.
  - `format-day.ts`: `today` y `shiftDateKey(today, -1)`; el día de la semana con `new Intl.DateTimeFormat(resolveLocale(), { weekday: 'long' }).format(new Date(y, m - 1, d))`; la fecha con `formatTicketDate`.
  - Controller: `triggerCashSummary` resetea pestaña, filtros y selección, `await showSummaryDay(localDateKey(new Date().toISOString()))` y cambia de pantalla; `showSummaryDay(date)` pone `selectedEntryIndexSignal.value = 0` antes del `await` y después `dayViewSignal.value = await getDaySummary(date, new Date().toISOString())`; `showPreviousDay`/`showNextDay` usan `shiftDateKey` y los límites de `dayViewSignal.value` (`oldestDate`, hoy).
  - Pantalla (`cash-summary-screen.tsx`):
    - `TicketsTab`/`TicketRow` pasan a `MovementsTab`/`EntryRow` sobre `view.entries`, con `useTicketListNavigation(selectedEntryIndexSignal, filtered.length)` (el hook ya navega bloques de alto variable). `EntryRow` despacha por `entry.kind`: la venta reusa el cuerpo de `TicketRow` con `ticketLabel(sale)` y, si es anulación, `· ${voidOfLabel(sale, view.voidOriginals.get(sale.voidsSaleId))}` (o "Anulada" si `isVoided`); movimientos y arqueos son una sola fila con hora (`formatTime`), texto y monto.
    - `filterEntries(entries, query)`: índice FlexSearch como `filterSales`, con texto por tipo — venta: `${n} #${n}` más cliente, líneas y códigos; movimiento: concepto, descripción, "ingreso"/"egreso"; arqueo: "arqueo". La consulta pierde un `#` inicial (`query.replace(/^#/, '')`) antes de buscar.
    - Productos y Medios de pago reciben `view.sales` y `view.summary.totalsByMethod`.
    - Encabezado: `<h1>Resumen del día</h1>`, `formatDayHeading(view.date, today)` y los dos botones; Alt+←/Alt+→ en `handleKeyDown` (antes del manejo de Tab).
    - Panel lateral según las Interfaces; "Tickets emitidos" = `ticketCount` + `(N anuladas)` si `voidedCount > 0`.
    - Textos de estado vacío según el Step 1.

- [ ] **Step 4: correr** `pnpm test -- src/ui src/storage` → PASS; `pnpm typecheck` y `pnpm lint` → PASS.

- [ ] **Step 5: commit** `feat(ui): /RESUMEN por fecha con movimientos de caja, arqueos y saldo actual (#100, #120)`

---

### Task 13: Contrato 4.1.0 en el POS y OpenAPI

**Files:**
- Modify: `src/domain/contract-version.ts` (+ test), `src/ui/components/StatusBar.tsx`, `src/ui/errors.ts` (+ tests de los dos mensajes), `src/connectors/rest/rest-fetch-connector.test.ts` y `src/connectors/google-sheets/bridge-client.test.ts` (si fijan `'4.0.0'`), `docs/connector-api.openapi.yaml`

**Interfaces:**
- Produces: `POS_CONTRACT_VERSION = '4.1.0'`; `contractRequirement(version: string): string` (`'4.1.0'` → `'4.1 o posterior'`).

- [ ] **Step 1: tests que fallan**
  - `contract-version.test.ts`: `isCompatibleContract('4.0.0')` → `false`; `('4.1.0')` y `('4.2.3')` → `true`; `contractRequirement('4.1.0')` → `'4.1 o posterior'`.
  - Barra de estado con backend 4.0.0 → "Backend incompatible (contrato 4.0.0, se necesita 4.1 o posterior)"; `describeError` de `sync/incompatible-contract` → "El backend usa el contrato 4.0.0; esta versión del POS necesita 4.1 o posterior."
  - Los tests de los conectores que esperan `'4.0.0'` en el header o el cuerpo pasan a `POS_CONTRACT_VERSION` (importado, no el literal).

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/contract-version.test.ts src/ui src/connectors`

- [ ] **Step 3: implementar**
  - `contract-version.ts`: `'4.1.0'` (JSDoc: "4.1.0 desde la Etapa 5 — #120: `Sale.ticket`") y
    ```typescript
    /** Lo que el POS necesita, para los mensajes (`'4.1.0'` → `'4.1 o posterior'`). */
    export function contractRequirement(version: string): string {
      const [major, minor] = version.split('.');
      return `${major ?? version}.${minor ?? '0'} o posterior`;
    }
    ```
    `contractMajor` se borra si queda sin uso.
  - StatusBar y `errors.ts` usan `contractRequirement(POS_CONTRACT_VERSION)` / `contractRequirement(failure.meta.pos)`.
  - OpenAPI: `info.version: 4.1.0` y un párrafo "Cambios respecto de 4.0.0" (`Sale.ticket`, opcional y aditivo; un backend 4.0 se ve incompatible porque podría no guardarlo); en `Sale`:
    ```yaml
    ticket:
      type: object
      description: >-
        Número del ticket en su día (4.1.0). `date` es la fecha local de la terminal con la que se
        numeró; el número arranca en 1 cada día y lo comparten ventas y anulaciones. Una venta
        anterior a 4.1.0 no lo trae.
      required: [date, number]
      properties:
        date: { type: string, format: date, example: '2026-09-24' }
        number: { type: integer, minimum: 1, example: 12 }
    ```
    Actualizar las menciones a "4.0.0" que describen la versión vigente (no las que cuentan la historia).
- [ ] **Step 4: correr** `pnpm test` → PASS; validar el YAML como en la Etapa 4 (`pnpm dlx @redocly/cli lint docs/connector-api.openapi.yaml`).

- [ ] **Step 5: commit** `feat(sync): contrato 4.1.0 — Sale.ticket y mensaje de versión requerida (#120)`

---

### Task 14: Google Sheets — puente 4.1.0 con el número de ticket

**Files:**
- Modify: `src/connectors/google-sheets/bridge.gs`, `src/connectors/google-sheets/columnas.gs`, `src/connectors/google-sheets/bridge.test.ts`, `src/connectors/google-sheets/README.md`

- [ ] **Step 1: tests que fallan** (`bridge.test.ts`, con la planilla falsa):
  - `info` → `contractVersion: '4.1.0'`.
  - Un `pushBatch` con una venta con `ticket: { date: '2026-09-24', number: 12 }` escribe "Fecha del ticket" = `2026-09-24` y "N° de ticket" = 12 en cada fila de la venta en Ventas; sin `ticket`, las dos quedan vacías.
  - Una planilla ya creada sin esas columnas las gana al final con `ensureColumns` (mismo patrón que el test de "Anula a").

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/connectors/google-sheets/bridge.test.ts`

- [ ] **Step 3: implementar**
  - `bridge.gs`: `CONTRACT_VERSION = '4.1.0'`; en `Ventas`, después de `anulaA`:
    ```javascript
    // 4.1.0 (#120): número del ticket en su día. Texto a propósito: es una fecha de calendario
    // local, no un instante (una columna 'datetime' la movería de zona horaria).
    ['fechaTicket', 'text', true],
    ['numeroTicket', 'integer', true],
    ```
    `pushSale`: `fechaTicket: sale.ticket ? sale.ticket.date : undefined, numeroTicket: sale.ticket ? sale.ticket.number : undefined,`.
  - `columnas.gs`: `fechaTicket: 'Fecha del ticket', numeroTicket: 'N° de ticket',` en Ventas.
  - README: sección "Contrato 4.1.0 (#120)" (qué cambia, que hay que redesplegar el puente — un POS 4.1 ve incompatible a un puente 4.0 — y que las dos columnas se agregan solas); actualizar la nota del principio y la lista de pruebas manuales.

- [ ] **Step 4: correr** `pnpm test -- src/connectors` → PASS.

- [ ] **Step 5: commit** `feat(sheets): puente 4.1.0 con fecha y número de ticket en Ventas (#120)`

---

### Task 15: Minibackend 4.1.0

**Files:**
- Modify: `demo-backend/src/settings.ts`, `demo-backend/src/db.ts` (comentario), `demo-backend/src/panel.html`, `demo-backend/test/routes/info.test.ts`, `demo-backend/test/routes/sync.test.ts` (o `panel.test.ts`), y los tests que manden el header con `'4.0.0'`

- [ ] **Step 1: tests que fallan**
  - `GET /info` → `contractVersion: '4.1.0'` (y `backend.version`).
  - Un push con una venta con `ticket` → después de procesar el lote, `GET /_demo/api/sales` devuelve la venta con `ticket: { date, number }`.
  - Un push con `X-POS-Contract-Version: 4.1.0` se procesa; con `3.1.0` → 409 con `contractVersion: '4.1.0'`.

- [ ] **Step 2: correr y ver que fallan** — `pnpm test:backend`

- [ ] **Step 3: implementar**
  - `settings.ts`: `CONTRACT_VERSION = '4.1.0'` (JSDoc con #120).
  - `panel.html`: columna "ticket" en la tabla de ventas: `<th>ticket</th>` y `<td>${s.ticket ? `#${s.ticket.number} · ${s.ticket.date.slice(8, 10)}/${s.ticket.date.slice(5, 7)}` : ''}</td>`.
  - `db.ts`: `SCHEMA_VERSION` no cambia (desvío 1 de este plan); comentario junto a la tabla `sales`: la venta se guarda entera en `payload`, `ticket` incluido.

- [ ] **Step 4: correr** `pnpm test:backend` y `pnpm typecheck:backend` → PASS.

- [ ] **Step 5: commit** `feat(demo-backend): contrato 4.1.0 y número de ticket en el panel (#120)`

---

### Task 16: Mini-erp 4.1.0 con la venta validada con Zod

**Files:**
- Modify: `mini-erp/src/server/routes/connector-routes.ts`, `mini-erp/src/server/connector/connector-service.ts`, `mini-erp/src/server/app.ts` (comentario), `mini-erp/test/connector-api.test.ts`, `mini-erp/test/e2e-pos-sync-lifecycle.test.ts` y los tests que mandan `'4.0.0'` (`catalog-and-branches`, `customer-and-accounts`, `db`), `mini-erp/PLAN.md`, `mini-erp/AGENTS.md`, `mini-erp/pnpm-lock.yaml`

- [ ] **Step 1: tests que fallan** (`connector-api.test.ts`):
  - `GET /info` → `contractVersion: '4.1.0'`; los requests de los tests mandan `X-POS-Contract-Version: 4.1.0`.
  - Un push con una venta con `ticket: { date: '2026-09-24', number: 12 }` → al procesarse, `sales.payload` (leído de la base del tenant, como hacen los tests existentes) contiene el `ticket` y las líneas completas.
  - Una venta con `ticket: { date: 'hoy', number: 0 }` → el lote termina en `issues` con un aviso `{ message, eventId }` de ese evento; el resto del lote se aplica.
  - Una venta sin `ticket` (POS anterior) se sigue aceptando.

- [ ] **Step 2: correr y ver que fallan** — `pnpm --dir mini-erp test`

- [ ] **Step 3: implementar**
  - `connector-routes.ts`: `CONTRACT_VERSION = '4.1.0'`.
  - `connector-service.ts`, arriba:
    ```typescript
    // Venta del Connector API 4.1.0: se valida lo que el mini-erp usa; el resto viaja tal cual al
    // payload (`passthrough`), así el ERP guarda la venta completa aunque el contrato sume campos.
    const saleEventSchema = z
      .object({
        id: z.string().min(1),
        total: z.number(),
        customerId: z.string().optional(),
        voidsSaleId: z.string().optional(),
        payments: z.array(
          z.object({ method: z.string(), amount: z.number(), reference: z.string().optional() }),
        ),
        ticket: z
          .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), number: z.number().int().min(1) })
          .optional(),
      })
      .passthrough();
    ```
    En `case 'sale'`, reemplazando el `as { … }`:
    ```typescript
    const parsed = saleEventSchema.safeParse(event['sale']);
    if (!parsed.success) {
      return {
        message: `Venta inválida: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
        eventId: event.id,
      };
    }
    const sale = parsed.data;
    ```
    El resto del caso igual (`sale.payments` ya no necesita `?? []`).
  - Lockfile: `pnpm --dir mini-erp install --ignore-workspace` (sin `--frozen-lockfile`) para que incluya `hardwired`; verificar que después `pnpm --dir mini-erp install --frozen-lockfile --ignore-workspace` pasa.
  - Docs: "Connector API 4.0.0" → "4.1.0" en `PLAN.md`, `AGENTS.md`, el comentario de `app.ts` y la descripción del test de `db.test.ts`. En `AGENTS.md`, una nota corta: los eventos del push se validan con Zod (hoy solo `sale`; el resto en #122).

- [ ] **Step 4: correr** `pnpm --dir mini-erp typecheck`, `pnpm --dir mini-erp lint`, `pnpm --dir mini-erp test` → PASS.

- [ ] **Step 5: commit** `feat(mini-erp): contrato 4.1.0 con la venta validada con Zod y lockfile al día (#120)`

---

### Task 17: E2E

**Files:**
- Create: `e2e/cash.spec.ts`
- Delete: `e2e/cash-session.spec.ts`
- Modify: `e2e/helpers.ts` (se borra `openCashSession`), `e2e/offline-sale.spec.ts`, `e2e/account-sale.spec.ts`, `e2e/cart-persistence.spec.ts`, `e2e/keyboard-only.spec.ts`, `e2e/void-sale.spec.ts`, `e2e/sale-stage-4.spec.ts`, `e2e/minibackend-sync.spec.ts`, `src/ui/bootstrap.ts` (el comentario que nombra `cash-session.spec.ts`)

- [ ] **Step 1: escribir** `cash.spec.ts` (con `test`/`expect` de `./fixtures.ts`, catálogo con `seedCatalog`):
  - Arqueo inicial: `/CAJA` → el modal abre en Arqueo con "Sin arqueo previo · esperado desde el inicio de la terminal" y el esperado en 0; tipear 1000 + Enter → vuelve a la venta con "Arqueo registrado: sobran …" en el slot; en IndexedDB hay un `cashCounts` y un evento `cash-movement` (`count-adjustment`) pendiente.
  - Ingreso con concepto sugerido: `/CAJA`, Alt+2, concepto "Cambio inicial", monto 500, Ctrl+Enter; otra vez `/CAJA`, Alt+2 → con el foco en Concepto aparece la sugerencia "Cambio inicial"; ↓ + Enter la elige y el foco pasa a Descripción.
  - Egreso: Alt+3, monto mayor que el saldo → se ve la advertencia; Ctrl+Enter igual registra.
  - Venta sin turno y anulación con numeración: vender (Enter + Ctrl+Enter) → el comprobante dice "Ticket #1"; `/ANULAR`, Enter, Enter → en IndexedDB la anulación tiene `ticket.number === 2`; `/ANULAR` muestra "Anulación del #1".
  - `/RESUMEN` de hoy: encabezado "Hoy · …", pestaña Movimientos con "Ticket #1", "Ticket #2 · Anulación del #1", el ingreso y el arqueo; el panel muestra "Saldo de efectivo actual".
  - Aviso de 24 h: sin arqueos, la barra de estado muestra "Sin arqueo en 24 h"; su click abre `/CAJA` en Arqueo con el foco en "Contado"; después de arquear, el aviso desaparece.
- [ ] **Step 2: ajustar** los specs que usaban `openCashSession` (sacar la llamada y el import); `minibackend-sync.spec.ts` verifica que la venta que llega a `/_demo/api/sales` trae `ticket.number`.
- [ ] **Step 3: correr** `pnpm build` y `pnpm test:e2e` → PASS; `cash.spec.ts` también con `--repeat-each=3` (carreras de carga al montar).
- [ ] **Step 4: commit** `test(e2e): caja sin turnos, conceptos sugeridos, /RESUMEN del día y numeración (#100, #120)`

---

### Task 18: Documentación, issues, PR y prueba manual

**Files:**
- Modify: `CLAUDE.md`, `README.md` (si menciona turnos o `/CAJA`), `docs/superpowers/specs/2026-09-24-caja-sin-turnos-y-numeracion-design.md` (estado: implementado; desvíos de este plan)

- [ ] **Step 1: CLAUDE.md**: "Patrón outbox" (limpieza con el arqueo como ancla, `cashConcepts` nunca se limpia), "Connector API" (4.1.0, `Sale.ticket`, puente, minibackend y mini-erp en 4.1.0), "UX keyboard-first" (`/CAJA` modal, aviso informativo en el slot, `/RESUMEN` por fecha, descripciones de comandos), la sección "Turno de caja obligatorio para cobrar" se reemplaza por "Caja sin turnos" (saldo, arqueo, ingreso/egreso, conceptos, numeración), "Teclado y mouse" (`/CAJA` ya incluido; aviso de la barra de estado), `/DIAGNOSTICO` (ancla = último arqueo), "Testing" (sin `openCashSession`), y una entrada en "Estado del proyecto" para la Etapa 5 con los desvíos del plan.
- [ ] **Step 2: verificación completa**: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm test:backend`, `pnpm typecheck:backend`, `pnpm --dir mini-erp typecheck`, `pnpm --dir mini-erp lint`, `pnpm --dir mini-erp test`, `pnpm test:e2e` → todo verde.
- [ ] **Step 3: commit** `docs: CLAUDE.md y spec para la Etapa 5 (#100, #120)`
- [ ] **Step 4: issues** (el usuario nunca edita issues a mano): comentar #100 (qué quedó y los desvíos), #120 (numeración y contrato 4.1.0), #94 (Etapa 5 lista para tildar al mergear) y #57 (cómo quedó el modal de `/CAJA` respecto de sus criterios); mencionar #122 donde corresponda.
- [ ] **Step 5: PR** de la etapa contra `main` (merge commit normal, no squash), con resumen, desvíos y pasos de prueba; terminar con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 6: prueba manual**: levantar el minibackend y la app (`pnpm dev`) y armar las instrucciones paso a paso: configurar la terminal contra `rest-demo`; arqueo inicial con diferencia (ver el ajuste en `/_demo`); ingreso y egreso con conceptos sugeridos (repetir un concepto y ver el orden); egreso mayor que el saldo; vender y anular (números en el comprobante, en `/ANULAR` y en el panel `/_demo`); `/RESUMEN` de hoy y navegar a ayer; el aviso de 24 h (sin arqueos todavía, o borrando los arqueos desde DevTools) y su click; `/DIAGNOSTICO` con el ancla nueva.
