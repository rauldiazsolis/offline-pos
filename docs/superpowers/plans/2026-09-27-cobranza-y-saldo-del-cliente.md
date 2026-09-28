# Cobranza sin venta y saldo del cliente — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. En este repo se ejecuta **inline** con executing-plans, con TDD, un commit y un resumen por tarea.

**Goal:** Etapa 6 del epic #94 (#101): cobranza sin venta con su recibo numerado por día, saldo de cada cliente (tenga o no cuenta corriente) visible en la venta, la cobranza y el cobro; saldo de efectivo, `/RESUMEN` y limpieza con cobranzas; contrato 4.2.0 en el POS, el OpenAPI, Sheets, el minibackend y el mini-erp.

**Architecture:** El saldo sale de `CustomerAccount` a una tabla propia (`customerBalances`, Dexie v8), así un saldo a favor nunca se confunde con crédito; el pull lo trae en `ConnectorCustomer.balance` para cualquier cliente. La cobranza se persiste en una transacción con su recibo, su movimiento de cuenta, el saldo y su evento `customer-payment`. En la UI, una pantalla de cobranza que comparte los campos de medio de pago con Cobro, un comprobante de cobranza y la fila "Saldo" en la tarjeta de Cliente; los saldos viven en memoria como el stock.

**Tech Stack:** Preact + `@preact/signals`, Dexie, Zod, FlexSearch, Vitest + Testing Library, Playwright, Node `node:sqlite` (minibackend), Apps Script (`bridge.gs`), Express + `node:sqlite` + Zod 3 (mini-erp).

**Spec:** `docs/superpowers/specs/2026-09-27-cobranza-y-saldo-del-cliente-design.md`

## Global Constraints

- TypeScript estricto: sin `any`; `unknown` solo en el borde y validado con Zod en la línea siguiente.
- Funciones de negocio devuelven `Result<T>`, nunca lanzan. Todo `ErrorCode` nuevo se traduce en `ui/errors.ts` (el `switch` exhaustivo no compila si falta).
- `exactOptionalPropertyTypes`: los opcionales se omiten, nunca `undefined` explícito.
- Importes redondeados a 2 decimales con `domain/rounding.ts::roundAmount`; nunca redondear en otro lado.
- IDs nuevos (`CustomerPayment`, `AccountMovement`) son ULID vía `storage/ids.ts::newId`; `domain/` los recibe por parámetro.
- Saldo: positivo = debe, negativo = a favor; 0 y desconocido se muestran "Sin saldo". Informativo: nunca bloquea nada.
- Un saldo a favor **no** habilita fiado offline: sin `CustomerAccount`, `/CUENTA` offline se sigue rechazando.
- Recibo: `CustomerPayment.receipt?: { date: 'YYYY-MM-DD'; number: number }`, fecha **local**, contador `offline-pos:receipt-counter` en `localStorage` con `{ date, last }`, best-effort, independiente del de tickets. "Recibo #3".
- Cobranza: cinco medios (sin `account`), montos positivos, sin vuelto, sin tope, suma > 0.
- Contrato: `POS_CONTRACT_VERSION = '4.2.0'`; la regla de compatibilidad no cambia.
- Patrón teclado + mouse (CLAUDE.md, "Teclado y mouse"): `keepFocusOnMouseDown`, botón con el atajo en la etiqueta, `.btn`/`.btn-primary`.
- Cargar datos al entrar a una pantalla es responsabilidad del `useLayoutEffect` de esa pantalla, y cualquier reset va **antes** del primer `await`.
- Textos de UI, comentarios y commits en español. Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comandos (desde la raíz del worktree, en PowerShell — el `node` de Git Bash no está en el PATH): `pnpm test -- <ruta>` (Vitest), `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e`, `pnpm test:backend`, `pnpm typecheck:backend`. Mini-erp: `pnpm --dir mini-erp typecheck`, `pnpm --dir mini-erp lint`, `pnpm --dir mini-erp test`.
- Mini-erp: excepción puntual a su `AGENTS.md` (igual que en la Etapa 5): se modifica y se commitea desde el branch de la etapa, con sus reglas técnicas (imports relativos con `.ts`, sin parameter properties, Zod 3).

## Desvíos respecto de la spec (a confirmar con el usuario al aprobar el plan)

1. **Pantalla de cobranza propia en vez de un tercer modo de Cobro** (§1 decía "un tercer modo de la misma pantalla y el mismo controller"): `checkout-screen.tsx` ya ramifica por `charge`/`refund` en título, totales, vuelto, advertencias de carrito y hold de cuenta corriente, y la cobranza no comparte casi nada de eso. Se extrae el bloque de campos de medio de pago a un componente compartido (`ui/components/PaymentFields.tsx`) y la cobranza tiene su pantalla (`collection-screen.tsx`), su controller y su estado. Para el usuario es lo mismo: mismo diálogo, mismos campos y teclas.
2. **Comprobante con un signal propio** (§1 decía "recibe una unión"): `receiptCollectionSignal` junto a `receiptSaleSignal`, y la pantalla muestra el que esté puesto. Evita tocar todos los tests que ya ponen `receiptSaleSignal`.
3. **Saldos en memoria como el stock** (§1 decía `attachedCustomerBalanceSignal`, leído al adjuntar): `customerBalancesSignal` (la tabla entera, `ui/state/customer-balance.ts`) se recarga en los mismos puntos que `refreshStockSnapshot` y después de una cobranza. Cubre sin código extra el cliente restaurado con la venta en curso y el que cambia de saldo por un pull con el cliente adjunto.
4. **Mini-erp sin Zod para `customer-payment`** (§4 decía "el Zod de `customer-payment` acepta `receipt`"): hoy solo `sale` se valida con Zod (#122 cubre el resto) y la cobranza se guarda entera en el payload, así que `receipt` ya llega. Se agrega el test y la versión; la validación queda en #122.

---

### Task 1: Numeración diaria compartida y contador de recibos

**Files:**
- Modify: `src/domain/ticket-number.ts` (+ test), `src/sync/ticket-counter.ts` (+ test), `src/domain/customer-payment.ts` (campo `receipt`)
- Create: `src/sync/daily-counter.ts`, `src/sync/receipt-counter.ts`, `src/sync/receipt-counter.test.ts`

**Interfaces:**
- Produces (`domain/ticket-number.ts`): `type DailyNumber = { date: string; number: number }`; `type TicketNumber = DailyNumber`; `type DailyCounter = { date: string; last: number }`; `type TicketCounter = DailyCounter`; `lastDailyNumberOn(numbers: readonly (DailyNumber | undefined)[], date: string): number | undefined`; `nextDailyNumber(params: { date: string; stored: DailyCounter | undefined; lastLocal: number | undefined }): number`; `collectionDateKey(payment: { createdAt: string; receipt?: DailyNumber }): string`. `lastTicketNumberOn` y `nextTicketNumber` quedan como envoltorios (sin cambios para sus callers).
- Produces (`sync/receipt-counter.ts`): `RECEIPT_COUNTER_KEY = 'offline-pos:receipt-counter'`, `getReceiptCounter(): DailyCounter | undefined`, `setReceiptCounter(counter: DailyCounter): void`.
- Produces (`domain/customer-payment.ts`): `CustomerPayment.receipt?: DailyNumber`.

- [ ] **Step 1: tests que fallan**

En `src/domain/ticket-number.test.ts`, sumar:
```typescript
  it('lastDailyNumberOn ignora los sin número y las otras fechas', () => {
    const numbers = [
      { date: '2026-09-27', number: 2 },
      undefined,
      { date: '2026-09-27', number: 5 },
      { date: '2026-09-26', number: 9 },
    ];
    expect(lastDailyNumberOn(numbers, '2026-09-27')).toBe(5);
    expect(lastDailyNumberOn([], '2026-09-27')).toBeUndefined();
  });
  it('nextDailyNumber es la misma regla que la de tickets', () => {
    expect(
      nextDailyNumber({ date: '2026-09-27', stored: { date: '2026-09-27', last: 4 }, lastLocal: 2 }),
    ).toBe(5);
    expect(nextDailyNumber({ date: '2026-09-27', stored: undefined, lastLocal: undefined })).toBe(1);
  });
  it('collectionDateKey usa receipt.date si lo tiene', () => {
    expect(collectionDateKey({ createdAt: at(2026, 9, 27), receipt: { date: '2026-09-26', number: 1 } })).toBe(
      '2026-09-26',
    );
    expect(collectionDateKey({ createdAt: at(2026, 9, 27) })).toBe('2026-09-27');
  });
```
(agregar `collectionDateKey`, `lastDailyNumberOn`, `nextDailyNumber` al import).

`src/sync/receipt-counter.test.ts`:
```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { getTicketCounter, setTicketCounter } from './ticket-counter.ts';
import { getReceiptCounter, RECEIPT_COUNTER_KEY, setReceiptCounter } from './receipt-counter.ts';

describe('receipt-counter', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it('guarda y lee el contador de recibos', () => {
    setReceiptCounter({ date: '2026-09-27', last: 3 });
    expect(getReceiptCounter()).toEqual({ date: '2026-09-27', last: 3 });
  });
  it('es independiente del contador de tickets', () => {
    setTicketCounter({ date: '2026-09-27', last: 40 });
    expect(getReceiptCounter()).toBeUndefined();
    setReceiptCounter({ date: '2026-09-27', last: 1 });
    expect(getTicketCounter()).toEqual({ date: '2026-09-27', last: 40 });
  });
  it('un valor inválido se ignora', () => {
    localStorage.setItem(RECEIPT_COUNTER_KEY, '{"date":"hoy","last":0}');
    expect(getReceiptCounter()).toBeUndefined();
  });
});
```

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/ticket-number.test.ts src/sync/receipt-counter.test.ts`

- [ ] **Step 3: implementar**

`domain/ticket-number.ts`:
```typescript
/**
 * Número de un documento en su día local (#120 tickets, #101 recibos): `date` es la fecha con la
 * que se numeró (`'YYYY-MM-DD'`). Tickets y recibos siguen la misma regla con contadores propios.
 */
export type DailyNumber = { date: string; number: number };
export type TicketNumber = DailyNumber;

/** Último número usado, guardado en `localStorage` (`sync/daily-counter.ts`). */
export type DailyCounter = { date: string; last: number };
export type TicketCounter = DailyCounter;

/** El día al que pertenece una cobranza: el de su recibo si lo tiene, si no el de su hora local. */
export function collectionDateKey(payment: { createdAt: string; receipt?: DailyNumber }): string {
  return payment.receipt?.date ?? localDateKey(payment.createdAt);
}

/** Mayor número de `date` entre los dados. */
export function lastDailyNumberOn(
  numbers: readonly (DailyNumber | undefined)[],
  date: string,
): number | undefined {
  let last: number | undefined;
  for (const item of numbers) {
    if (item?.date === date && (last === undefined || item.number > last)) {
      last = item.number;
    }
  }
  return last;
}

export function lastTicketNumberOn(
  sales: readonly Pick<Sale, 'ticket'>[],
  date: string,
): number | undefined {
  return lastDailyNumberOn(
    sales.map((sale) => sale.ticket),
    date,
  );
}

/** (JSDoc actual de `nextTicketNumber`, generalizado a tickets y recibos.) */
export function nextDailyNumber(params: {
  date: string;
  stored: DailyCounter | undefined;
  lastLocal: number | undefined;
}): number {
  const stored = params.stored?.date === params.date ? params.stored.last : 0;
  return Math.max(stored, params.lastLocal ?? 0) + 1;
}

export const nextTicketNumber = nextDailyNumber;
```
`sync/daily-counter.ts` (lo que hoy tiene `ticket-counter.ts`, parametrizado por clave):
```typescript
import { z } from 'zod';
import type { DailyCounter } from '../domain/ticket-number.ts';

const dailyCounterSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  last: z.number().int().min(1),
});

/** Best-effort, mismo criterio que `sync/cursor.ts` (ver `ticket-counter.ts`). */
export function readDailyCounter(key: string): DailyCounter | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return undefined;
    }
    const parsed = dailyCounterSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeDailyCounter(key: string, counter: DailyCounter): void {
  try {
    localStorage.setItem(key, JSON.stringify(counter));
  } catch {
    /* best-effort */
  }
}
```
`ticket-counter.ts` conserva su JSDoc y sus exports, implementados con `readDailyCounter(TICKET_COUNTER_KEY)` / `writeDailyCounter(TICKET_COUNTER_KEY, counter)`. `receipt-counter.ts` igual con `RECEIPT_COUNTER_KEY` (JSDoc: recibos de cobranza, #101; mismas razones para vivir fuera de IndexedDB; `pos.reset()` lo borra por prefijo). `customer-payment.ts`: `receipt?: DailyNumber` con el JSDoc de la spec (§2).

- [ ] **Step 4: correr** `pnpm test -- src/domain src/sync` → PASS; `pnpm typecheck` → PASS.

- [ ] **Step 5: commit** `feat(domain): numeración diaria compartida entre tickets y recibos (#101)`

---

### Task 2: El saldo aparte del crédito (dominio, Dexie v8, pull y ventas)

**Files:**
- Create: `src/domain/customer-balance.ts`, `src/domain/customer-balance.test.ts`
- Modify: `src/domain/customer.ts` (+ test), `src/storage/db.ts`, `src/storage/sale-repository.ts` (+ test), `src/storage/apply-pull.ts` (+ test), `src/storage/reconcile.ts` (+ test), `src/sync/apply-connection.ts` (+ test), `src/sync/pull-adjust.ts` (+ test si cambia la firma), `src/storage/customer-repository.ts`, `src/ui/keyboard/checkout-controller.ts` (+ test), `e2e/account-sale.spec.ts` (siembra el saldo en `customerBalances`), y todo test que siembre `CustomerAccount` con `balance` (buscar `balance:` en `src/**/*.test.ts`)
- Create: `src/storage/db-migration.test.ts`

**Interfaces:**
- Produces (`domain/customer-balance.ts`):
  ```typescript
  export type CustomerBalance = { customerId: string; balance: number; updatedAt: string };
  export type BalanceDescription =
    | { kind: 'none' }
    | { kind: 'owes'; amount: number }
    | { kind: 'in-favor'; amount: number };
  export function describeBalance(balance: number | undefined): BalanceDescription;
  export function applyBalanceDelta(current: number | undefined, delta: number): number;
  ```
- Produces (`domain/customer.ts`): `CustomerAccount` sin `balance`; `availableCredit(account: CustomerAccount, balance: number): number`; `canChargeOffline(account: CustomerAccount, balance: number, amount: number): boolean`; `splitConnectorCustomer(raw, params): { customer: Customer; account?: CustomerAccount; balance?: CustomerBalance }`; `splitConnectorCustomers(raws, params): { customers: Customer[]; accounts: CustomerAccount[]; balances: CustomerBalance[] }`; `AccountMovement.paymentId?: string`; `buildAccountMovementForPayment(params: { id: string; customerId: string; amount: number; paymentId: string; now: string }): AccountMovement` (`type: 'payment'`).
- Produces (`storage/db.ts`): `customerBalances: EntityTable<CustomerBalance, 'customerId'>`, `customerPayments: EntityTable<CustomerPayment, 'id'>` (versión 8).
- Produces (`storage/customer-repository.ts`): `CustomerRepository.getCustomerBalance(customerId: string): Promise<number | undefined>`.

- [ ] **Step 1: tests que fallan**

`src/domain/customer-balance.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { applyBalanceDelta, describeBalance } from './customer-balance.ts';

describe('customer-balance', () => {
  it('describeBalance: positivo debe, negativo a favor, 0 o desconocido sin saldo', () => {
    expect(describeBalance(1500)).toEqual({ kind: 'owes', amount: 1500 });
    expect(describeBalance(-200.5)).toEqual({ kind: 'in-favor', amount: 200.5 });
    expect(describeBalance(0)).toEqual({ kind: 'none' });
    expect(describeBalance(undefined)).toEqual({ kind: 'none' });
  });
  it('applyBalanceDelta parte de 0 sin saldo y redondea', () => {
    expect(applyBalanceDelta(undefined, -500)).toBe(-500);
    expect(applyBalanceDelta(100.1, 0.2)).toBe(100.3);
  });
});
```
En `src/domain/customer.test.ts`, adaptar los casos existentes a la firma nueva y sumar:
```typescript
  it('canChargeOffline: la misma regla con el saldo aparte', () => {
    const account = { customerId: 'c1', creditLimit: 1000, margin: 100, updatedAt: 'x' };
    expect(canChargeOffline(account, 800, 300)).toBe(true); // 1000 + 100 - 800 = 300
    expect(canChargeOffline(account, 800, 300.01)).toBe(false);
    expect(canChargeOffline({ ...account, unrestricted: true }, 5000, 1)).toBe(true);
  });
  it('un saldo a favor suma crédito disponible solo si hay cuenta', () => {
    const account = { customerId: 'c1', creditLimit: 0, margin: 0, updatedAt: 'x' };
    expect(availableCredit(account, -200)).toBe(200);
  });
  it('splitConnectorCustomer: un balance solo arma saldo sin cuenta', () => {
    const split = splitConnectorCustomer(
      { id: 'c1', name: 'Ana', createdAt: '2026-09-01T00:00:00.000Z', balance: -300 },
      { now: '2026-09-27T10:00:00.000Z' },
    );
    expect(split.account).toBeUndefined();
    expect(split.balance).toEqual({
      customerId: 'c1',
      balance: -300,
      updatedAt: '2026-09-27T10:00:00.000Z',
    });
  });
  it('splitConnectorCustomer: crédito completo arma cuenta y saldo', () => {
    const split = splitConnectorCustomer(
      { id: 'c1', name: 'Ana', createdAt: 'x', creditLimit: 1000, margin: 50, balance: 200, updatedAt: 'u' },
      { now: 'n' },
    );
    expect(split.account).toEqual({ customerId: 'c1', creditLimit: 1000, margin: 50, updatedAt: 'u' });
    expect(split.balance).toEqual({ customerId: 'c1', balance: 200, updatedAt: 'u' });
  });
  it('splitConnectorCustomer: unrestricted sin saldo arma cuenta sin saldo', () => {
    const split = splitConnectorCustomer(
      { id: 'c1', name: 'Ana', createdAt: 'x', unrestricted: true },
      { now: 'n' },
    );
    expect(split.account).toEqual({ customerId: 'c1', creditLimit: 0, margin: 0, updatedAt: 'n', unrestricted: true });
    expect(split.balance).toBeUndefined();
  });
  it('splitConnectorCustomer: creditLimit y margin sin balance siguen sin cuenta', () => {
    const split = splitConnectorCustomer(
      { id: 'c1', name: 'Ana', createdAt: 'x', creditLimit: 1000, margin: 50 },
      { now: 'n' },
    );
    expect(split.account).toBeUndefined();
    expect(split.balance).toBeUndefined();
  });
```
`src/storage/db-migration.test.ts` (con `fake-indexeddb/auto`; abre una base `offline-pos` en versión 7 con Dexie a mano, escribe una cuenta con `balance`, la cierra y abre `db`):
```typescript
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

describe('migración a la versión 8', () => {
  it('pasa el saldo de cada cuenta a customerBalances', async () => {
    const legacy = new Dexie('offline-pos');
    legacy.version(7).stores({ customerAccounts: 'customerId' });
    await legacy.open();
    await legacy.table('customerAccounts').put({
      customerId: 'c1',
      creditLimit: 1000,
      margin: 0,
      balance: 250,
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    legacy.close();

    const { db } = await import('./db.ts');
    await db.open();
    expect(await db.customerBalances.get('c1')).toEqual({
      customerId: 'c1',
      balance: 250,
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    expect(await db.customerAccounts.get('c1')).toEqual({
      customerId: 'c1',
      creditLimit: 1000,
      margin: 0,
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
  });
});
```
(Si abrir la v7 parcial choca con el esquema completo de Dexie, declarar en `legacy` las versiones 1–7 copiadas de `db.ts`.)

Storage:
- `sale-repository.test.ts`: una venta con pago `account` de un cliente **sin** fila en `customerBalances` la crea con `balance = monto`; con fila, la suma. Una devolución a cuenta (pago `account` negativo) de un cliente sin cuenta deja saldo negativo.
- `apply-pull.test.ts`: cliente que viene con `balance` → `customerBalances` = backend + efectos reaplicados (una cobranza pendiente de 500 resta 500); cliente que viene sin `balance` conserva el saldo local; con `retain` quedan los saldos locales.
- `reconcile.test.ts`: foto completa sin un cliente → se borra su saldo; cliente que vino sin `balance` → conserva su saldo local; cliente con `balance` → se pisa.
- `checkout-controller.test.ts`: `/CUENTA` offline con cuenta de `creditLimit` 1000 y saldo 900 en `customerBalances` rechaza 200 (`missing: 100`); sin cuenta y con saldo a favor, rechaza igual.

- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/customer-balance.test.ts src/domain/customer.test.ts src/storage src/ui/keyboard/checkout-controller.test.ts`

- [ ] **Step 3: implementar**

`domain/customer-balance.ts`:
```typescript
import { roundAmount } from './rounding.ts';

/**
 * Saldo de un cliente (#101), aparte del crédito (`CustomerAccount`): lo informa el backend en el
 * pull para cualquier cliente, tenga o no cuenta corriente, y el POS le suma lo que registra
 * localmente (ventas y devoluciones a cuenta, cobranzas). Positivo: debe. Negativo: a favor.
 * Informativo: nunca bloquea ni habilita nada.
 */
export type CustomerBalance = { customerId: string; balance: number; updatedAt: string };

export type BalanceDescription =
  | { kind: 'none' }
  | { kind: 'owes'; amount: number }
  | { kind: 'in-favor'; amount: number };

export function describeBalance(balance: number | undefined): BalanceDescription {
  if (balance === undefined || balance === 0) {
    return { kind: 'none' };
  }
  return balance > 0 ? { kind: 'owes', amount: balance } : { kind: 'in-favor', amount: -balance };
}

/** Sin saldo conocido parte de 0: es informativo, no fabrica crédito. */
export function applyBalanceDelta(current: number | undefined, delta: number): number {
  return roundAmount((current ?? 0) + delta);
}
```
`domain/customer.ts`:
- `CustomerAccount` sin `balance` (JSDoc: el saldo vive en `CustomerBalance`, así un saldo a favor nunca se confunde con crédito).
- `availableCredit(account, balance) = account.creditLimit + account.margin - balance`; `canChargeOffline(account, balance, amount)` con la misma regla.
- `AccountMovement` suma `paymentId?: string` (JSDoc: la cobranza que lo generó); se actualiza el JSDoc (descuenta el saldo de `customerBalances`).
- `buildAccountMovementForPayment` análogo a `buildAccountMovementForSale` con `type: 'payment'` y `paymentId`.
- `splitConnectorCustomer`:
  ```typescript
  const balance: CustomerBalance | undefined =
    raw.balance !== undefined
      ? { customerId: raw.id, balance: raw.balance, updatedAt: raw.updatedAt ?? params.now }
      : undefined;
  const withBalance = balance !== undefined ? { balance } : {};
  if (!hasFullCreditData && raw.unrestricted !== true) {
    return { customer, ...withBalance };
  }
  return {
    customer,
    account: {
      customerId: raw.id,
      creditLimit: raw.creditLimit ?? 0,
      margin: raw.margin ?? 0,
      updatedAt: raw.updatedAt ?? params.now,
      ...(raw.unrestricted === true ? { unrestricted: true } : {}),
    },
    ...withBalance,
  };
  ```
  `splitConnectorCustomers` acumula también `balances`. JSDoc: `balance` solo es "saldo sin cuenta corriente" (contrato 4.2.0).

`storage/db.ts`:
```typescript
    // Etapa 6 de #94 (#101): el saldo sale de la cuenta a su propia tabla (cualquier cliente puede
    // tener saldo, tenga o no crédito) y las cobranzas se guardan localmente (recibo, saldo de
    // efectivo, /RESUMEN).
    this.version(8)
      .stores({
        customerBalances: 'customerId',
        customerPayments: 'id, createdAt, customerId',
      })
      .upgrade(async (tx) => {
        const accounts = tx.table<CustomerAccount & { balance?: number }, string>('customerAccounts');
        const balances: CustomerBalance[] = [];
        await accounts.toCollection().modify((account) => {
          balances.push({
            customerId: account.customerId,
            balance: account.balance ?? 0,
            updatedAt: account.updatedAt,
          });
          delete account.balance;
        });
        await tx.table<CustomerBalance, string>('customerBalances').bulkPut(balances);
      });
```
`storage/sale-repository.ts::applyAccountMovements`: reemplaza la lectura/escritura de `customerAccounts` por
```typescript
    const current = await db.customerBalances.get(customerId);
    await db.customerBalances.put({
      customerId,
      balance: applyBalanceDelta(current?.balance, movement.amount),
      updatedAt: now,
    });
```
y el JSDoc (crea la fila si no existe: informativo, no inventa crédito); la transacción de `persistSaleDocument` usa `db.customerBalances` en vez de `db.customerAccounts`.

`storage/apply-pull.ts`: la transacción suma `db.customerBalances`; `localBalances` se arma con `await db.customerBalances.toArray()` (solo con `retain`, como hoy); en el delta, `bulkPut` de `balances` además de `accounts`. `sync/pull-adjust.ts` no cambia de lógica: actualizar su JSDoc ("el saldo se ajusta en los clientes que vinieron con saldo").

`storage/reconcile.ts`: después de reconciliar las cuentas (dentro del mismo `if (!skipped.includes('customers'))`):
```typescript
    // Saldos (#101): el que vino pisa; el de un cliente que vino sin saldo se conserva (el local ya
    // incluye lo de esta terminal); el de un cliente que ya no existe se borra.
    await db.customerBalances.bulkPut(balances);
    const remainingCustomers = new Set(await db.customers.toCollection().primaryKeys());
    const localBalances = await db.customerBalances.toCollection().primaryKeys();
    await db.customerBalances.bulkDelete(
      localBalances.filter((customerId) => !remainingCustomers.has(customerId)),
    );
```
`sync/apply-connection.ts` (wipe): `bulkPut` de `balances` junto a `accounts`.

`storage/customer-repository.ts`: `getCustomerBalance: async (customerId) => (await db.customerBalances.get(customerId))?.balance` con JSDoc.

`ui/keyboard/checkout-controller.ts::resolveAccountReference` (rama offline):
```typescript
  const repository = getCustomerRepository();
  const account = await repository.getCustomerAccount(customer.id);
  const balance = (await repository.getCustomerBalance(customer.id)) ?? 0;
  if (account === undefined || !canChargeOffline(account, balance, amount)) {
    const missing = account === undefined ? amount : amount - availableCredit(account, balance);
    return err('account/offline-limit-exceeded', { missing });
  }
```
Tests y fakes: todo `CustomerRepository` falso (`src/test/`, tests de UI) suma `getCustomerBalance`; los `CustomerAccount` sembrados pierden `balance` y el saldo va a `customerBalances`. `e2e/account-sale.spec.ts`: el `putIntoStore(page, 'customerAccounts', …)` pierde `balance` y se agrega un `putIntoStore(page, 'customerBalances', { customerId, balance, updatedAt })`.

- [ ] **Step 4: correr** `pnpm test` → PASS; `pnpm typecheck` y `pnpm lint` → PASS.

- [ ] **Step 5: commit** `feat(storage): el saldo del cliente aparte del crédito, en customerBalances (Dexie v8) (#101)`

---

### Task 3: Cobranza — dominio (resolver lo tipeado)

**Files:**
- Modify: `src/domain/customer-payment.ts`, `src/domain/customer-payment.test.ts`

**Interfaces:**
- Produces: `type CollectionMethod = Exclude<PaymentMethod, 'account'>`; `COLLECTION_METHODS: readonly CollectionMethod[] = ['cash', 'debit', 'credit', 'transfer', 'qr']`; `resolveCollection(tendered: Record<CollectionMethod, number>): Result<Payment[]>`.

- [ ] **Step 1: tests que fallan**
```typescript
describe('resolveCollection', () => {
  const zero = { cash: 0, debit: 0, credit: 0, transfer: 0, qr: 0 };
  it('arma los pagos positivos en el orden de los medios', () => {
    expect(resolveCollection({ ...zero, transfer: 250.255, cash: 500 })).toEqual({
      ok: true,
      value: [
        { method: 'cash', amount: 500 },
        { method: 'transfer', amount: 250.26 },
      ],
    });
  });
  it('sin ningún monto es un error', () => {
    expect(resolveCollection(zero)).toEqual({
      ok: false,
      error: 'customer-payment/invalid',
      meta: { reason: 'empty' },
    });
  });
  it('no tiene tope ni vuelto: lo tipeado es lo acreditado', () => {
    const result = resolveCollection({ ...zero, cash: 1_000_000 });
    expect(result.ok && result.value).toEqual([{ method: 'cash', amount: 1_000_000 }]);
  });
});
```
- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/customer-payment.test.ts`
- [ ] **Step 3: implementar**
```typescript
/** Los medios de una cobranza (#101): todos menos cuenta corriente, en el orden de Cobro. */
export type CollectionMethod = Exclude<PaymentMethod, 'account'>;
export const COLLECTION_METHODS: readonly CollectionMethod[] = ['cash', 'debit', 'credit', 'transfer', 'qr'];

/**
 * De lo tipeado por medio a los pagos de una cobranza (spec de #101, §2): sin vuelto (lo tendido es
 * lo acreditado) y sin tope (pagar de más deja saldo a favor); la suma tiene que ser mayor que 0.
 */
export function resolveCollection(tendered: Record<CollectionMethod, number>): Result<Payment[]> {
  const payments: Payment[] = [];
  for (const method of COLLECTION_METHODS) {
    const amount = roundAmount(tendered[method]);
    if (amount > 0) {
      payments.push({ method, amount });
    }
  }
  return payments.length === 0 ? err('customer-payment/invalid', { reason: 'empty' }) : ok(payments);
}
```
(importar `PaymentMethod` y `roundAmount`; `buildCustomerPayment` pasa a usar `roundAmount` para el total en vez de `Math.round(… * 100) / 100`).
- [ ] **Step 4: correr** `pnpm test -- src/domain` → PASS.
- [ ] **Step 5: commit** `feat(domain): resolver los pagos de una cobranza sin vuelto ni tope (#101)`

---

### Task 4: Cobranza — persistencia con recibo, movimiento, saldo y evento

**Files:**
- Create: `src/storage/customer-payment-repository.ts`, `src/storage/customer-payment-repository.test.ts`
- Modify: `src/domain/result.ts` (`customer-payment/persist-failed`), `src/ui/errors.ts` (+ test)

**Interfaces:**
- Consumes: `nextDailyNumber`, `lastDailyNumberOn`, `localDateKey`, `localDayRange`, `shiftDateKey` (Task 1); `getReceiptCounter`, `setReceiptCounter` (Task 1); `applyBalanceDelta` (Task 2); `buildAccountMovementForPayment` (Task 2); `buildCustomerPayment`, `buildOutboxEventForCustomerPayment`.
- Produces:
  ```typescript
  export type CollectionRecord = {
    payment: CustomerPayment & { receipt: DailyNumber };
    /** Ausente si el cliente no tenía saldo conocido. */
    balanceBefore?: number;
    balanceAfter: number;
  };
  export async function collectAndPersist(params: {
    customerId: string;
    payments: Payment[];
  }): Promise<Result<CollectionRecord>>;
  ```
  `ErrorMeta['customer-payment/persist-failed'] = { message: string }`.

- [ ] **Step 1: tests que fallan** (`fake-indexeddb/auto`, `db.delete()`+`db.open()` y `localStorage.clear()` en `beforeEach`, `vi.useFakeTimers()`/`vi.setSystemTime` para fijar el día, igual que `sale-repository.test.ts`):
  - Una cobranza de 500 efectivo + 200 transferencia para `c1` sin saldo → `ok`, `payment.total === 700`, `payment.receipt === { date: hoy, number: 1 }`, `balanceBefore` ausente, `balanceAfter === -700`; en la base: la cobranza en `customerPayments`, un `accountMovements` con `type: 'payment'`, `amount: -700`, `paymentId`; `customerBalances.get('c1').balance === -700`; un evento `customer-payment` pendiente en el outbox con `payment.receipt.number === 1` y `origin`.
  - Con saldo previo 1500 → `balanceBefore === 1500`, `balanceAfter === 800`.
  - Dos cobranzas el mismo día → recibos 1 y 2; `getReceiptCounter()` = `{ date: hoy, last: 2 }`.
  - Día siguiente → recibo 1 otra vez.
  - Base borrada (`db.customerPayments.clear()`) con el contador en `{ hoy, 2 }` → recibo 3.
  - Numeración independiente: con una venta cerrada hoy (ticket #1) la primera cobranza sigue siendo el recibo #1.
  - `payments: []` → `customer-payment/invalid` y la base sin cambios.
  - `errors.test.ts`: `customer-payment/persist-failed` → "No se pudo guardar la cobranza (…)."
- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/storage/customer-payment-repository.test.ts src/ui/errors.test.ts`
- [ ] **Step 3: implementar**
```typescript
/**
 * Registra una cobranza sin venta (spec de #101, §3) en **una** transacción: número de recibo del
 * día, la cobranza, su movimiento de cuenta, el saldo del cliente (crea la fila en 0 si no existía:
 * informativo, no inventa crédito) y su evento `customer-payment` — armado adentro para que viaje
 * con el número. El contador de `localStorage` se escribe después del commit, como el de tickets.
 */
export async function collectAndPersist(params: {
  customerId: string;
  payments: Payment[];
}): Promise<Result<CollectionRecord>> {
  const now = new Date().toISOString();
  const origin = currentEventOrigin();
  const built = buildCustomerPayment({
    id: newId(),
    customerId: params.customerId,
    payments: params.payments,
    now,
  });
  if (!built.ok) {
    return built;
  }
  const stored = getReceiptCounter();
  const movementId = newId();

  let record: CollectionRecord;
  try {
    record = await db.transaction(
      'rw',
      [db.customerPayments, db.accountMovements, db.customerBalances, db.outbox],
      async () => {
        const date = localDateKey(now);
        const nearby = await db.customerPayments
          .where('createdAt')
          .between(
            localDayRange(shiftDateKey(date, -1)).from,
            localDayRange(shiftDateKey(date, 1)).to,
            true,
            false,
          )
          .toArray();
        const payment = {
          ...built.value,
          receipt: {
            date,
            number: nextDailyNumber({
              date,
              stored,
              lastLocal: lastDailyNumberOn(
                nearby.map((item) => item.receipt),
                date,
              ),
            }),
          },
        };
        const current = await db.customerBalances.get(params.customerId);
        const balanceAfter = applyBalanceDelta(current?.balance, -payment.total);
        await db.customerPayments.add(payment);
        await db.accountMovements.add(
          buildAccountMovementForPayment({
            id: movementId,
            customerId: params.customerId,
            amount: -payment.total,
            paymentId: payment.id,
            now,
          }),
        );
        await db.customerBalances.put({
          customerId: params.customerId,
          balance: balanceAfter,
          updatedAt: now,
        });
        await db.outbox.add(buildOutboxEventForCustomerPayment(payment, { now, origin }));
        return {
          payment,
          ...(current !== undefined ? { balanceBefore: current.balance } : {}),
          balanceAfter,
        };
      },
    );
  } catch (error) {
    return err('customer-payment/persist-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  setReceiptCounter({ date: record.payment.receipt.date, last: record.payment.receipt.number });
  return ok(record);
}
```
`result.ts`: `'customer-payment/persist-failed': { message: string };` junto a `customer-payment/invalid`. `errors.ts`: `case 'customer-payment/persist-failed': return \`No se pudo guardar la cobranza (${failure.meta.message}).\`;`
- [ ] **Step 4: correr** `pnpm test -- src/storage src/ui/errors.test.ts` → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: commit** `feat(storage): cobranza con recibo del día, movimiento de cuenta, saldo y evento en una transacción (#101)`

---

### Task 5: Saldo de efectivo con cobranzas

**Files:**
- Modify: `src/domain/cash-count.ts` (+ test), `src/storage/cash-repository.ts` (+ test)

**Interfaces:**
- Produces: `calculateCashBalance(params: { lastCount; sales; movements; collections: readonly Pick<CustomerPayment, 'createdAt' | 'payments'>[] }): number`.

- [ ] **Step 1: tests que fallan**
  - `cash-count.test.ts` (los casos existentes pasan `collections: []`):
    ```typescript
    it('suma el efectivo de las cobranzas posteriores al arqueo', () => {
      expect(
        calculateCashBalance({
          lastCount: { counted: 1000, createdAt: '2026-09-27T10:00:00.000Z' },
          sales: [],
          movements: [],
          collections: [
            { createdAt: '2026-09-27T09:00:00.000Z', payments: [{ method: 'cash', amount: 999 }] },
            { createdAt: '2026-09-27T10:00:00.000Z', payments: [{ method: 'cash', amount: 1 }] },
            {
              createdAt: '2026-09-27T11:00:00.000Z',
              payments: [
                { method: 'cash', amount: 300 },
                { method: 'transfer', amount: 200 },
              ],
            },
          ],
        }),
      ).toBe(1300);
    });
    ```
  - `cash-repository.test.ts`: con un arqueo de 1000 y después una cobranza de 300 en efectivo (guardada directo en `db.customerPayments`), `getCashBalance()` → 1300 y `recordCashCount(1300)` no genera ajuste.
- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/cash-count.test.ts src/storage/cash-repository.test.ts`
- [ ] **Step 3: implementar**
  - `calculateCashBalance`: JSDoc suma "más el efectivo de las cobranzas posteriores (#101)"; después del bucle de ventas:
    ```typescript
    for (const collection of params.collections) {
      if (!isAfter(collection.createdAt)) continue;
      for (const payment of collection.payments) {
        if (payment.method === 'cash') balance += payment.amount;
      }
    }
    ```
  - `readBalanceInputs` lee también `db.customerPayments` (toda la tabla sin arqueo, o `where('createdAt').above(since)`) y devuelve `collections`; `getCashBalance` y `recordCashCount` suman `db.customerPayments` a sus transacciones (JSDoc de `readBalanceInputs`: la transacción incluye `customerPayments`).
- [ ] **Step 4: correr** `pnpm test -- src/domain src/storage src/ui` → PASS.
- [ ] **Step 5: commit** `feat(caja): el saldo de efectivo suma las cobranzas en efectivo (#101)`

---

### Task 6: Resumen del día con cobranzas — dominio y repositorio

**Files:**
- Modify: `src/domain/day-summary.ts` (+ test), `src/storage/cash-summary-repository.ts` (+ test)

**Interfaces:**
- Consumes: `collectionDateKey` (Task 1).
- Produces (`domain/day-summary.ts`):
  - `DaySummary` suma `collections: { total: number; count: number }`, `collectionsByMethod: Record<PaymentMethod, number>`, y `cash.collections: number`.
  - `DayEntry` suma `| { kind: 'collection'; at: string; payment: CustomerPayment }`.
  - `calculateDaySummary(params: { sales; movements; voidedSaleIds; collections: readonly CustomerPayment[] })`; `buildDayEntries(params: { sales; movements; counts; collections: readonly CustomerPayment[] })`.
- Produces (`cash-summary-repository.ts`): `DayView` suma `collections: CustomerPayment[]` y `customerNames: Map<string, string>`.

- [ ] **Step 1: tests que fallan**
  - `day-summary.test.ts`: con una venta de 1000 en efectivo y dos cobranzas (500 efectivo + 200 transferencia; 100 débito) → `totalSold` 1000 y `ticketCount` 1 (sin cambios), `collections` `{ total: 800, count: 2 }`, `collectionsByMethod` `{ cash: 500, transfer: 200, debit: 100, … 0 }`, `totalsByMethod.cash` 1000 (solo ventas), `cash.collections` 500, `otherPayments` sin las cobranzas. `buildDayEntries` intercala la cobranza por hora con `kind: 'collection'`.
  - `cash-summary-repository.test.ts`: una cobranza de hoy y una de ayer, más un cliente `c1` "Ana" → `getDaySummary(hoy, now)` trae solo la de hoy en `collections` y en `entries`, `customerNames.get('c1') === 'Ana'`; una cobranza con `receipt.date` de ayer y `createdAt` de hoy cuenta para ayer; con solo una cobranza vieja en la base, `oldestDate` es su día.
- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/day-summary.test.ts src/storage/cash-summary-repository.test.ts`
- [ ] **Step 3: implementar**
  - `calculateDaySummary`:
    ```typescript
    const collectionsByMethod = emptyByMethod();
    let collectionsTotal = 0;
    for (const collection of params.collections) {
      collectionsTotal += collection.total;
      for (const payment of collection.payments) {
        collectionsByMethod[payment.method] += payment.amount;
      }
    }
    ```
    con `emptyByMethod()` extraído del literal actual; en el retorno, `collections: { total: roundAmount(collectionsTotal), count: params.collections.length }`, `collectionsByMethod` redondeado por medio (mismo criterio que `totalsByMethod`) y `cash.collections: roundAmount(collectionsByMethod.cash)`. JSDoc de `DaySummary`: una cobranza no es una venta (no suma a total vendido ni a tickets ni a otros pagos).
  - `buildDayEntries` suma `...params.collections.map((payment): DayEntry => ({ kind: 'collection', at: payment.createdAt, payment }))`.
  - Repositorio: `oldestDataAt` suma `db.customerPayments.orderBy('createdAt').first()`; `getDaySummary` lee `db.customerPayments.where('createdAt').between(wideFrom, wideTo, true, false)`, filtra por `collectionDateKey(payment) === date`, carga los nombres con `db.customers.bulkGet([...new Set(collections.map((p) => p.customerId))])` y pasa `collections` a las dos funciones.
- [ ] **Step 4: correr** `pnpm test -- src/domain src/storage src/ui` → PASS (los tests de `/RESUMEN` que arman un `DayView` a mano suman `collections: []` y `customerNames: new Map()`); `pnpm typecheck` → PASS.
- [ ] **Step 5: commit** `feat(resumen): cobranzas en el resumen del día, separadas de las ventas (#101)`

---

### Task 7: Limpieza a 7 días con cobranzas y la regla de movimientos de cuenta unificada

**Files:**
- Modify: `src/domain/local-cleanup.ts` (+ test), `src/storage/local-cleanup.ts` (+ test), `src/sync/cleanup-schedule.ts` (+ test), `src/ui/format-lot.ts` (+ test), `src/storage/local-data.ts` (+ test), y si lista conteos, la confirmación de borrado del wizard (`src/ui/screens/config-wizard/`)

**Interfaces:**
- Produces: `CleanupCounts.customerPayments: number`; `CleanupInput.customerPayments: readonly Dated[]`; `CleanupInput.accountMovements: readonly (Dated & { saleId?: string; paymentId?: string })[]`; `CleanupPlan.customerPayments: string[]`; `LocalDataSummary.customerPayments: number`.

- [ ] **Step 1: tests que fallan**
  - `local-cleanup.test.ts` (domain):
    - Cobranza vieja sincronizada, con un arqueo posterior → se borra; con el arqueo anterior a ella → se conserva (ancla); sin ningún arqueo → se conserva; pendiente → se conserva.
    - Movimiento de cuenta viejo con `paymentId` de una cobranza pendiente → se conserva; con la cobranza sincronizada → se borra; sin `saleId` ni `paymentId` → se borra por edad; posterior al ancla → se conserva.
  - `storage/local-cleanup.test.ts`: `runLocalCleanup` borra la cobranza vieja y su movimiento y reporta `counts.customerPayments === 1`.
  - `cleanup-schedule.test.ts`: un registro guardado sin `customerPayments` se lee con `customerPayments: 0`.
  - `format-lot.test.ts`: `formatCleanup` incluye "N cobranzas".
  - `local-data.test.ts`: con solo una cobranza, `hasUserData` → `true`.
- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/local-cleanup.test.ts src/storage/local-cleanup.test.ts src/sync/cleanup-schedule.test.ts src/ui/format-lot.test.ts src/storage/local-data.test.ts`
- [ ] **Step 3: implementar**
  - `planLocalCleanup`:
    ```typescript
    // Sin evento propio: viajan dentro del evento de su venta o de su cobranza, así que esperan a
    // que ese no esté pendiente. Se borran por su propia edad, nunca "junto con" su documento.
    const accountMovements = input.accountMovements
      .filter((movement) => {
        const eventId = movement.saleId ?? movement.paymentId;
        return (
          isOld(movement.createdAt) &&
          (eventId === undefined || !pendingIds.has(eventId)) &&
          !keptByAnchor(movement.createdAt)
        );
      })
      .map((movement) => movement.id);

    // Como las ventas: suman al saldo de efectivo, así que sin ningún arqueo no se borran.
    const customerPayments =
      anchorAt === undefined
        ? []
        : input.customerPayments.filter(removable).map((payment) => payment.id);
    ```
    JSDoc: sale la frase "Sin venta se conservan (la Etapa 6 define su regla…)"; se agregan las cobranzas a la lista de lo que conserva el ancla.
  - `runLocalCleanup`: suma `db.customerPayments` a la transacción, la lectura `db.customerPayments.where('createdAt').below(cutoff)`, el `bulkDelete` y el conteo.
  - `cleanup-schedule.ts`: `customerPayments: z.number().default(0)` (comentario: un registro de antes de la Etapa 6 se lee con 0 — a diferencia del de la Etapa 5, no hay nada que invalidar).
  - `formatCleanup`: `…, ${String(counts.cashCounts)} arqueos, ${String(counts.customerPayments)} cobranzas`.
  - `local-data.ts`: `LocalDataSummary.customerPayments` (`db.customerPayments.count()`), `hasUserData` lo cuenta; si la confirmación de borrado del wizard enumera los conteos, sumar "N cobranzas".
- [ ] **Step 4: correr** `pnpm test` → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: commit** `feat(sync): la limpieza a 7 días incluye cobranzas y unifica la regla de movimientos de cuenta (#101)`

---

### Task 8: Saldo en la venta — memoria, tarjeta de Cliente y Cobro

**Files:**
- Create: `src/ui/state/customer-balance.ts`, `src/ui/format-balance.ts`, `src/ui/format-balance.test.ts`
- Modify: `src/ui/bootstrap.ts`, `src/sync/engine.ts`, `src/sync/apply-connection.ts`, `src/ui/keyboard/checkout-controller.ts` (+ test), `src/ui/keyboard/void-controller.ts`, `src/ui/keyboard/demo-reset-controller.ts`, `src/ui/components/CartView.tsx` (+ test), `src/ui/components/cart-view.css`, `src/ui/screens/checkout-screen.tsx` (+ test)

**Interfaces:**
- Consumes: `describeBalance`, `applyBalanceDelta` (Task 2).
- Produces:
  - `ui/state/customer-balance.ts`: `customerBalancesSignal: Signal<ReadonlyMap<string, number>>`, `refreshCustomerBalances(): Promise<void>`.
  - `ui/format-balance.ts`: `formatBalance(balance: number | undefined): string` → `'Debe $ 1.500,00'` / `'A favor $ 200,00'` / `'Sin saldo'` (monto con `formatMoney`).
  - `checkout-controller.ts`: `accountBalancePreview(): { before: number | undefined; after: number } | undefined` (sin cliente o sin monto en Cuenta corriente → `undefined`).

- [ ] **Step 1: tests que fallan**
  - `format-balance.test.ts` (locale `es-AR`): los tres casos, y que 0 es "Sin saldo".
  - `CartView.test.tsx`: con un cliente adjunto y `customerBalancesSignal` con `c1 → 1500` → la tarjeta muestra "Saldo: Debe $ 1.500,00"; `-200` → "Saldo: A favor $ 200,00"; sin fila → "Saldo: Sin saldo"; "Consumidor Final" no muestra saldo (fila en blanco).
  - `checkout-controller.test.ts`: `accountBalancePreview()` con saldo 1000 y 300 en Cuenta corriente en un cobro → `{ before: 1000, after: 1300 }`; en una devolución (total negativo) con 300 → `after: 700`; sin cliente → `undefined`. Después de `submitCheckout` exitoso con pago a cuenta, `customerBalancesSignal` ya tiene el saldo nuevo.
  - `checkout-screen.test.tsx`: con cliente y monto en Cuenta corriente, se ve "Saldo: Debe $ 1.000,00 → Debe $ 1.300,00"; sin monto no se ve.
- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/ui/format-balance.test.ts src/ui/components src/ui/keyboard/checkout-controller.test.ts src/ui/screens/checkout-screen.test.tsx`
- [ ] **Step 3: implementar**
  - `ui/state/customer-balance.ts`, mismo patrón que `ui/state/stock.ts`:
    ```typescript
    /**
     * Toda la tabla `customerBalances` en memoria (#101), para mostrar el saldo del cliente adjunto
     * sin una lectura async: es chica (una fila por cliente con saldo). Se recarga en los mismos
     * puntos que el stock (arranque, pull aplicado, conexión aplicada, reset de demo, cerrar o anular
     * una venta) y después de una cobranza.
     */
    export const customerBalancesSignal = signal<ReadonlyMap<string, number>>(new Map());

    export async function refreshCustomerBalances(): Promise<void> {
      const rows = await db.customerBalances.toArray();
      customerBalancesSignal.value = new Map(rows.map((row) => [row.customerId, row.balance]));
    }
    ```
    `await refreshCustomerBalances()` junto a cada `await refreshStockSnapshot()` (bootstrap, `engine.ts::finishPullCycle`, `apply-connection.ts`, `checkout-controller.ts::submitCheckout`, `void-controller.ts`, `demo-reset-controller.ts`).
  - `format-balance.ts`:
    ```typescript
    export function formatBalance(balance: number | undefined): string {
      const description = describeBalance(balance);
      switch (description.kind) {
        case 'none':
          return 'Sin saldo';
        case 'owes':
          return `Debe ${formatMoney(description.amount)}`;
        case 'in-favor':
          return `A favor ${formatMoney(description.amount)}`;
      }
    }
    ```
  - `CustomerCard`: una quinta fila fija después de teléfono/bloqueo, `<div data-testid="customer-balance" style={{ color: 'var(--color-text-muted)' }}>{customer !== undefined ? \`Saldo: ${formatBalance(customerBalancesSignal.value.get(customer.id))}\` : ' '}</div>`; en `cart-view.css`, el `min-height` de `.cart-view__customer` crece una línea (con el comentario actualizado).
  - `accountBalancePreview` en `checkout-controller.ts`:
    ```typescript
    /** Cómo queda el saldo del cliente con lo tipeado en Cuenta corriente (#101). */
    export function accountBalancePreview(): { before: number | undefined; after: number } | undefined {
      const customer = attachedCustomerSignal.value;
      const account = parsedTenderSafe().account;
      if (customer === undefined || account === 0) {
        return undefined;
      }
      const before = customerBalancesSignal.value.get(customer.id);
      const { total } = calculateTotals(cartSignal.value);
      const delta = tenderMode(total) === 'refund' ? -account : account;
      return { before, after: applyBalanceDelta(before, delta) };
    }
    ```
  - `CheckoutScreen`: en la columna derecha, debajo del total, si `accountBalancePreview()` no es `undefined`, una tarjeta `cardStyle` con el rótulo "Saldo del cliente" y `${formatBalance(before)} → ${formatBalance(after)}`.
- [ ] **Step 4: correr** `pnpm test -- src/ui src/sync` → PASS; `pnpm typecheck`, `pnpm lint` → PASS.
- [ ] **Step 5: commit** `feat(ui): saldo del cliente en la tarjeta de Cliente y en el cobro con cuenta corriente (#101)`

---

### Task 9: Pantalla de cobranza

**Files:**
- Create: `src/ui/components/PaymentFields.tsx`, `src/ui/state/collection.ts`, `src/ui/keyboard/collection-controller.ts`, `src/ui/keyboard/collection-controller.test.ts`, `src/ui/screens/collection-screen.tsx`, `src/ui/screens/collection-screen.test.tsx`
- Modify: `src/ui/screens/checkout-screen.tsx` (usa `PaymentFields`), `src/ui/state/screen.ts` (`'collection'`), `src/ui/app.tsx`, `src/ui/keyboard/command-bar-controller.ts` (+ test), `src/ui/keyboard/commands.ts` (descripción de `/COBRAR` si nombra solo "la venta")

**Interfaces:**
- Consumes: `COLLECTION_METHODS`, `CollectionMethod`, `resolveCollection` (Task 3); `collectAndPersist`, `CollectionRecord` (Task 4); `refreshCustomerBalances`, `customerBalancesSignal` (Task 8); `formatBalance` (Task 8); `applyBalanceDelta` (Task 2).
- Produces:
  - `ui/components/PaymentFields.tsx`:
    ```typescript
    export function PaymentFields<M extends PaymentMethod>(props: {
      methods: readonly M[];
      buffers: Record<M, string>;
      isDisabled?: (method: M) => boolean;
      onInput: (method: M, value: string) => void;
      onKeyDown: (method: M, event: TargetedKeyboardEvent<HTMLInputElement>) => void;
      firstFieldRef: Ref<HTMLInputElement | null>;
      fieldRefs: MutableRef<Map<M, HTMLInputElement>>;
    }): JSX.Element;
    ```
    (el `map` de campos que hoy vive en `CheckoutScreen`, sin cambios de marcado ni estilos).
  - `ui/state/collection.ts`: `collectionBuffersSignal: Signal<Record<CollectionMethod, string>>`, `collectionErrorSignal: Signal<string | null>`, `resetCollection(): void`.
  - `collection-controller.ts`: `enterCollection(): void`, `moveCollectionField(from: CollectionMethod, direction: 1 | -1): CollectionMethod | undefined`, `collectionTotalPreview(): number`, `collectionBalancePreview(): { before: number | undefined; after: number }`, `cancelCollection(): void`, `submitCollection(): Promise<void>`.
  - `ActiveScreen` suma `'collection'`.
  - `receipt.ts` (usado acá, completado en Task 10): `receiptCollectionSignal: Signal<CollectionReceipt | null>` con `type CollectionReceipt = CollectionRecord & { customerName: string }`.

- [ ] **Step 1: tests que fallan**
  - `command-bar-controller.test.ts`: sin líneas y con cliente, Enter con la barra vacía → `activeScreenSignal.value === 'collection'` (sale el mensaje "llega en una próxima versión"); `/COBRAR` y Ctrl+Enter (`triggerCheckout`) igual; con líneas → `'checkout'` como siempre; sin nada, Enter no hace nada y `/COBRAR` sigue mostrando el motivo.
  - `collection-controller.test.ts` (con `fake-indexeddb/auto` y un cliente adjunto):
    - `enterCollection()` deja los cinco buffers vacíos y sin error.
    - `moveCollectionField('cash', 1) === 'debit'`, `('qr', 1) === undefined`, `('cash', -1) === undefined`.
    - `collectionTotalPreview()` suma lo válido e ignora texto inválido; `collectionBalancePreview()` con saldo 1500 y 1000 tipeado → `{ before: 1500, after: 500 }`.
    - `submitCollection()` sin montos → `collectionErrorSignal` "Ingresá al menos un monto."; con texto inválido → "Uno de los pagos tiene un monto inválido."; ninguna escritura.
    - `submitCollection()` con 500 en efectivo → pasa a `'receipt'`, `receiptCollectionSignal` con `payment.receipt.number === 1`, `customerName`, `balanceAfter`; el cliente queda desadjuntado; `customerBalancesSignal` actualizado; buffers reseteados.
    - `cancelCollection()` vuelve a `'sale'` sin escribir nada y con el cliente todavía adjunto.
  - `collection-screen.test.tsx`: título "Cobranza a Ana"; cinco campos (no hay "Cuenta corriente"); el primero con foco; "Saldo actual: Debe $ 1.500,00" y, al tipear 1000, "Después: Debe $ 500,00"; "Total de la cobranza" en vivo; cliente bloqueado → advertencia "Bloqueado: …"; Enter/↓ pasan de campo; Ctrl+Enter confirma; Esc cancela; botones "Cancelar (Esc)" y "Confirmar cobranza (Ctrl+Enter)" hacen lo mismo.
  - `checkout-screen.test.tsx` existente sigue en verde con `PaymentFields`.
- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/ui/keyboard/command-bar-controller.test.ts src/ui/keyboard/collection-controller.test.ts src/ui/screens/collection-screen.test.tsx`
- [ ] **Step 3: implementar**
  - `PaymentFields`: mover el `TENDERABLE_METHODS.map(...)` de `CheckoutScreen` con su marcado (label, input, `isInvalid`, `opacity` para deshabilitado, ref del primero y del mapa). `CheckoutScreen` lo usa con `methods={TENDERABLE_METHODS}` e `isDisabled={(m) => m === 'account' && !hasCustomer}`.
  - `command-bar-controller.ts`:
    ```typescript
    export async function triggerCheckout(): Promise<void> {
      await pendingBarOperation;
      const availability = commandAvailability('COBRAR');
      if (!availability.enabled) {
        commandBarErrorSignal.value = disabledCommandMessage('COBRAR', availability.reason);
        return;
      }
      // Sin artículos y con cliente (#101): cobranza sin venta.
      if (cartSignal.value.lines.length === 0 && attachedCustomerSignal.value !== undefined) {
        enterCollection();
        activeScreenSignal.value = 'collection';
        clearBuffer();
        return;
      }
      enterCheckout();
      activeScreenSignal.value = 'checkout';
      clearBuffer();
    }
    ```
    `submitEmptyCommandBar`: con líneas o con cliente → `triggerCheckout()`; si no, nada. JSDoc actualizado.
  - `collection-controller.ts`:
    ```typescript
    function parsedSafe(): Record<CollectionMethod, number> {
      const buffers = collectionBuffersSignal.value;
      const parsed = {} as Record<CollectionMethod, number>;
      for (const method of COLLECTION_METHODS) {
        parsed[method] = parseNonNegativeAmount(buffers[method]) ?? 0;
      }
      return parsed;
    }

    export function collectionTotalPreview(): number {
      const parsed = parsedSafe();
      return roundAmount(COLLECTION_METHODS.reduce((sum, method) => sum + parsed[method], 0));
    }

    export function collectionBalancePreview(): { before: number | undefined; after: number } {
      const customer = attachedCustomerSignal.value;
      const before = customer !== undefined ? customerBalancesSignal.value.get(customer.id) : undefined;
      return { before, after: applyBalanceDelta(before, -collectionTotalPreview()) };
    }

    export async function submitCollection(): Promise<void> {
      const customer = attachedCustomerSignal.value;
      if (customer === undefined) {
        // Invariante: no se llega a esta pantalla sin cliente.
        cancelCollection();
        return;
      }
      const parsed = parsedOrError(); // mismo criterio que checkout: índice del primer inválido
      if (!parsed.ok) {
        collectionErrorSignal.value = describeError(parsed);
        return;
      }
      const payments = resolveCollection(parsed.value);
      if (!payments.ok) {
        collectionErrorSignal.value = describeError(payments);
        return;
      }
      const result = await collectAndPersist({ customerId: customer.id, payments: payments.value });
      if (!result.ok) {
        collectionErrorSignal.value = describeError(result);
        return;
      }
      await refreshCustomerBalances();
      receiptCollectionSignal.value = { ...result.value, customerName: customer.name };
      resetAttachedCustomer();
      resetCollection();
      activeScreenSignal.value = 'receipt';
    }
    ```
    (`parsedOrError` devuelve `err('sale/invalid-payment-amount', { index })` como `checkout-controller.ts`; `enterCollection` = `resetCollection()`; `cancelCollection` = `resetCollection()` + `activeScreenSignal.value = 'sale'`; `moveCollectionField` recorre `COLLECTION_METHODS` sin ciclar.)
  - `collection-screen.tsx`: mismo `overlayStyle`/`dialogStyle` que Cobro (copiarlos o moverlos a un módulo compartido `ui/screens/dialog-styles.ts` si queda más limpio); `<h1>Cobranza a {customer.name}</h1>`; advertencia ámbar si `customer.blocked`; `PaymentFields` con `COLLECTION_METHODS`; columna derecha con "Total de la cobranza" (`collectionTotalPreview()`), "Saldo actual" (`formatBalance(before)`) y "Después" (`formatBalance(after)`); slot de error de alto fijo; texto de ayuda "Enter o ↓ pasa al campo siguiente, ↑ al anterior. Ctrl+Enter confirma, Esc cancela. Sin vuelto: lo que se ingresa es lo que se acredita."; botones `.btn` "Cancelar (Esc)" y `.btn-primary` "Confirmar cobranza (Ctrl+Enter)"; `onMouseDown={keepFocusOnMouseDown}`; `useFocusOnMount` para el primer campo; `useSignalEffect` que selecciona el campo activo ante un error, como Cobro.
  - `app.tsx`: `case 'collection': return <CollectionScreen />;`.
  - `receipt.ts`: `receiptCollectionSignal` y `CollectionReceipt` (la pantalla lo usa en Task 10; en esta tarea el comprobante todavía no lo muestra, pero `ReceiptScreen` no debe redirigir a la venta si `receiptCollectionSignal` está puesto — ajustar la guarda de `sale === null` para mirar los dos).
- [ ] **Step 4: correr** `pnpm test -- src/ui` → PASS; `pnpm typecheck`, `pnpm lint` → PASS.
- [ ] **Step 5: commit** `feat(ui): cobranza sin venta con Enter, /COBRAR o Ctrl+Enter sin artículos y con cliente (#101)`

---

### Task 10: Comprobante de la cobranza

**Files:**
- Modify: `src/ui/screens/receipt-screen.tsx` (+ test), `src/ui/format-ticket.ts` (+ test), `src/ui/state/receipt.ts`

**Interfaces:**
- Consumes: `receiptCollectionSignal`, `CollectionReceipt` (Task 9); `formatBalance` (Task 8).
- Produces (`format-ticket.ts`): `receiptLabel(payment: Pick<CustomerPayment, 'receipt'>): string` → `'Recibo #3'` / `'Recibo'`.

- [ ] **Step 1: tests que fallan**
  - `format-ticket.test.ts`: `receiptLabel({ receipt: { date: '2026-09-27', number: 3 } })` → `'Recibo #3'`; sin `receipt` → `'Recibo'`.
  - `receipt-screen.test.tsx`: con `receiptCollectionSignal` puesto → "Recibo de cobranza", "Recibo #3", el nombre del cliente, una fila por medio ("Efectivo $ 500,00", "Transferencia $ 200,00"), "Total $ 700,00", "Saldo anterior: Debe $ 1.500,00" y "Saldo nuevo: Debe $ 800,00" (sin saldo previo: "Saldo anterior: Sin saldo"); Enter imprime (`window.print`); Esc vuelve a la venta y limpia `receiptCollectionSignal`; el comprobante de venta sigue igual.
- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/ui/format-ticket.test.ts src/ui/screens/receipt-screen.test.tsx`
- [ ] **Step 3: implementar**
  - `receiptLabel` junto a `ticketLabel`.
  - `ReceiptScreen`: `continueToSale` limpia los dos signals. Con `receiptSaleSignal` en `null` y `receiptCollectionSignal` puesto, el recuadro `.receipt` muestra `CollectionReceiptBody` (componente en el mismo archivo): `<h1>Recibo de cobranza</h1>`, `receiptLabel(payment)`, fecha y hora (`new Date(payment.createdAt).toLocaleString()`, como la venta), el cliente, las filas por medio con `PAYMENT_METHOD_LABELS`, "Total" en negrita, y "Saldo anterior"/"Saldo nuevo" con `formatBalance`. Mismo contenedor, teclas y botones que el de venta (se extrae el contenedor a un componente si evita duplicar el `handleKeyDown`).
- [ ] **Step 4: correr** `pnpm test -- src/ui` → PASS.
- [ ] **Step 5: commit** `feat(ui): comprobante de la cobranza con recibo del día y saldo anterior y nuevo (#101)`

---

### Task 11: `/RESUMEN` con cobranzas

**Files:**
- Modify: `src/ui/screens/cash-summary-screen.tsx` (+ test)

**Interfaces:**
- Consumes: `DayView.collections`, `DayView.customerNames`, `DaySummary.collections`, `collectionsByMethod`, `cash.collections`, `DayEntry` `collection` (Task 6); `receiptLabel` (Task 10).

- [ ] **Step 1: tests que fallan** (`cash-summary-screen.test.tsx`, con un `DayView` armado a mano):
  - Panel lateral: "Cobranzas" con "$ 800,00" y "(2 recibos)"; en Efectivo, la fila "Cobranzas" con "$ 500,00"; "Total vendido" sin las cobranzas.
  - Movimientos: la cobranza se ve como "Recibo #3 · Ana" con su monto y, debajo, "Efectivo $ 500,00 · Transferencia $ 200,00"; buscar "3", "#3" o "ana" la encuentra.
  - Medios de pago: encabezados "Ventas", "Cobranzas", "Total"; Efectivo con 1000 / 500 / 1500.
- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/ui/screens/cash-summary-screen.test.tsx`
- [ ] **Step 3: implementar**
  - `entryKey`: `case 'collection': return \`p:${entry.payment.id}\`;`.
  - `entrySearchText` (la función que alimenta `filterEntries`) para `collection`: `` `${n} #${n} recibo cobranza ${customerName}` `` con `n = entry.payment.receipt?.number`, y el `customerName` de `view.customerNames` (pasar `view` o el mapa a `filterEntries`).
  - `CollectionEntryRow` (componente propio, mismo patrón que `SaleEntryRow` por el ref de `nav`): hora (`formatTime`), `` `${receiptLabel(payment)} · ${customerName}` `` resaltado con `highlightMatches`, el total en `--font-mono` y una línea secundaria con los medios.
  - `PaymentsTab` recibe `totalsByMethod` y `collectionsByMethod`; tres columnas numéricas, "Total" = suma de las dos.
  - `Sidebar`: tarjeta "Cobranzas" después de "Otros pagos" con `formatMoney(summary.collections.total)` y `(N recibos)` en gris si `count > 0`; fila "Cobranzas" en la tarjeta Efectivo, después de "Cobros".
  - JSDoc de la pantalla: Movimientos incluye cobranzas.
- [ ] **Step 4: correr** `pnpm test -- src/ui` → PASS; `pnpm typecheck`, `pnpm lint` → PASS.
- [ ] **Step 5: commit** `feat(ui): /RESUMEN muestra cobranzas en el panel, en Movimientos y por medio de pago (#101)`

---

### Task 12: Contrato 4.2.0 en el POS y OpenAPI

**Files:**
- Modify: `src/domain/contract-version.ts` (+ test), `src/ui/components/StatusBar.test.tsx` y `src/ui/errors.test.ts` (si fijan "4.1"), `docs/connector-api.openapi.yaml`

**Interfaces:**
- Produces: `POS_CONTRACT_VERSION = '4.2.0'`.

- [ ] **Step 1: tests que fallan**
  - `contract-version.test.ts`: `isCompatibleContract('4.1.0')` → `false`; `('4.2.0')` y `('4.3.1')` → `true`; `contractRequirement(POS_CONTRACT_VERSION)` → `'4.2 o posterior'`.
  - Barra de estado con backend 4.1.0 → "Backend incompatible (contrato 4.1.0, se necesita 4.2 o posterior)".
- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/domain/contract-version.test.ts src/ui`
- [ ] **Step 3: implementar**
  - `contract-version.ts`: `'4.2.0'` con JSDoc "4.2.0 desde la Etapa 6 — #101: `CustomerPayment.receipt` y saldo sin cuenta corriente".
  - OpenAPI:
    - `info.version: 4.2.0` y un párrafo "Cambios respecto de 4.1.0": `CustomerPayment.receipt` (opcional, aditivo); `balance` de un cliente es su saldo tenga o no crédito (un `balance` solo es válido); el backend mueve el saldo de cualquier cliente con cobranzas, ventas a cuenta y acreditaciones; se elimina `GET /account-balance/{customerId}` (nunca implementado; el saldo viaja en el pull); un backend 4.1 se ve incompatible porque podría no llevar el saldo de clientes sin crédito ni guardar el recibo.
    - En `CustomerPayment`:
      ```yaml
      receipt:
        type: object
        description: >-
          Número de recibo en su día (4.2.0). `date` es la fecha local de la terminal con la que se
          numeró; el número arranca en 1 cada día, independiente del de tickets. Una cobranza
          anterior a 4.2.0 no lo trae.
        required: [date, number]
        properties:
          date: { type: string, format: date, example: '2026-09-27' }
          number: { type: integer, minimum: 1, example: 3 }
      ```
    - En el cliente del pull, `balance` con descripción: "Saldo del cliente, tenga o no cuenta corriente (4.2.0): positivo debe, negativo a favor. Sin `creditLimit`/`margin` es un saldo sin crédito. Un backend que no lleva saldo lo omite y el POS conserva el local."; y en `creditLimit` aclarar que la cuenta corriente necesita `creditLimit`, `margin` y `balance`, o `unrestricted`.
    - Borrar el path `/account-balance/{customerId}` y cualquier referencia a él.
    - Actualizar las menciones a "4.1.0" que describen la versión vigente (no las que cuentan la historia).
- [ ] **Step 4: correr** `pnpm test` → PASS; `pnpm dlx @redocly/cli lint docs/connector-api.openapi.yaml` sin errores nuevos.
- [ ] **Step 5: commit** `feat(sync): contrato 4.2.0 — recibo de cobranza y saldo sin cuenta corriente (#101)`

---

### Task 13: Google Sheets — puente 4.2.0 con recibo y saldo

**Files:**
- Modify: `src/connectors/google-sheets/bridge.gs`, `src/connectors/google-sheets/columnas.gs`, `src/connectors/google-sheets/bridge.test.ts`, `src/connectors/google-sheets/google-sheets-connector.test.ts` (si fija la forma del cliente), `src/connectors/google-sheets/README.md`

- [ ] **Step 1: tests que fallan** (`bridge.test.ts`, con la planilla falsa):
  - `info` → `contractVersion: '4.2.0'`.
  - Un `pushBatch` con una cobranza con `receipt: { date: '2026-09-27', number: 3 }` escribe "Fecha del recibo" = `2026-09-27` y "N° de recibo" = 3 en cada fila de Cobranzas; sin `receipt`, vacías.
  - Una planilla sin esas columnas las gana al final con `ensureColumns`.
  - `pullBatch` devuelve `balance` por cliente = suma de `monto` de sus filas en `CuentaCorriente` (una venta a cuenta de 1000 y una cobranza de 300 → 700), 0 para un cliente sin movimientos; y después de una cobranza el cliente vuelve a venir en un delta (cambió el fingerprint).
- [ ] **Step 2: correr y ver que fallan** — `pnpm test -- src/connectors/google-sheets`
- [ ] **Step 3: implementar**
  - `bridge.gs`: `CONTRACT_VERSION = '4.2.0'`; en `Cobranzas`, después de `totalCobranza`:
    ```javascript
    // 4.2.0 (#101): número del recibo en su día. Texto a propósito, como la fecha del ticket.
    ['fechaRecibo', 'text', true],
    ['numeroRecibo', 'integer', true],
    ```
    `pushCustomerPayment`: `fechaRecibo: payment.receipt ? payment.receipt.date : undefined, numeroRecibo: payment.receipt ? payment.receipt.number : undefined,`.
    Saldo:
    ```javascript
    /** Saldo por cliente (4.2.0, #101): la suma del libro CuentaCorriente, tenga o no crédito. */
    function customerBalances() {
      var totals = {};
      readRows('CuentaCorriente').forEach(function (row) {
        if (row.customerId === '') {
          return;
        }
        var id = String(row.customerId);
        totals[id] = (totals[id] || 0) + Number(row.monto || 0);
      });
      return totals;
    }
    ```
    `pullCustomers` calcula `var balances = customerBalances();` una vez y suma `balance: Math.round((balances[String(row.id)] || 0) * 100) / 100` a cada cliente (antes de `compact`, que no debe descartar el 0 — verificar su criterio y, si descarta falsy, pasar el saldo fuera de `compact`).
  - `columnas.gs`: `fechaRecibo: 'Fecha del recibo', numeroRecibo: 'N° de recibo',` en Cobranzas.
  - README: sección "Contrato 4.2.0 (#101)": redesplegar el puente (un POS 4.2 ve incompatible a un puente 4.1), las dos columnas nuevas se agregan solas, el saldo de cada cliente sale de `CuentaCorriente`.
- [ ] **Step 4: correr** `pnpm test -- src/connectors` → PASS.
- [ ] **Step 5: commit** `feat(sheets): puente 4.2.0 con número de recibo y saldo por cliente desde CuentaCorriente (#101)`

---

### Task 14: Minibackend 4.2.0

**Files:**
- Modify: `demo-backend/src/settings.ts`, `demo-backend/src/lots.ts`, `demo-backend/src/routes/panel.ts`, `demo-backend/src/panel.html`, tests en `demo-backend/test/` (info, sync/lots, panel) y los que manden el header con `'4.1.0'`

- [ ] **Step 1: tests que fallan**
  - `GET /info` → `contractVersion: '4.2.0'`.
  - Una cobranza de 300 de un cliente **sin** cuenta → al procesar el lote, el pull trae ese cliente con `balance: -300` (y sin `creditLimit`); una segunda cobranza con el mismo id no mueve el saldo.
  - Una venta con pago `account` negativo (acreditación) de un cliente sin cuenta → `balance` negativo.
  - `GET /_demo/api/customer-payments` devuelve la cobranza con `receipt`.
  - Un push con `X-POS-Contract-Version: 4.1.0` → 409 con `contractVersion: '4.2.0'`.
- [ ] **Step 2: correr y ver que fallan** — `pnpm test:backend`
- [ ] **Step 3: implementar**
  - `settings.ts`: `CONTRACT_VERSION = '4.2.0'` (JSDoc con #101).
  - `lots.ts::adjustBalance`: `const current = customer.balance ?? 0;` en vez de salir; el JSDoc dice que el saldo se lleva para cualquier cliente (4.2.0) y que un cliente sin saldo empieza a viajar con `balance` desde su primer movimiento. Verificar que la actualización cambie `updated_at` (ya lo hace) para que el cliente viaje en el próximo delta.
  - `panel.ts`/`panel.html`: columna "recibo" en la tabla de cobranzas (`${p.receipt ? \`#${p.receipt.number} · ${p.receipt.date.slice(8, 10)}/${p.receipt.date.slice(5, 7)}\` : ''}`); la lista de clientes muestra el saldo de todos los que lo tienen (la de cuentas sigue filtrando por crédito para "disponible").
- [ ] **Step 4: correr** `pnpm test:backend` y `pnpm typecheck:backend` → PASS.
- [ ] **Step 5: commit** `feat(demo-backend): contrato 4.2.0, saldo de cualquier cliente y recibo en el panel (#101)`

---

### Task 15: Mini-erp 4.2.0

**Files:**
- Modify: `mini-erp/src/server/routes/connector-routes.ts`, `mini-erp/test/connector-api.test.ts`, `mini-erp/test/e2e-pos-sync-lifecycle.test.ts` y los tests que mandan `'4.1.0'`, `mini-erp/PLAN.md`, `mini-erp/AGENTS.md`, `mini-erp/src/server/app.ts` (comentario)

- [ ] **Step 1: tests que fallan** (`connector-api.test.ts`):
  - `GET /info` → `contractVersion: '4.2.0'`; los requests mandan `X-POS-Contract-Version: 4.2.0`.
  - Un push con una cobranza con `receipt: { date: '2026-09-27', number: 3 }` de un cliente sin crédito → `customer_payments.payload` contiene el `receipt`; el cliente queda con `balance` −total, y el pull siguiente lo trae con ese `balance` y sin `creditLimit`.
- [ ] **Step 2: correr y ver que fallan** — `pnpm --dir mini-erp test`
- [ ] **Step 3: implementar**
  - `connector-routes.ts`: `CONTRACT_VERSION = '4.2.0'`.
  - Si el pull omite `balance` de un cliente con `balance` en 0 o `NULL`, dejarlo como está (el POS conserva el local); el test solo exige el caso con movimientos.
  - Docs: "Connector API 4.1.0" → "4.2.0" en `PLAN.md`, `AGENTS.md`, el comentario de `app.ts`; en `AGENTS.md`, que la cobranza trae `receipt` y todavía no se valida con Zod (#122).
- [ ] **Step 4: correr** `pnpm --dir mini-erp typecheck`, `pnpm --dir mini-erp lint`, `pnpm --dir mini-erp test` → PASS.
- [ ] **Step 5: commit** `feat(mini-erp): contrato 4.2.0 con el recibo de la cobranza (#101)`

---

### Task 16: E2E

**Files:**
- Create: `e2e/collection.spec.ts`
- Modify: `e2e/keyboard-only.spec.ts`, `e2e/mouse.spec.ts`, `e2e/minibackend-sync.spec.ts`, `e2e/account-sale.spec.ts` (ya adaptado en Task 2, verificar)

- [ ] **Step 1: escribir** `collection.spec.ts` (con `test`/`expect` de `./fixtures.ts`, offline después de cargar):
  - Adjuntar un cliente nuevo (`@Ana Gómez` + Enter): la tarjeta muestra "Saldo: Sin saldo".
  - Enter con la barra vacía → "Cobranza a Ana Gómez", sin campo "Cuenta corriente"; Ctrl+Enter sin montos → "Ingresá al menos un monto."
  - Efectivo 500, ↓, Tarjeta de Débito 200 → "Total de la cobranza $ 700,00" y "Después: A favor $ 700,00"; Ctrl+Enter.
  - Comprobante: "Recibo #1", "Saldo anterior: Sin saldo", "Saldo nuevo: A favor $ 700,00"; Esc → venta con "Consumidor Final".
  - `@Ana` + Enter → la tarjeta muestra "Saldo: A favor $ 700,00".
  - Segunda cobranza de 100 → "Recibo #2".
  - IndexedDB: dos eventos `customer-payment` pendientes con `payment.receipt.number` 1 y 2 y `origin`; `customerBalances` de Ana en −800.
  - `/CAJA` → el esperado del arqueo incluye los 600 en efectivo.
  - `/RESUMEN` → Movimientos con "Recibo #1 · Ana Gómez" y "Recibo #2 · Ana Gómez"; panel "Cobranzas $ 800,00 (2 recibos)".
  - `/COBRAR` con cliente y sin artículos también abre la cobranza; Esc vuelve con el cliente adjunto.
- [ ] **Step 2: ajustar** `keyboard-only.spec.ts` (la cobranza de punta a punta sin mouse; la barra de comandos recupera el foco al volver), `mouse.spec.ts` (click en un campo lo enfoca; "Confirmar cobranza (Ctrl+Enter)" y "Cancelar (Esc)"), `minibackend-sync.spec.ts` (una cobranza llega a `/_demo/api/customer-payments` con `receipt.number` y, después del pull, la tarjeta del cliente muestra el saldo del backend).
- [ ] **Step 3: correr** `pnpm build` y `pnpm test:e2e` → PASS; `collection.spec.ts` también con `--repeat-each=3`.
- [ ] **Step 4: commit** `test(e2e): cobranza sin venta, recibo del día y saldo del cliente (#101)`

---

### Task 17: Documentación, issues, PR y prueba manual

**Files:**
- Modify: `CLAUDE.md`, `README.md` (si describe Enter con la barra vacía o la cuenta corriente), `docs/superpowers/specs/2026-09-27-cobranza-y-saldo-del-cliente-design.md` (estado: implementado; desvíos de este plan)

- [ ] **Step 1: CLAUDE.md**:
  - "Modelo de dominio": `CustomerBalance` (saldo, aparte del crédito), `CustomerPayment`.
  - "Patrón outbox": limpieza con cobranzas y la regla unificada de movimientos de cuenta; saldos en `customerBalances` en el pull (regla de la Etapa 3); "Cuenta corriente (Fase 3)": `canChargeOffline` con el saldo aparte, un saldo a favor no habilita fiado.
  - "Connector API": contrato 4.2.0 (recibo, `balance` sin crédito, `GET /account-balance` eliminado; puente, minibackend y mini-erp en 4.2.0).
  - "UX keyboard-first": Enter con la barra vacía, `/COBRAR` y Ctrl+Enter abren la cobranza sin artículos y con cliente; sección nueva "Cobranza sin venta y saldo del cliente" (pantalla, comprobante con "Recibo #N", fila Saldo, saldo en Cobro, saldos en memoria); `/RESUMEN` con cobranzas; saldo de efectivo con cobranzas.
  - "Teclado y mouse": la pantalla de cobranza.
  - "Estado del proyecto": entrada de la Etapa 6 con los desvíos del plan y #125 como siguiente paso.
- [ ] **Step 2: verificación completa**: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm test:backend`, `pnpm typecheck:backend`, `pnpm --dir mini-erp typecheck`, `pnpm --dir mini-erp lint`, `pnpm --dir mini-erp test`, `pnpm test:e2e` → todo verde.
- [ ] **Step 3: commit** `docs: CLAUDE.md y spec para la Etapa 6 (#101)`
- [ ] **Step 4: issues** (el usuario nunca edita issues a mano): comentar #101 (qué quedó y los desvíos) y #94 (Etapa 6 lista para tildar al mergear); mencionar #125 y #122 donde corresponda.
- [ ] **Step 5: PR** de la etapa contra `main` (merge commit normal, no squash), con resumen, desvíos y pasos de prueba; terminar con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 6: prueba manual**: levantar el minibackend y la app (`pnpm dev`) y armar las instrucciones paso a paso:
  1. configurar la terminal contra `rest-demo`;
  2. adjuntar un cliente con cuenta y ver su saldo en la tarjeta;
  3. cobranza parcial en dos medios y ver el recibo;
  4. ver el saldo nuevo en la tarjeta y en `/_demo` después del sync;
  5. cobranza de un cliente sin cuenta y ver que queda a favor, también en el panel;
  6. venta con cuenta corriente y ver "Saldo: … → …" en Cobro;
  7. `/CAJA` con el esperado que incluye las cobranzas en efectivo;
  8. `/RESUMEN`: panel, Movimientos y Medios de pago;
  9. repetir una cobranza offline y ver el recibo numerado y el saldo al volver la red.
