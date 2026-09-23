# Contrato del Connector API v3 — Plan de implementación (Etapa 1 de #94, #96)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Llevar el contrato del Connector API a v3 (sobre por evento con identidad, estados de lote
`queued`/`processing`/`ok`/`issues` con avisos `{ message, eventId? }`, eventos `cash-movement` y
`customer-payment`, `cash-session` eliminado, bloqueos y `createdAt` en el pull) e implementarlo en el
POS, los conectores `rest`/`rest-demo` y Google Sheets, y el minibackend de demo con su panel.

**Architecture:** El dominio suma los tipos nuevos y el `origin` estampado en cada `OutboxEvent`; el
puerto `Connector` (`sync/connector.ts`) concentra los schemas Zod de red compartidos por los dos
conectores TS; el motor arma el sobre y manda el `deviceId`. El minibackend separa recepción de
procesamiento de un lote para poder demorarlo desde el panel. El puente de Sheets agrega pestañas y
columnas nuevas y se auto-actualiza sobre planillas existentes (`ensureColumns`).

**Tech Stack:** TypeScript estricto, Preact + signals, Dexie, Zod, Vitest, Playwright; minibackend en
Node (`node:sqlite`, `node:http`); Apps Script (`bridge.gs`/`columnas.gs`) probado en Vitest con
`src/test/fake-spreadsheet.ts`.

**Spec:** `docs/superpowers/specs/2026-09-23-contrato-connector-api-v3-design.md`

## Global Constraints

- `any` prohibido; `unknown` solo en el borde y validado con Zod en la línea siguiente (CLAUDE.md).
- Funciones de negocio devuelven `Result<T>`, nunca lanzan; `try/catch` solo en adaptadores.
- `exactOptionalPropertyTypes`: un opcional ausente se omite con spread condicional, nunca `undefined`
  explícito.
- Versión del contrato: `3.0.0`.
- `deviceId`, `origin.branch`, `origin.pointOfSale`: obligatorios en el contrato, **tolerados ausentes
  hasta la Etapa 2 (#97)**. El POS solo manda `origin.branch`/`origin.pointOfSale` si están cargados.
- Clave de `localStorage` del id de dispositivo: `offline-pos:device-id`.
- `LotIssue = { message: string; eventId?: string }`. Un lote pedido y no informado = `processing`.
- Motor en esta etapa: `queued` y `processing` descartan el pull entero (igual que el `pending` de hoy).
- `CashMovement.amount > 0`; `count` obligatorio si `source === 'count-adjustment'`; concepto fijo
  `'Ajuste por arqueo'`; un arqueo con diferencia 0 no genera evento.
- `CustomerPayment.payments`: `method !== 'account'`, `amount > 0`; `total` = suma.
- Cobranzas y movimientos de caja no se anulan.
- `blocked?: { reason: string }` (ausente = no bloqueado). `createdAt` obligatorio en el pull de
  productos y clientes.
- Sheets: toda columna nueva lleva clave + tipo en `SCHEMA` (`bridge.gs`) y etiqueta en español en
  `COLUMN_LABELS` (`columnas.gs`); valores enumerados en `VALUE_LABELS`. La lógica usa solo claves.
- Comandos de verificación: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:backend`,
  `pnpm typecheck:backend`, `pnpm build`, `pnpm test:e2e`. No se espera ni se lee el CI.
- Cada commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/domain/event-origin.ts` (nuevo) | `EventOrigin` y cómo se arma desde la config. |
| `src/domain/cash-movement.ts` (nuevo) | `CashMovement`, `buildCountAdjustment`. |
| `src/domain/customer-payment.ts` (nuevo) | `CustomerPayment`, `buildCustomerPayment`. |
| `src/domain/outbox.ts` | Payloads v3, `origin` en `OutboxEvent`, builders nuevos, sin `cash-session`. |
| `src/domain/product.ts`, `src/domain/customer.ts` | `createdAt?`/`blocked?`; `splitConnectorCustomer` usa `createdAt` real. |
| `src/sync/connector.ts` | Puerto v3 + schemas Zod de red compartidos. |
| `src/sync/terminal-identity.ts` (nuevo) | `getDeviceId()`, `currentEventOrigin()`. |
| `src/sync/config.ts` | `branch?`/`pointOfSale?` de terminal. |
| `src/sync/push-lot.ts` | `AwaitingLot.lastStatus`, `updateAwaitingLots`. |
| `src/sync/engine.ts`, `src/sync/pull-snapshot.ts` | Sobre, `deviceId`, estados v3. |
| `src/storage/*-repository.ts`, `src/storage/local-data.ts` | Estampado de `origin`; exclusión de `cash-session` legado. |
| `src/ui/…` | Campos de terminal en `/CONFIG`; issues y estados en `/DIAGNOSTICO`; `pos.deviceId()`. |
| `src/connectors/rest/rest-fetch-connector.ts` | Bodies v3, schemas compartidos. |
| `src/connectors/google-sheets/*.ts` | Bodies v3, schemas del puente. |
| `src/connectors/google-sheets/bridge.gs`, `columnas.gs`, `README.md` | Puente v3. |
| `src/test/fake-spreadsheet.ts` | `insertColumnsAfter`. |
| `demo-backend/src/db.ts`, `lots.ts` (nuevo), `routes/sync.ts`, `routes/panel.ts`, `panel.html`, `seed.ts`, `fixtures/*.json` | Minibackend v3. |
| `docs/connector-api.openapi.yaml`, `CLAUDE.md` | Documentación. |

---

### Task 1: Tipos de dominio nuevos (origen, movimiento de caja, cobranza)

**Files:**
- Create: `src/domain/event-origin.ts`, `src/domain/cash-movement.ts`, `src/domain/customer-payment.ts`
- Test: `src/domain/cash-movement.test.ts`, `src/domain/customer-payment.test.ts`, `src/domain/event-origin.test.ts`

**Interfaces:**
- Produces:
  - `type EventOrigin = { branch?: string; pointOfSale?: string }`
  - `buildEventOrigin(params: { branch?: string | undefined; pointOfSale?: string | undefined }): EventOrigin` (descarta vacíos/solo espacios, recorta)
  - `type CashMovement = { id: string; direction: 'in' | 'out'; amount: number; concept: string; description?: string; source: 'manual' | 'count-adjustment'; count?: { expected: number; counted: number }; createdAt: string }`
  - `COUNT_ADJUSTMENT_CONCEPT = 'Ajuste por arqueo'`
  - `buildCountAdjustment(params: { id: string; expected: number; counted: number; now: string }): CashMovement | undefined`
  - `type CustomerPayment = { id: string; customerId: string; payments: Payment[]; total: number; createdAt: string }`
  - `buildCustomerPayment(params: { id: string; customerId: string; payments: Payment[]; now: string }): Result<CustomerPayment>` — error `'customer-payment/invalid'` con `meta: { reason: 'account-method' | 'non-positive-amount' | 'empty' }`

- [ ] **Step 1: Tests que fallan**

```typescript
// src/domain/event-origin.test.ts
import { describe, expect, it } from 'vitest';
import { buildEventOrigin } from './event-origin.ts';

describe('buildEventOrigin', () => {
  it('recorta y omite lo vacío', () => {
    expect(buildEventOrigin({ branch: '  Centro ', pointOfSale: '   ' })).toEqual({ branch: 'Centro' });
    expect(buildEventOrigin({})).toEqual({});
    expect(buildEventOrigin({ branch: 'A', pointOfSale: 'Caja 1' })).toEqual({ branch: 'A', pointOfSale: 'Caja 1' });
  });
});
```

```typescript
// src/domain/cash-movement.test.ts
import { describe, expect, it } from 'vitest';
import { buildCountAdjustment, COUNT_ADJUSTMENT_CONCEPT } from './cash-movement.ts';

const now = '2026-09-23T10:00:00.000Z';

describe('buildCountAdjustment', () => {
  it('sin diferencia no genera movimiento', () => {
    expect(buildCountAdjustment({ id: 'm1', expected: 1000, counted: 1000, now })).toBeUndefined();
  });
  it('sobrante: ingreso por la diferencia, con lo esperado y lo contado', () => {
    expect(buildCountAdjustment({ id: 'm1', expected: 1000, counted: 1250.5, now })).toEqual({
      id: 'm1',
      direction: 'in',
      amount: 250.5,
      concept: COUNT_ADJUSTMENT_CONCEPT,
      source: 'count-adjustment',
      count: { expected: 1000, counted: 1250.5 },
      createdAt: now,
    });
  });
  it('faltante: egreso por el valor absoluto, redondeado a 2 decimales', () => {
    const movement = buildCountAdjustment({ id: 'm1', expected: 100.1, counted: 100, now });
    expect(movement?.direction).toBe('out');
    expect(movement?.amount).toBe(0.1);
  });
});
```

```typescript
// src/domain/customer-payment.test.ts
import { describe, expect, it } from 'vitest';
import { buildCustomerPayment } from './customer-payment.ts';

const base = { id: 'cp1', customerId: 'c1', now: '2026-09-23T10:00:00.000Z' };

describe('buildCustomerPayment', () => {
  it('suma el total de los pagos', () => {
    const result = buildCustomerPayment({
      ...base,
      payments: [{ method: 'cash', amount: 500 }, { method: 'transfer', amount: 250.25 }],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'cp1',
        customerId: 'c1',
        payments: [{ method: 'cash', amount: 500 }, { method: 'transfer', amount: 250.25 }],
        total: 750.25,
        createdAt: base.now,
      },
    });
  });
  it('rechaza cuenta corriente, montos no positivos y lista vacía', () => {
    expect(buildCustomerPayment({ ...base, payments: [{ method: 'account', amount: 10 }] })).toMatchObject({
      ok: false, error: 'customer-payment/invalid', meta: { reason: 'account-method' },
    });
    expect(buildCustomerPayment({ ...base, payments: [{ method: 'cash', amount: 0 }] })).toMatchObject({
      ok: false, meta: { reason: 'non-positive-amount' },
    });
    expect(buildCustomerPayment({ ...base, payments: [] })).toMatchObject({ ok: false, meta: { reason: 'empty' } });
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `pnpm vitest run src/domain/event-origin.test.ts src/domain/cash-movement.test.ts src/domain/customer-payment.test.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementación**

```typescript
// src/domain/event-origin.ts
/**
 * Sucursal y punto de venta estampados en cada evento del outbox al encolarlo
 * (contrato v3, #96). Se guardan con el evento y nunca se releen de la config
 * al armar un lote: cambiar la sucursal con eventos pendientes no los reescribe.
 * Opcionales hasta la Etapa 2 (#97), que los vuelve obligatorios en /CONFIG.
 */
export type EventOrigin = { branch?: string; pointOfSale?: string };

export function buildEventOrigin(params: {
  branch?: string | undefined;
  pointOfSale?: string | undefined;
}): EventOrigin {
  const branch = params.branch?.trim() ?? '';
  const pointOfSale = params.pointOfSale?.trim() ?? '';
  return {
    ...(branch !== '' ? { branch } : {}),
    ...(pointOfSale !== '' ? { pointOfSale } : {}),
  };
}
```

```typescript
// src/domain/cash-movement.ts
/**
 * Ingreso/egreso de caja (contrato v3, #96 — lo genera la Etapa 5). El arqueo
 * viaja solo como ajuste (`source: 'count-adjustment'`) cuando la diferencia
 * no es 0, con lo esperado y lo contado para auditoría. No se anula: un
 * movimiento mal cargado se compensa con otro (RNF-07).
 */
export type CashMovement = {
  id: string; // ULID
  direction: 'in' | 'out';
  amount: number; // > 0
  concept: string;
  description?: string;
  source: 'manual' | 'count-adjustment';
  count?: { expected: number; counted: number };
  createdAt: string; // ISO 8601
};

export const COUNT_ADJUSTMENT_CONCEPT = 'Ajuste por arqueo';

const roundAmount = (value: number): number => Math.round(value * 100) / 100;

/** `undefined` si lo contado coincide con lo esperado: un arqueo sin diferencia no viaja. */
export function buildCountAdjustment(params: {
  id: string;
  expected: number;
  counted: number;
  now: string;
}): CashMovement | undefined {
  const difference = roundAmount(params.counted - params.expected);
  if (difference === 0) {
    return undefined;
  }
  return {
    id: params.id,
    direction: difference > 0 ? 'in' : 'out',
    amount: Math.abs(difference),
    concept: COUNT_ADJUSTMENT_CONCEPT,
    source: 'count-adjustment',
    count: { expected: params.expected, counted: params.counted },
    createdAt: params.now,
  };
}
```

```typescript
// src/domain/customer-payment.ts
import { err, ok, type Result } from './result.ts';
import type { Payment } from './sale.ts';

/**
 * Cobranza sin venta (contrato v3, #96 — la genera la Etapa 6): un pago a
 * favor de un cliente identificado, tenga o no cuenta corriente. Sin vuelto:
 * lo tendido es lo acreditado. No se anula (RNF-07).
 */
export type CustomerPayment = {
  id: string; // ULID
  customerId: string;
  payments: Payment[];
  total: number;
  createdAt: string; // ISO 8601
};

export function buildCustomerPayment(params: {
  id: string;
  customerId: string;
  payments: Payment[];
  now: string;
}): Result<CustomerPayment> {
  if (params.payments.length === 0) {
    return err('customer-payment/invalid', { reason: 'empty' });
  }
  if (params.payments.some((payment) => payment.method === 'account')) {
    return err('customer-payment/invalid', { reason: 'account-method' });
  }
  if (params.payments.some((payment) => payment.amount <= 0)) {
    return err('customer-payment/invalid', { reason: 'non-positive-amount' });
  }
  const total = Math.round(params.payments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;
  return ok({
    id: params.id,
    customerId: params.customerId,
    payments: params.payments,
    total,
    createdAt: params.now,
  });
}
```

En `src/domain/result.ts`, sumar a `ErrorMeta`:

```typescript
  'customer-payment/invalid': { reason: 'empty' | 'account-method' | 'non-positive-amount' };
```

y en `src/ui/errors.ts`, el `case` correspondiente (el `switch` exhaustivo no compila sin él):

```typescript
    case 'customer-payment/invalid':
      return failure.meta.reason === 'account-method'
        ? 'La cobranza no admite cuenta corriente.'
        : failure.meta.reason === 'empty'
          ? 'Ingresá al menos un monto.'
          : 'Los montos de la cobranza tienen que ser mayores a cero.';
```

(Adaptar el nombre de la variable al que use el `switch` existente de `ui/errors.ts`.)

- [ ] **Step 4: Correr y ver que pasan**

Run: `pnpm vitest run src/domain/event-origin.test.ts src/domain/cash-movement.test.ts src/domain/customer-payment.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/event-origin.ts src/domain/cash-movement.ts src/domain/customer-payment.ts src/domain/*.test.ts src/domain/result.ts src/ui/errors.ts
git commit -m "feat(dominio): origen de evento, movimiento de caja y cobranza (contrato v3, #96)"
```

---

### Task 2: Outbox v3 (sobre con origen, eventos nuevos, sin `cash-session`)

**Files:**
- Modify: `src/domain/outbox.ts`, `src/domain/outbox.test.ts`

**Interfaces:**
- Consumes: `EventOrigin`, `CashMovement`, `CustomerPayment` (Task 1).
- Produces:
  - `OutboxEventPayload` = los 6 tipos de hoy salvo `cash-session`, más `{ type: 'cash-movement'; movement: CashMovement }` y `{ type: 'customer-payment'; payment: CustomerPayment }`.
  - `OutboxEvent = OutboxEventPayload & { id; status; createdAt; origin?: EventOrigin }` — `origin` opcional **solo** porque los eventos encolados antes de v3 no lo tienen.
  - Todos los builders reciben `params.origin: EventOrigin` y lo guardan: `buildOutboxEventForSale(sale, { now, origin })`, `buildOutboxEventsForStockMovements(movements, { now, origin })`, `buildOutboxEventForVoid({ …, origin })`, `buildOutboxEventForCustomer(customer, { now, origin })`, `buildOutboxEventForHoldConfirm({ …, origin })`, `buildOutboxEventForHoldRelease({ …, origin })`.
  - Nuevos: `buildOutboxEventForCashMovement(movement: CashMovement, params: { now: string; origin: EventOrigin }): OutboxEvent` (id = `movement.id`), `buildOutboxEventForCustomerPayment(payment: CustomerPayment, params: { now: string; origin: EventOrigin }): OutboxEvent` (id = `payment.id`).
  - Se elimina `buildOutboxEventForCashSession`.
  - `LEGACY_OUTBOX_TYPES: ReadonlySet<string> = new Set(['cash-session'])` y `isLegacyOutboxType(type: string): boolean`.

- [ ] **Step 1: Tests que fallan** — en `outbox.test.ts`, actualizar los tests existentes para pasar `origin` y agregar:

```typescript
const origin = { branch: 'Centro', pointOfSale: 'Caja 1' };

it('estampa el origen recibido en el evento', () => {
  const event = buildOutboxEventForSale(sale, { now, origin });
  expect(event.origin).toEqual(origin);
});

it('movimiento de caja: el id del evento es el del movimiento', () => {
  const movement = { id: 'm1', direction: 'out', amount: 50, concept: 'Flete', source: 'manual', createdAt: now } as const;
  expect(buildOutboxEventForCashMovement(movement, { now, origin })).toEqual({
    type: 'cash-movement', movement, id: 'm1', status: 'pending', createdAt: now, origin,
  });
});

it('cobranza: el id del evento es el de la cobranza', () => {
  const payment = { id: 'cp1', customerId: 'c1', payments: [{ method: 'cash', amount: 10 }], total: 10, createdAt: now } as const;
  expect(buildOutboxEventForCustomerPayment(payment, { now, origin })).toMatchObject({
    type: 'customer-payment', id: 'cp1', origin,
  });
});

it('cash-session es un tipo legado', () => {
  expect(isLegacyOutboxType('cash-session')).toBe(true);
  expect(isLegacyOutboxType('sale')).toBe(false);
});
```

Borrar el test de `buildOutboxEventForCashSession`.

- [ ] **Step 2: Correr** — `pnpm vitest run src/domain/outbox.test.ts` → FAIL.

- [ ] **Step 3: Implementación** — en `outbox.ts`:

```typescript
import type { CashMovement } from './cash-movement.ts';
import type { Customer } from './customer.ts';
import type { CustomerPayment } from './customer-payment.ts';
import type { EventOrigin } from './event-origin.ts';
import type { Sale } from './sale.ts';
import type { StockMovement } from './stock.ts';

export type OutboxEventPayload =
  | { type: 'sale'; sale: Sale }
  | { type: 'stock-movement'; movement: StockMovement }
  | { type: 'sale-void'; saleId: string; voidedAt: string; voidReason?: string }
  | { type: 'customer'; customer: Customer }
  | { type: 'account-hold-confirm'; holdId: string; saleId: string }
  | { type: 'account-hold-release'; holdId: string }
  | { type: 'cash-movement'; movement: CashMovement }
  | { type: 'customer-payment'; payment: CustomerPayment };

export type OutboxEvent = OutboxEventPayload & {
  id: string;
  status: 'pending' | 'synced';
  createdAt: string;
  /** Estampado al encolar (contrato v3). Ausente solo en eventos encolados antes de v3. */
  origin?: EventOrigin;
};

/**
 * Tipos que el contrato v3 ya no tiene (`cash-session`, sin turnos de caja,
 * epic #94). Un evento así que haya quedado pendiente en una terminal no viaja
 * nunca: `storage/local-data.ts::listPendingOutbox` lo marca como enviado.
 */
export const LEGACY_OUTBOX_TYPES: ReadonlySet<string> = new Set(['cash-session']);

export function isLegacyOutboxType(type: string): boolean {
  return LEGACY_OUTBOX_TYPES.has(type);
}
```

Cada builder existente suma `origin: params.origin` al objeto devuelto y `origin: EventOrigin` a su
`params`. Nuevos:

```typescript
export function buildOutboxEventForCashMovement(
  movement: CashMovement,
  params: { now: string; origin: EventOrigin },
): OutboxEvent {
  return { type: 'cash-movement', movement, id: movement.id, status: 'pending', createdAt: params.now, origin: params.origin };
}

export function buildOutboxEventForCustomerPayment(
  payment: CustomerPayment,
  params: { now: string; origin: EventOrigin },
): OutboxEvent {
  return { type: 'customer-payment', payment, id: payment.id, status: 'pending', createdAt: params.now, origin: params.origin };
}
```

Eliminar `buildOutboxEventForCashSession` y el import de `CashSession`. El proyecto no compila hasta
la Task 4/5 (callers): es esperable; esta task solo corre su test.

- [ ] **Step 4: Correr** — `pnpm vitest run src/domain/outbox.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/outbox.ts src/domain/outbox.test.ts
git commit -m "feat(outbox): origen por evento, cash-movement y customer-payment; se va cash-session (#96)"
```

---

### Task 3: Puerto `Connector` v3, producto/cliente con alta y bloqueo

**Files:**
- Modify: `src/sync/connector.ts`, `src/domain/product.ts`, `src/domain/customer.ts`, `src/domain/customer.test.ts`, `src/test/fake-connector.ts`
- Test: `src/sync/connector.test.ts` (nuevo)

**Interfaces:**
- Produces (en `sync/connector.ts`):
  - `blockedSchema = z.object({ reason: z.string() })`
  - `connectorProductSchema = productSchema.extend({ createdAt: z.string(), blocked: blockedSchema.optional() })`, `type ConnectorProduct`
  - `connectorCustomerSchema` suma `createdAt: z.string()` y `blocked: blockedSchema.optional()`
  - `lotIssueSchema = z.object({ message: z.string(), eventId: z.string().optional() })`, `type LotIssue`
  - `batchLotStatusSchema` (discriminatedUnion por `status`: `queued`, `processing`, `ok`, `issues` con `issues: z.array(lotIssueSchema)`), `type BatchLotStatus`
  - `pullBatchResponseSchema = z.object({ products: pullResult(connectorProductSchema), customers: pullResult(connectorCustomerSchema), stock: z.array(stockItemSchema), lots: z.record(z.string(), batchLotStatusSchema) })`
  - `type OutboxBatchItem = OutboxEventPayload & { id: string; createdAt: string; origin: EventOrigin }`
  - `type PushBatch = { deviceId: string; events: OutboxBatchItem[] }`
  - `type PullBatchParams = { deviceId: string; cursors: { products?: string; customers?: string }; pendingLotIds: string[] }`
  - `type PullBatchResult = { products: ConnectorPullResult<ConnectorProduct>; customers: ConnectorPullResult<ConnectorCustomer>; stock: StockItem[]; lots: Record<string, BatchLotStatus> }`
  - `Connector.pushBatch(batch: PushBatch, idempotencyId: string): Promise<Result<void>>`; `pullBatch(params: PullBatchParams)` sin cambio de nombre.
  - `toPullBatchResult(data: z.infer<typeof pullBatchResponseSchema>): PullBatchResult` — reconstruye `nextCursor` sin `undefined` explícito (hoy esa lógica está inline en `rest-fetch-connector.ts`; se mueve acá para que la usen los dos conectores).
- Domain: `productSchema` suma `createdAt: z.string().optional()` y `blocked: z.object({ reason: z.string() }).optional()`. `Customer` suma `blocked?: { reason: string }`. `splitConnectorCustomer(raw)` pasa a leer `raw.createdAt` (requerido) y `raw.blocked`; el parámetro `params.now` queda solo para `account.updatedAt` por defecto.

- [ ] **Step 1: Tests que fallan**

```typescript
// src/sync/connector.test.ts
import { describe, expect, it } from 'vitest';
import { batchLotStatusSchema, pullBatchResponseSchema, toPullBatchResult } from './connector.ts';

const product = { id: 'p1', sku: 'S', barcodes: [], name: 'N', price: 1, taxRate: 0.21, category: 'c', tracksStock: true, createdAt: '2026-01-01T00:00:00.000Z' };
const customer = { id: 'c1', name: 'Ana', createdAt: '2026-01-02T00:00:00.000Z', blocked: { reason: 'Deuda' } };

describe('schemas de red v3', () => {
  it('acepta los cuatro estados de lote y issues con eventId opcional', () => {
    for (const status of ['queued', 'processing', 'ok'] as const) {
      expect(batchLotStatusSchema.safeParse({ status }).success).toBe(true);
    }
    expect(batchLotStatusSchema.safeParse({ status: 'issues', issues: [{ message: 'x', eventId: 'e1' }, { message: 'y' }] }).success).toBe(true);
    expect(batchLotStatusSchema.safeParse({ status: 'pending' }).success).toBe(false);
    expect(batchLotStatusSchema.safeParse({ status: 'issues', issues: ['texto'] }).success).toBe(false);
  });

  it('exige createdAt en productos y clientes y acepta bloqueo', () => {
    const ok = pullBatchResponseSchema.safeParse({ products: { items: [product] }, customers: { items: [customer] }, stock: [], lots: {} });
    expect(ok.success).toBe(true);
    const { createdAt: _omit, ...withoutDate } = product;
    expect(pullBatchResponseSchema.safeParse({ products: { items: [withoutDate] }, customers: { items: [] }, stock: [], lots: {} }).success).toBe(false);
  });

  it('toPullBatchResult omite nextCursor ausente', () => {
    const parsed = pullBatchResponseSchema.parse({ products: { items: [], nextCursor: 'c9' }, customers: { items: [] }, stock: [{ productId: 'p1', quantity: -1.5, updatedAt: 'x' }], lots: {} });
    const result = toPullBatchResult(parsed);
    expect(result.products).toEqual({ items: [], nextCursor: 'c9' });
    expect('nextCursor' in result.customers).toBe(false);
  });
});
```

En `customer.test.ts`, agregar:

```typescript
it('usa la fecha de alta real del backend y conserva el bloqueo', () => {
  const { customer } = splitConnectorCustomer(
    { id: 'c1', name: 'Ana', createdAt: '2025-03-01T12:00:00.000Z', blocked: { reason: 'Deuda vencida' } },
    { now: '2026-09-23T10:00:00.000Z' },
  );
  expect(customer).toEqual({ id: 'c1', name: 'Ana', createdAt: '2025-03-01T12:00:00.000Z', blocked: { reason: 'Deuda vencida' } });
});
```

y ajustar los tests existentes de `splitConnectorCustomer` para pasar `createdAt` en `raw`.

- [ ] **Step 2: Correr** — `pnpm vitest run src/sync/connector.test.ts src/domain/customer.test.ts` → FAIL.

- [ ] **Step 3: Implementación**

`src/domain/product.ts`:

```typescript
export const productSchema = z.object({
  id: z.string(),
  sku: z.string(),
  barcodes: z.array(z.string()),
  name: z.string(),
  price: z.number().nonnegative(),
  taxRate: z.number().min(0).max(1),
  category: z.string(),
  tracksStock: z.boolean(),
  // Contrato v3 (#96): fecha de alta real y bloqueo informativo (se muestra desde la Etapa 4).
  // Opcionales acá porque el fixture local de catálogo no los trae; el pull los exige.
  createdAt: z.string().optional(),
  blocked: z.object({ reason: z.string() }).optional(),
});
```

`src/domain/customer.ts`: `Customer` suma `blocked?: { reason: string };` con comentario (bloqueo
informativo del backend, nunca impide operar, se muestra desde la Etapa 4). `splitConnectorCustomer`:

```typescript
  raw: {
    id: string;
    name: string;
    createdAt: string;
    document?: string | undefined;
    phone?: string | undefined;
    creditLimit?: number | undefined;
    margin?: number | undefined;
    balance?: number | undefined;
    updatedAt?: string | undefined;
    unrestricted?: boolean | undefined;
    blocked?: { reason: string } | undefined;
  },
  params: { now: string },
): { customer: Customer; account?: CustomerAccount } {
  const customer: Customer = {
    id: raw.id,
    name: raw.name,
    ...(raw.document !== undefined ? { document: raw.document } : {}),
    ...(raw.phone !== undefined ? { phone: raw.phone } : {}),
    createdAt: raw.createdAt,
    ...(raw.blocked !== undefined ? { blocked: { reason: raw.blocked.reason } } : {}),
  };
```

Actualizar el comentario de la función: `createdAt` es la fecha de alta real (antes era la hora del
pull, lo que dejaba sin sentido "Alta: <fecha>").

`src/sync/connector.ts`: reemplazar `BatchLotStatus`, `OutboxBatchItem`, `PullBatchParams`,
`PullBatchResult` y la firma de `pushBatch` por lo de **Interfaces**; mover acá (desde
`rest-fetch-connector.ts`) el schema de respuesta del pull y la reconstrucción de `nextCursor`:

```typescript
export const blockedSchema = z.object({ reason: z.string() });

export const connectorProductSchema = productSchema.extend({
  createdAt: z.string(),
  blocked: blockedSchema.optional(),
});
export type ConnectorProduct = z.infer<typeof connectorProductSchema>;

export const lotIssueSchema = z.object({ message: z.string(), eventId: z.string().optional() });
export type LotIssue = z.infer<typeof lotIssueSchema>;

/**
 * Estado de un lote de push (contrato v3, #96): `queued` (recibido, sin
 * empezar), `processing`, `ok`, `issues`. Un lote pedido que el backend no
 * informa se trata como `processing`.
 */
export const batchLotStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('queued') }),
  z.object({ status: z.literal('processing') }),
  z.object({ status: z.literal('ok') }),
  z.object({ status: z.literal('issues'), issues: z.array(lotIssueSchema) }),
]);
export type BatchLotStatus = z.infer<typeof batchLotStatusSchema>;

const pullResultSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({ items: z.array(itemSchema), nextCursor: z.string().optional() });

export const pullBatchResponseSchema = z.object({
  products: pullResultSchema(connectorProductSchema),
  customers: pullResultSchema(connectorCustomerSchema),
  stock: z.array(stockItemSchema),
  lots: z.record(z.string(), batchLotStatusSchema),
});

function withCursor<T>(result: { items: T[]; nextCursor?: string | undefined }): ConnectorPullResult<T> {
  return { items: result.items, ...(result.nextCursor !== undefined ? { nextCursor: result.nextCursor } : {}) };
}

/** `exactOptionalPropertyTypes`: Zod tipa `nextCursor` como `string | undefined`; se omite si falta. */
export function toPullBatchResult(data: z.infer<typeof pullBatchResponseSchema>): PullBatchResult {
  return {
    products: withCursor(data.products),
    customers: withCursor(data.customers),
    stock: data.stock,
    lots: data.lots,
  };
}

export type OutboxBatchItem = OutboxEventPayload & {
  id: string;
  createdAt: string;
  /** Contrato v3: obligatorio; `branch`/`pointOfSale` tolerados ausentes hasta la Etapa 2 (#97). */
  origin: EventOrigin;
};

export type PushBatch = { deviceId: string; events: OutboxBatchItem[] };
```

Si el tipo inferido de `lotIssueSchema` choca con `exactOptionalPropertyTypes` en algún consumidor,
declarar `LotIssue` a mano (`{ message: string; eventId?: string }`) y normalizar en
`toPullBatchResult` con spread condicional, igual que `withCursor`.

`src/test/fake-connector.ts`: sin cambios de forma (el `pullBatch` por defecto sigue devolviendo
listas vacías); ajustar el tipo si el compilador lo pide.

- [ ] **Step 4: Correr** — `pnpm vitest run src/sync/connector.test.ts src/domain/customer.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync/connector.ts src/sync/connector.test.ts src/domain/product.ts src/domain/customer.ts src/domain/customer.test.ts src/test/fake-connector.ts
git commit -m "feat(sync): puerto Connector v3 — estados de lote, avisos, alta y bloqueo en el pull (#96)"
```

---

### Task 4: Identidad de terminal (`deviceId`, sucursal, punto de venta) y estampado en storage

**Files:**
- Create: `src/sync/terminal-identity.ts`, `src/sync/terminal-identity.test.ts`
- Modify: `src/sync/config.ts`, `src/sync/config.test.ts`, `src/storage/sale-repository.ts`, `src/storage/customer-repository.ts`, `src/storage/cash-session-repository.ts`, `src/storage/local-data.ts` y sus tests

**Interfaces:**
- Consumes: builders con `origin` (Task 2), `buildEventOrigin` (Task 1).
- Produces:
  - `sync/config.ts`: `syncConfigSchema` suma `branch: z.string().optional()` y `pointOfSale: z.string().optional()` junto a `locale`.
  - `sync/terminal-identity.ts`: `DEVICE_ID_KEY = 'offline-pos:device-id'`; `getDeviceId(): string` (lee o genera con `crypto.randomUUID()` y guarda; si `localStorage` falla, devuelve un UUID en memoria del módulo, estable durante la carga de la página); `currentEventOrigin(): EventOrigin` (lee `loadSyncConfig()`; sin config válida → `{}`).
  - `storage/local-data.ts::listPendingOutbox()` excluye y marca `synced` los eventos pendientes de tipo legado.
  - `storage/cash-session-repository.ts::closeCashSessionAndPersist` deja de encolar evento.

- [ ] **Step 1: Tests que fallan**

```typescript
// src/sync/terminal-identity.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { saveSyncConfig } from './config.ts';
import { currentEventOrigin, DEVICE_ID_KEY, getDeviceId } from './terminal-identity.ts';

beforeEach(() => {
  localStorage.clear();
});

describe('getDeviceId', () => {
  it('genera un UUID una vez y lo reusa', () => {
    const first = getDeviceId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe(first);
    expect(getDeviceId()).toBe(first);
  });
});

describe('currentEventOrigin', () => {
  it('sin config, vacío', () => {
    expect(currentEventOrigin()).toEqual({});
  });
  it('toma sucursal y punto de venta de la config', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'http://x', branch: 'Centro', pointOfSale: 'Caja 1' });
    expect(currentEventOrigin()).toEqual({ branch: 'Centro', pointOfSale: 'Caja 1' });
  });
});
```

En `src/storage/local-data.test.ts` (o el test existente que cubra `listPendingOutbox`; crearlo con
`import 'fake-indexeddb/auto'` si no existe):

```typescript
it('un cash-session legado pendiente no se lista y queda marcado como enviado', async () => {
  await db.outbox.bulkAdd([
    { type: 'cash-session', session: {}, id: 'legacy', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' } as unknown as OutboxEvent,
    { type: 'customer', customer: { id: 'c1', name: 'A', createdAt: 'x' }, id: 'c1', status: 'pending', createdAt: '2026-01-02T00:00:00.000Z' },
  ]);
  expect((await listPendingOutbox()).map((event) => event.id)).toEqual(['c1']);
  expect((await db.outbox.get('legacy'))?.status).toBe('synced');
});
```

En `sale-repository.test.ts` / `customer-repository.test.ts`: con una config guardada con
`branch: 'Centro'`, el evento encolado tiene `origin: { branch: 'Centro' }`. En
`cash-session-repository.test.ts`: reemplazar la expectativa de evento `cash-session` por "cerrar un
turno no encola nada en el outbox".

- [ ] **Step 2: Correr** — `pnpm vitest run src/sync/terminal-identity.test.ts src/storage` → FAIL.

- [ ] **Step 3: Implementación**

```typescript
// src/sync/terminal-identity.ts
import { buildEventOrigin, type EventOrigin } from '../domain/event-origin.ts';
import { loadSyncConfig } from './config.ts';

export const DEVICE_ID_KEY = 'offline-pos:device-id';

let memoryFallback: string | undefined;

/**
 * Id de dispositivo (contrato v3, #96): viaja una vez por request de push y
 * de pull. Esta etapa solo lo genera y lo reusa; su ciclo de vida (sin id, la
 * terminal arranca de cero) es de la Etapa 2 (#97). Best-effort como
 * `sync/cursor.ts`: si `localStorage` falla, un id en memoria mantiene al
 * menos la misma identidad durante esta carga de la página.
 */
export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored !== null && stored !== '') {
      return stored;
    }
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    memoryFallback ??= crypto.randomUUID();
    return memoryFallback;
  }
}

/** Sucursal y punto de venta actuales de `/CONFIG`, para estampar en un evento al encolarlo. */
export function currentEventOrigin(): EventOrigin {
  const config = loadSyncConfig();
  if (!config.ok) {
    return {};
  }
  return buildEventOrigin({ branch: config.value.branch, pointOfSale: config.value.pointOfSale });
}
```

`src/sync/config.ts`: en el `z.object` junto a `locale`:

```typescript
      // Terminal (contrato v3, #96): se estampan en cada evento al encolarlo.
      // Opcionales hasta la Etapa 2 (#97), que los vuelve obligatorios.
      branch: z.string().optional(),
      pointOfSale: z.string().optional(),
```

Repositorios: en cada función que arma eventos (`closeSaleAndPersist`, `voidSaleAndPersist`,
`createCustomerLocally`, `releaseAccountHold`), leer `const origin = currentEventOrigin();` junto a
`const now = …` y pasarlo a cada builder (`{ now, origin }`). `storage/` ya importa de `sync/`
(`storage/demo-reset.ts`), así que no es una dependencia nueva de capa.

`cash-session-repository.ts::closeCashSessionAndPersist`: borrar el `db.outbox.add(…)` y el import de
`buildOutboxEventForCashSession`; si la transacción incluía `db.outbox`, sacarlo de la lista de tablas.
Actualizar el comentario: el turno local sigue hasta la Etapa 5, pero ya no viaja (contrato v3).

`storage/local-data.ts`:

```typescript
/**
 * Eventos del outbox que todavía no viajaron, en orden FIFO — el mismo orden
 * en que se arma un lote. Un evento de un tipo que el contrato ya no tiene
 * (`cash-session`, v3) se marca como enviado acá y nunca viaja.
 */
export async function listPendingOutbox(): Promise<OutboxEvent[]> {
  const pending = await db.outbox.where('status').equals('pending').sortBy('createdAt');
  const legacy = pending.filter((event) => isLegacyOutboxType(event.type));
  if (legacy.length > 0) {
    await db.outbox.bulkPut(legacy.map(markSynced));
  }
  return pending.filter((event) => !isLegacyOutboxType(event.type));
}
```

Revisar `summarizeLocalData`/`hasUserData`: siguen contando `cashSessions` (se sacan en la Etapa 5);
el conteo de outbox pendiente ahí no se toca.

- [ ] **Step 4: Correr** — `pnpm vitest run src/sync/terminal-identity.test.ts src/sync/config.test.ts src/storage` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync/terminal-identity.ts src/sync/terminal-identity.test.ts src/sync/config.ts src/sync/config.test.ts src/storage
git commit -m "feat(sync): id de dispositivo y origen estampado al encolar; cash-session deja de viajar (#96)"
```

---

### Task 5: Motor de sync con sobre v3, `deviceId` y estados nuevos

**Files:**
- Modify: `src/sync/engine.ts`, `src/sync/engine.test.ts`, `src/sync/push-lot.ts`, `src/sync/push-lot.test.ts`, `src/sync/pull-snapshot.ts`, `src/sync/connection.test.ts` (si arma `pullBatch`), `src/ui/state/sync.ts`, `src/sync/diagnostics.ts`

**Interfaces:**
- Consumes: `PushBatch`, `PullBatchParams`, `BatchLotStatus`, `LotIssue` (Task 3); `getDeviceId()` (Task 4).
- Produces:
  - `toBatchItem(event: OutboxEvent): OutboxBatchItem` con `createdAt` y `origin: event.origin ?? {}`.
  - `AwaitingLot = { id: string; sentAt: string; lastStatus?: 'queued' | 'processing' }`.
  - `updateAwaitingLots(resolvedIds: Set<string>, inProgress: Record<string, 'queued' | 'processing'>): void` — reemplaza a `resolveAwaitingLots`.
  - `pushLotIssuesSignal: Signal<LotIssue[] | null>`, `setPushLotIssues(issues: LotIssue[] | null)`.
  - `SyncDiagnostics.pushLotIssues: LotIssue[] | null`; `SyncDiagnostics.deviceId: string`.

- [ ] **Step 1: Tests que fallan** — en `engine.test.ts`:

```typescript
it('el lote viaja con deviceId y cada evento con su sobre (createdAt y origen)', async () => {
  localStorage.setItem('offline-pos:device-id', 'dev-1');
  await db.outbox.add({
    type: 'customer', customer: { id: 'c1', name: 'Ana', createdAt: now }, id: 'c1',
    status: 'pending', createdAt: now, origin: { branch: 'Centro' },
  });
  const pushBatch = vi.fn().mockResolvedValue(ok(undefined));
  await pushPendingLot(fakeConnector({ pushBatch }), now);
  expect(pushBatch).toHaveBeenCalledWith(
    { deviceId: 'dev-1', events: [{ type: 'customer', customer: { id: 'c1', name: 'Ana', createdAt: now }, id: 'c1', createdAt: now, origin: { branch: 'Centro' } }] },
    expect.any(String),
  );
});

it('un evento sin origen (encolado antes de v3) viaja con origen vacío', () => {
  const item = toBatchItem({ type: 'account-hold-release', holdId: 'h1', id: 'e1', status: 'pending', createdAt: now });
  expect(item).toEqual({ type: 'account-hold-release', holdId: 'h1', id: 'e1', createdAt: now, origin: {} });
});

it.each(['queued', 'processing'] as const)('un lote %s descarta el pull y guarda el último estado', async (status) => {
  addAwaitingLot({ id: 'lot-1', sentAt: now });
  const pullBatch = vi.fn().mockResolvedValue(ok({ products: { items: [product] }, customers: { items: [] }, stock: [], lots: { 'lot-1': { status } } }));
  const result = await runPullCycle(fakeConnector({ pullBatch }), now);
  expect(result).toMatchObject({ ok: false, error: 'sync/pending-lot' });
  expect(await db.products.count()).toBe(0);
  expect(getAwaitingLots()).toEqual([{ id: 'lot-1', sentAt: now, lastStatus: status }]);
});

it('un lote no informado cuenta como processing (descarta, sin lastStatus nuevo)', async () => { /* lots: {} → sync/pending-lot */ });

it('issues del lote llegan como objetos con eventId', async () => {
  addAwaitingLot({ id: 'lot-1', sentAt: now });
  const issues = [{ message: 'Stock negativo', eventId: 'm1' }];
  const pullBatch = vi.fn().mockResolvedValue(ok({ products: { items: [] }, customers: { items: [] }, stock: [], lots: { 'lot-1': { status: 'issues', issues } } }));
  await runPullCycle(fakeConnector({ pullBatch }), now);
  expect(pushLotIssuesSignal.value).toEqual(issues);
});

it('el pull manda el deviceId', async () => { /* pullBatch toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'dev-1' })) */ });
```

(Completar los dos `/* … */` con el mismo patrón de los tests de al lado; renombrar en los tests
existentes `'pending'` → `'queued'` y `issues: ['…']` → `issues: [{ message: '…' }]`; los productos
de prueba del pull suman `createdAt`.)

En `push-lot.test.ts`: `updateAwaitingLots(new Set(['a']), { b: 'processing' })` sobre `[a, b, c]`
deja `[{ b, lastStatus: 'processing' }, { c }]`.

- [ ] **Step 2: Correr** — `pnpm vitest run src/sync` → FAIL.

- [ ] **Step 3: Implementación**

`engine.ts::toBatchItem`:

```typescript
/** Convierte un evento del outbox a su forma de red (contrato v3): payload + sobre, sin `status`. */
export function toBatchItem(event: OutboxEvent): OutboxBatchItem {
  const envelope = { id: event.id, createdAt: event.createdAt, origin: event.origin ?? {} };
  switch (event.type) {
    case 'sale':
      return { type: 'sale', sale: event.sale, ...envelope };
    case 'stock-movement':
      return { type: 'stock-movement', movement: event.movement, ...envelope };
    case 'sale-void':
      return {
        type: 'sale-void',
        saleId: event.saleId,
        voidedAt: event.voidedAt,
        ...(event.voidReason !== undefined ? { voidReason: event.voidReason } : {}),
        ...envelope,
      };
    case 'customer':
      return { type: 'customer', customer: event.customer, ...envelope };
    case 'account-hold-confirm':
      return { type: 'account-hold-confirm', holdId: event.holdId, saleId: event.saleId, ...envelope };
    case 'account-hold-release':
      return { type: 'account-hold-release', holdId: event.holdId, ...envelope };
    case 'cash-movement':
      return { type: 'cash-movement', movement: event.movement, ...envelope };
    case 'customer-payment':
      return { type: 'customer-payment', payment: event.payment, ...envelope };
    default: {
      const exhaustiveCheck: never = event;
      throw new Error(`Tipo de evento de outbox desconocido: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
```

`pushPendingLot`: `const batch = { deviceId: getDeviceId(), events: items }; const result = await connector.pushBatch(batch, lot.id);` y loguear `{ idempotencyId: lot.id, ...batch }`.

`pullAndApply`: `const request = { deviceId: getDeviceId(), cursors, pendingLotIds: … }`. Reemplazar el
bucle de estados:

```typescript
  const resolved = new Set<string>();
  const inProgress: Record<string, 'queued' | 'processing'> = {};
  const issues: LotIssue[] = [];
  let stillInProgress = false;
  for (const lot of awaiting) {
    const status = pullResult.value.lots[lot.id];
    // Contrato v3: un lote pedido que el backend no informa cuenta como `processing`.
    if (status === undefined || status.status === 'queued' || status.status === 'processing') {
      stillInProgress = true;
      if (status !== undefined) {
        inProgress[lot.id] = status.status;
      }
      continue;
    }
    resolved.add(lot.id);
    if (status.status === 'issues') {
      issues.push(...status.issues);
    }
  }
  updateAwaitingLots(resolved, inProgress);

  // Etapa 1: `queued` y `processing` descartan el pull entero, igual que el `pending` de antes.
  // La Etapa 3 (#98) aplica datos maestros siempre y reaplica eventos de los lotes `queued`.
  if (stillInProgress) {
    return { applied: false, failure: err('sync/pending-lot', undefined) as Failure, issues, request };
  }
```

`PullOutcome.issues: LotIssue[]`. En `finishPullCycle`, el `console.warn` queda igual.

`pull-snapshot.ts` (`probeConnection`): `connector.pullBatch({ deviceId: getDeviceId(), cursors: {}, pendingLotIds: [] })`.

`push-lot.ts`:

```typescript
export type AwaitingLot = { id: string; sentAt: string; lastStatus?: 'queued' | 'processing' };

/** Saca los lotes resueltos (`ok`/`issues`) y anota el último estado informado de los que siguen en curso. */
export function updateAwaitingLots(
  resolvedIds: Set<string>,
  inProgress: Record<string, 'queued' | 'processing'>,
): void {
  setAwaitingLots(
    getAwaitingLots()
      .filter((lot) => !resolvedIds.has(lot.id))
      .map((lot) => {
        const status = inProgress[lot.id];
        return status === undefined ? lot : { ...lot, lastStatus: status };
      }),
  );
}
```

Eliminar `resolveAwaitingLots` (y sus usos/tests).

`ui/state/sync.ts`: `pushLotIssuesSignal = signal<LotIssue[] | null>(null)` y el setter con el mismo
tipo (import de tipo desde `sync/connector.ts`). `sync/diagnostics.ts`: `pushLotIssues: LotIssue[] | null`
y `deviceId: getDeviceId()`.

Revisar `ui/errors.ts` `case 'sync/pending-lot'`: el texto tiene que decir que el backend todavía no
terminó de procesar un lote enviado (no "pendiente" a secas). Ajustar solo si hoy dice otra cosa.

- [ ] **Step 4: Correr** — `pnpm vitest run src/sync && pnpm typecheck` → PASS (los errores de tipo restantes son de UI/conectores, Tasks 6–8; si `typecheck` falla solo ahí, seguir).

- [ ] **Step 5: Commit**

```bash
git add src/sync src/ui/state/sync.ts src/ui/errors.ts
git commit -m "feat(sync): motor con sobre v3, deviceId y estados queued/processing (#96)"
```

---

### Task 6: UI — campos de terminal en `/CONFIG`, avisos y estados en `/DIAGNOSTICO`, `pos.deviceId()`

**Files:**
- Modify: `src/ui/state/sync-config.ts`, `src/ui/keyboard/config-controller.ts`, `src/ui/screens/config-screen.tsx`, `src/ui/screens/diagnostico-screen.tsx`, `src/ui/console/pos-console.ts` y sus tests (`config-controller.test.ts`, `diagnostico-controller.test.ts` o el test de la pantalla, `pos-console.test.ts`)

**Interfaces:**
- Consumes: `syncConfigSchema` con `branch`/`pointOfSale` (Task 4); `SyncDiagnostics.deviceId`, `pushLotIssues: LotIssue[]`, `AwaitingLot.lastStatus` (Task 5); `getDeviceId()`.
- Produces:
  - `configTerminalSignal: Signal<{ locale: string; branch: string; pointOfSale: string }>` reemplaza a `configLocaleSignal`; `setConfigTerminalField(key: 'locale' | 'branch' | 'pointOfSale', value: string)` reemplaza a `setConfigLocale`.
  - `TERMINAL_FIELDS: ConfigField[]` en `config-screen.tsx`: Sucursal, Punto de venta, Locale (en ese orden, al final, todos opcionales en esta etapa).
  - `PosConsole.deviceId: () => string`; `PosConsoleDeps.getDeviceId: () => string`; `PosStatus.dispositivo: string`; `PosStatus.issuesDelBackend: string[] | null` (cada issue formateado como `"<message> (evento <eventId>)"` o solo `message`).

- [ ] **Step 1: Tests que fallan**

`config-controller.test.ts`:

```typescript
it('guarda sucursal y punto de venta recortados; en blanco no se guardan', async () => {
  // mismo arranque que los tests existentes que prueban locale: elegir tipo rest, completar baseUrl
  setConfigTerminalField('branch', '  Centro ');
  setConfigTerminalField('pointOfSale', '');
  // …confirmar como en el test de locale existente…
  expect(loadSyncConfig()).toMatchObject({ ok: true, value: { branch: 'Centro' } });
  expect(loadSyncConfig().ok && 'pointOfSale' in loadSyncConfig().value).toBe(false);
});
```

(Copiar el arranque/confirmación del test de `locale` que ya existe en ese archivo; renombrar sus usos
de `setConfigLocale` → `setConfigTerminalField('locale', …)`.)

`pos-console.test.ts`: `pos.deviceId()` devuelve lo que da `deps.getDeviceId`; `status().issuesDelBackend`
formatea `[{ message: 'x', eventId: 'e1' }]` como `['x (evento e1)']`.

Test de `/DIAGNOSTICO` (el archivo que hoy renderiza la pantalla): muestra "Dispositivo: dev-1", un
lote en espera con `lastStatus: 'processing'` como "procesando" (`queued` → "en cola", sin estado →
"sin informar"), y un issue con su evento.

- [ ] **Step 2: Correr** — `pnpm vitest run src/ui` → FAIL.

- [ ] **Step 3: Implementación**

`ui/state/sync-config.ts`:

```typescript
/** Campos de terminal (no del conector): van fuera de la unión por `type`, siempre al final de /CONFIG. */
export type TerminalFieldKey = 'locale' | 'branch' | 'pointOfSale';
export const configTerminalSignal = signal<Record<TerminalFieldKey, string>>({ locale: '', branch: '', pointOfSale: '' });
```

y en la carga de lo guardado: `configTerminalSignal.value = { locale: saved?.locale ?? '', branch: saved?.branch ?? '', pointOfSale: saved?.pointOfSale ?? '' };`.

`config-controller.ts`:

```typescript
export function setConfigTerminalField(key: TerminalFieldKey, value: string): void {
  configTerminalSignal.value = { ...configTerminalSignal.value, [key]: value };
  clearConfigError();
}
```

y en `validateForm`, en lugar del bloque de `locale`:

```typescript
  for (const [key, value] of Object.entries(configTerminalSignal.value)) {
    const trimmed = value.trim();
    if (trimmed !== '') {
      candidate[key] = trimmed;
    }
  }
```

`config-screen.tsx`: reemplazar `LOCALE_FIELD` por

```typescript
/** Config de terminal, no de un conector: vive aparte y va siempre al final. */
const TERMINAL_FIELDS: ConfigField[] = [
  { key: 'branch', label: 'Sucursal', optional: true, placeholder: 'Casa central' },
  { key: 'pointOfSale', label: 'Punto de venta', optional: true, placeholder: 'Caja 1' },
  { key: 'locale', label: 'Locale (ej. es-AR — en blanco usa el del navegador)', optional: true, placeholder: 'es-AR' },
];

const isTerminalField = (key: string): key is TerminalFieldKey =>
  key === 'locale' || key === 'branch' || key === 'pointOfSale';
```

donde hoy se hace `[...campos, LOCALE_FIELD]` usar `[...campos, ...TERMINAL_FIELDS]`, y en el render
cambiar `isLocale` por `isTerminalField(field.key)` leyendo `configTerminalSignal.value[field.key]` y
escribiendo con `setConfigTerminalField(field.key, …)`.

`diagnostico-screen.tsx`: sumar una línea "Dispositivo: {diagnostics.deviceId}" en la tarjeta de
conexión; en la lista de lotes en espera, mostrar el estado con

```typescript
const LOT_STATUS_LABEL = { queued: 'en cola', processing: 'procesando' } as const;
// …
{lot.lastStatus !== undefined ? LOT_STATUS_LABEL[lot.lastStatus] : 'sin informar'}
```

y los issues con `diagnostics.pushLotIssues.map(formatLotIssue).join('; ')`, donde
`formatLotIssue` (exportada desde `ui/console/pos-console.ts` o un módulo chico `ui/format-lot-issue.ts`
compartido por ambos) es:

```typescript
export function formatLotIssue(issue: LotIssue): string {
  return issue.eventId !== undefined ? `${issue.message} (evento ${issue.eventId})` : issue.message;
}
```

`pos-console.ts`: `deps.getDeviceId`, `deviceId: () => deps.getDeviceId()`, `PosStatus.dispositivo`,
`issuesDelBackend: diagnostics.pushLotIssues?.map(formatLotIssue) ?? null`, fila nueva en `HELP`
(`pos.deviceId()` — "Id de dispositivo de esta terminal."), e `installPosConsole` pasa
`getDeviceId`. Sacar de CLAUDE.md la línea "pos.deviceId() se suma cuando exista…" en la Task 13.

- [ ] **Step 4: Correr** — `pnpm vitest run src/ui && pnpm typecheck` → PASS salvo conectores.

- [ ] **Step 5: Commit**

```bash
git add src/ui
git commit -m "feat(ui): sucursal y punto de venta en /CONFIG, estados de lote y dispositivo en /DIAGNOSTICO, pos.deviceId() (#96)"
```

---

### Task 7: Conector REST v3

**Files:**
- Modify: `src/connectors/rest/rest-fetch-connector.ts`, `src/connectors/rest/rest-fetch-connector.test.ts`

**Interfaces:**
- Consumes: `pullBatchResponseSchema`, `toPullBatchResult`, `PushBatch`, `PullBatchParams` (Task 3).

- [ ] **Step 1: Tests que fallan**

```typescript
it('push manda deviceId y los eventos con su sobre', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const batch = { deviceId: 'dev-1', events: [{ type: 'account-hold-release', holdId: 'h1', id: 'e1', createdAt: now, origin: { branch: 'Centro' } }] } as const;
  await createRestFetchConnector(config).pushBatch(batch, 'lot-1');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(batch);
});

it('pull manda deviceId y valida createdAt, bloqueo y estados v3', async () => {
  const body = { products: { items: [{ ...product, createdAt: now, blocked: { reason: 'Sin proveedor' } }] }, customers: { items: [] }, stock: [], lots: { 'lot-1': { status: 'processing' } } };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const result = await createRestFetchConnector(config).pullBatch({ deviceId: 'dev-1', cursors: {}, pendingLotIds: ['lot-1'] });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ deviceId: 'dev-1' });
  expect(result).toMatchObject({ ok: true, value: { lots: { 'lot-1': { status: 'processing' } } } });
});

it('un lote con el estado viejo pending es payload inválido', async () => { /* lots: { x: { status: 'pending' } } → error 'sync/invalid-payload' */ });
```

Actualizar los tests existentes: `pushBatch(items, id)` → `pushBatch({ deviceId, events }, id)`,
productos/clientes con `createdAt`.

- [ ] **Step 2: Correr** — `pnpm vitest run src/connectors/rest` → FAIL.

- [ ] **Step 3: Implementación** — borrar `batchLotStatusSchema`/`pullBatchResponseSchema` locales;
importar los de `sync/connector.ts`:

```typescript
    async pushBatch(batch: PushBatch, idempotencyId: string): Promise<Result<void>> {
      const result = await postJson('/sync/push', idempotencyId, batch);
      return result.ok ? ok(undefined) : result;
    },

    async pullBatch(params: PullBatchParams): Promise<Result<PullBatchResult>> {
      const result = await postJson('/sync/pull', undefined, params);
      if (!result.ok) {
        return result;
      }
      const parsed = pullBatchResponseSchema.safeParse(result.value);
      if (!parsed.success) {
        return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
      }
      return ok(toPullBatchResult(parsed.data));
    },
```

Comentario de cabecera: "contrato v3 — #96".

- [ ] **Step 4: Correr** — `pnpm vitest run src/connectors/rest` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/connectors/rest
git commit -m "feat(rest): conector REST sobre el contrato v3 (#96)"
```

---

### Task 8: Conector de Google Sheets (lado TS) v3

**Files:**
- Modify: `src/connectors/google-sheets/google-sheets-connector.ts`, `google-sheets-connector.test.ts`

**Interfaces:**
- Consumes: `connectorProductSchema`, `connectorCustomerSchema`, `batchLotStatusSchema`, `PushBatch`, `PullBatchParams` (Task 3).
- El puente manda `{ products, customers, lots }` (sin `stock`, sin `tracksStock`); este conector completa `tracksStock: false`, `unrestricted: true`, `stock: []` como hoy.

- [ ] **Step 1: Tests que fallan**

```typescript
it('pushBatch manda deviceId y eventos al puente', async () => {
  // mismo stub de fetch que los tests existentes de este archivo
  await connector.pushBatch({ deviceId: 'dev-1', events: [] }, 'lot-1');
  expect(bridgeBody()).toMatchObject({ action: 'pushBatch', payload: { deviceId: 'dev-1', events: [] }, idempotencyKey: 'lot-1' });
});

it('pullBatch manda deviceId y trae alta, bloqueo e issues con eventId', async () => {
  respondWith({ products: { items: [{ id: 'p1', sku: 'S', barcodes: [], name: 'N', price: 1, taxRate: 0, category: 'c', createdAt: now, blocked: { reason: '' } }] }, customers: { items: [] }, lots: { l1: { status: 'issues', issues: [{ message: 'x', eventId: 'e1' }] } } });
  const result = await connector.pullBatch({ deviceId: 'dev-1', cursors: {}, pendingLotIds: ['l1'] });
  expect(bridgeBody()).toMatchObject({ payload: { deviceId: 'dev-1' } });
  expect(result).toMatchObject({ ok: true, value: { products: { items: [{ tracksStock: false, blocked: { reason: '' } }] }, lots: { l1: { status: 'issues' } } } });
});
```

(`bridgeBody`/`respondWith`: usar los helpers que ya tiene el archivo de test para el stub de fetch
del puente; si no existen con esos nombres, usar los existentes.)

- [ ] **Step 2: Correr** — `pnpm vitest run src/connectors/google-sheets/google-sheets-connector.test.ts` → FAIL.

- [ ] **Step 3: Implementación**

```typescript
/** Producto tal como lo manda el puente: sin `tracksStock`, que fija este conector. */
const bridgeProductSchema = connectorProductSchema.omit({ tracksStock: true });

const pullBatchDataSchema = z.object({
  products: pullResultSchema(bridgeProductSchema),
  customers: pullResultSchema(connectorCustomerSchema),
  lots: z.record(z.string(), batchLotStatusSchema),
});
```

`pushBatch(batch, idempotencyId)` → `payload: batch`; `pullBatch(params)` → `payload: { deviceId: params.deviceId, cursors: params.cursors, pendingLotIds: params.pendingLotIds }`. Borrar el
`lotStatusSchema` local. Actualizar el comentario de cabecera: Sheets procesa dentro del request, así
que nunca informa `queued`/`processing`.

- [ ] **Step 4: Correr** — `pnpm vitest run src/connectors && pnpm typecheck && pnpm lint` → PASS (todo el front compila acá).

- [ ] **Step 5: Commit**

```bash
git add src/connectors/google-sheets/google-sheets-connector.ts src/connectors/google-sheets/google-sheets-connector.test.ts
git commit -m "feat(sheets): conector TS sobre el contrato v3 (#96)"
```

---

### Task 9: Puente de Sheets — pestañas, columnas y `ensureColumns`

**Files:**
- Modify: `src/connectors/google-sheets/bridge.gs`, `columnas.gs`, `bridge.test.ts`, `src/test/fake-spreadsheet.ts`

**Interfaces:**
- Produces (Apps Script, claves internas):
  - Tipo de columna `quantity` → formato `#,##0.###`.
  - `Productos`: + `createdAt` (datetime, opc.), `blocked` (text, opc.), `blockedReason` (text, opc.).
  - `Clientes`: + `blocked`, `blockedReason`, `deviceId`, `branch`, `pointOfSale` (todas text, opc.).
  - `Ventas`: `cantidad` pasa a `quantity`; + `deviceId`, `branch`, `pointOfSale`, `anulacionBranch`, `anulacionPointOfSale` (text, opc.).
  - `Pagos`: + `deviceId`, `branch`, `pointOfSale` (text, opc.).
  - `CuentaCorriente`: + `customerPaymentId`, `deviceId`, `branch`, `pointOfSale` (text, opc.).
  - `MovimientosCaja` (nueva): `movementId` text, `fecha` datetime, `direccion` text, `monto` number, `concepto` text, `descripcion` text opc., `origenMovimiento` text, `esperado` number opc., `contado` number opc., `deviceId`/`branch`/`pointOfSale` text opc.
  - `Cobranzas` (nueva): `customerPaymentId` text, `fecha` datetime, `customerId` text, `medio` text, `monto` number, `totalCobranza` number, `deviceId`/`branch`/`pointOfSale` text opc.
  - `_PushLots`: + `deviceId` (text, opc.).
  - `Turnos`: se saca del `SCHEMA` y de `COLUMN_LABELS`.
  - `FakeSheet.insertColumnsAfter(after: number, howMany: number): void`.

- [ ] **Step 1: `insertColumnsAfter` en la planilla falsa** (con su propio test mínimo en `bridge.test.ts` indirecto; no hace falta test aparte)

```typescript
  /** Como Sheets: las columnas nuevas heredan formato y validación de la columna de la izquierda. */
  insertColumnsAfter(after: number, howMany: number): void {
    this.grid.forEach((line) => {
      const source = line[after - 1];
      if (source === undefined) {
        throw new Error(`insertColumnsAfter: la columna ${String(after)} no existe`);
      }
      const created = Array.from({ length: howMany }, () => ({ value: '', format: source.format, validation: source.validation }));
      line.splice(after, 0, ...created);
    });
  }
```

- [ ] **Step 2: Tests que fallan** — en `bridge.test.ts`:

```typescript
describe('contrato v3 (#96)', () => {
  it('crea MovimientosCaja y Cobranzas, y ya no crea Turnos', () => {
    const { spreadsheet, call } = loadBridge();
    pullBatch(call);
    expect(spreadsheet.sheetNames()).toEqual(expect.arrayContaining(['MovimientosCaja', 'Cobranzas']));
    expect(spreadsheet.sheetNames()).not.toContain('Turnos');
    expect(spreadsheet.getSheetByName('MovimientosCaja')?.values()[0]).toContain('Esperado');
  });

  it('ensureColumns agrega al final las columnas que le faltan a una pestaña vieja, sin tocar datos', () => {
    const { spreadsheet, call } = loadBridge();
    spreadsheet.addSheet('Productos', [
      ['Id', 'SKU', 'Códigos de barras', 'Nombre', 'Precio', 'IVA', 'Categoría'],
      ['p-1', 'S1', '', 'Yerba', 100, 0.21, 'almacen'],
    ]);
    pullBatch(call);
    const header = spreadsheet.getSheetByName('Productos')?.values()[0];
    expect(header?.slice(0, 10)).toEqual(['Id', 'SKU', 'Códigos de barras', 'Nombre', 'Precio', 'IVA', 'Categoría', 'Alta', 'Bloqueado', 'Motivo del bloqueo']);
    expect(spreadsheet.getSheetByName('Productos')?.values()[1]?.slice(0, 4)).toEqual(['p-1', 'S1', '', 'Yerba']);
  });

  it('completa la Alta que falta la primera vez que lee la fila, y después queda fija', () => {
    const { call } = loadBridge();
    const first = pullBatch(call);
    const second = pullBatch(call);
    const dates = (response: typeof first) => (response.data as { products: { items: { createdAt: string }[] } }).products.items.map((item) => item.createdAt);
    expect(dates(first).every((date) => /^\d{4}-\d{2}-\d{2}T/.test(date))).toBe(true);
    expect(dates(second)).toEqual(dates(first));
  });

  it('informa el bloqueo con su motivo', () => {
    const { spreadsheet, call } = loadBridge();
    pullBatch(call);
    const sheet = spreadsheet.getSheetByName('Productos');
    // fila 2 = primer producto sembrado; columnas por encabezado
    const header = sheet?.values()[0] ?? [];
    sheet?.getRange(2, header.indexOf('Bloqueado') + 1).setValue('Sí');
    sheet?.getRange(2, header.indexOf('Motivo del bloqueo') + 1).setValue('Vencido');
    const response = pullBatch(call);
    expect((response.data as { products: { items: { blocked?: { reason: string } }[] } }).products.items[0]?.blocked).toEqual({ reason: 'Vencido' });
  });

  it('estampa dispositivo, sucursal y punto de venta en lo que escribe', () => {
    const { spreadsheet, call } = loadBridge();
    call('pushBatch', { deviceId: 'dev-1', events: [saleEvent({ origin: { branch: 'Centro', pointOfSale: 'Caja 1' } })] }, 'lot-1');
    const ventas = table(spreadsheet, 'Ventas');
    expect(ventas[0]).toEqual(expect.arrayContaining(['dev-1', 'Centro', 'Caja 1']));
  });

  it('cash-movement escribe una fila en MovimientosCaja con valores en español', () => {
    const { spreadsheet, call } = loadBridge();
    call('pushBatch', { deviceId: 'dev-1', events: [{ type: 'cash-movement', id: 'm1', createdAt: NOW, origin: {}, movement: { id: 'm1', direction: 'out', amount: 250, concept: 'Ajuste por arqueo', source: 'count-adjustment', count: { expected: 1000, counted: 750 }, createdAt: NOW } }] }, 'lot-1');
    expect(table(spreadsheet, 'MovimientosCaja')[0]).toEqual(expect.arrayContaining(['m1', 'Egreso', 250, 'Ajuste por arqueo', 'Ajuste por arqueo', 1000, 750]));
  });

  it('customer-payment escribe una fila por medio en Cobranzas y una negativa en CuentaCorriente', () => {
    const { spreadsheet, call } = loadBridge();
    call('pushBatch', { deviceId: 'dev-1', events: [{ type: 'customer-payment', id: 'cp1', createdAt: NOW, origin: {}, payment: { id: 'cp1', customerId: 'c-1', payments: [{ method: 'cash', amount: 300 }, { method: 'qr', amount: 200 }], total: 500, createdAt: NOW } }] }, 'lot-1');
    expect(table(spreadsheet, 'Cobranzas')).toHaveLength(2);
    expect(table(spreadsheet, 'CuentaCorriente')[0]).toEqual(expect.arrayContaining(['c-1', -500, 'cp1']));
  });

  it('un pago a cuenta sin hold (fiado offline o acreditación) va al libro de CuentaCorriente con su signo', () => {
    const { spreadsheet, call } = loadBridge();
    call('pushBatch', { deviceId: 'dev-1', events: [saleEvent({ customerId: 'c-1', payments: [{ method: 'account', amount: -120 }], total: -120 })] }, 'lot-1');
    expect(table(spreadsheet, 'CuentaCorriente')[0]).toEqual(expect.arrayContaining(['c-1', -120]));
  });

  it('un tipo desconocido (cash-session viejo) queda como issue con su eventId, sin tumbar el lote', () => {
    const { call } = loadBridge();
    call('pushBatch', { deviceId: 'dev-1', events: [{ type: 'cash-session', id: 'cs1', createdAt: NOW, origin: {}, session: {} }] }, 'lot-1');
    const response = pullBatch(call, {}, ['lot-1']);
    expect((response.data as { lots: unknown }).lots).toEqual({ 'lot-1': { status: 'issues', issues: [{ message: expect.stringContaining('cash-session') as unknown, eventId: 'cs1' }] } });
  });
});
```

Notas para el test: definir `NOW` y un helper `saleEvent(overrides)` al principio del bloque que arme
un evento `sale` completo con sobre (`id`, `createdAt`, `origin`) — tomar la venta de ejemplo que ya
usan los tests de `pushBatch` existentes y reemplazar sus campos con `overrides`.

Actualizar tests existentes:
- `'arnés (humo…)'` y `'crea las pestañas…'`: `Turnos` ya no se crea → cambiar las aserciones a
  `MovimientosCaja`/`Cobranzas` ('Tarjeta de débito' pasa a verificarse vía `VALUE_LABELS` de medio en
  Cobranzas si hace falta, o se borra esa línea).
- `'no redimensiona una pestaña que ya existía'`: ahora `ensureColumns` agrega 3 columnas a Productos
  → esperar `[13, 10]` y renombrar el test a "solo agrega las columnas que faltan, no filas".
- Todos los `pushBatch` existentes pasan a `{ deviceId: 'dev-1', events: [...] }` con sobre por evento.
- Los issues de lote pasan a objetos `{ message, eventId }`.

- [ ] **Step 3: Correr** — `pnpm vitest run src/connectors/google-sheets/bridge.test.ts` → FAIL.

- [ ] **Step 4: Implementación en `columnas.gs`**

```javascript
  Productos: {
    id: 'Id', sku: 'SKU', barcodes: 'Códigos de barras', name: 'Nombre', price: 'Precio', taxRate: 'IVA',
    category: 'Categoría', createdAt: 'Alta', blocked: 'Bloqueado', blockedReason: 'Motivo del bloqueo',
  },
  Clientes: {
    id: 'Id', name: 'Nombre', document: 'Documento', phone: 'Teléfono', createdAt: 'Alta',
    blocked: 'Bloqueado', blockedReason: 'Motivo del bloqueo',
    deviceId: 'Dispositivo', branch: 'Sucursal', pointOfSale: 'Punto de venta',
  },
  // Ventas: agregar al final
  //   deviceId: 'Dispositivo', branch: 'Sucursal', pointOfSale: 'Punto de venta',
  //   anulacionBranch: 'Sucursal de anulación', anulacionPointOfSale: 'Punto de venta de anulación',
  // Pagos: agregar deviceId, branch, pointOfSale (mismas etiquetas)
  // CuentaCorriente: agregar customerPaymentId: 'Id de cobranza', deviceId, branch, pointOfSale
  MovimientosCaja: {
    movementId: 'Id de movimiento', fecha: 'Fecha', direccion: 'Sentido', monto: 'Monto',
    concepto: 'Concepto', descripcion: 'Descripción', origenMovimiento: 'Origen',
    esperado: 'Esperado', contado: 'Contado',
    deviceId: 'Dispositivo', branch: 'Sucursal', pointOfSale: 'Punto de venta',
  },
  Cobranzas: {
    customerPaymentId: 'Id de cobranza', fecha: 'Fecha', customerId: 'Id de cliente', medio: 'Medio de pago',
    monto: 'Monto', totalCobranza: 'Total de la cobranza',
    deviceId: 'Dispositivo', branch: 'Sucursal', pointOfSale: 'Punto de venta',
  },
  _PushLots: { id: 'Id', status: 'Estado', issues: 'Problemas', at: 'Registrado el', deviceId: 'Dispositivo' },
```

Borrar `Turnos`. En `VALUE_LABELS`:

```javascript
  direccion: { in: 'Ingreso', out: 'Egreso' },
  origenMovimiento: { manual: 'Manual', 'count-adjustment': 'Ajuste por arqueo' },
  blocked: { yes: 'Sí', no: 'No' },
```

- [ ] **Step 5: Implementación en `bridge.gs`**

1. `SCHEMA`: aplicar las columnas de **Interfaces** (entrada `['clave', 'tipo', true]` para cada opcional
   nueva), `['cantidad', 'quantity']` en Ventas, sacar `Turnos`. `NUMBER_FORMATS.quantity = '#,##0.###'`.
2. `ensureColumns`, llamada desde `ensureSheetsExist` para cada pestaña que ya existía:

```javascript
/**
 * Agrega al final de una pestaña existente las columnas del SCHEMA que le faltan (contrato v3,
 * #96): así una planilla anterior se actualiza sola al redesplegar el puente, sin tocar datos.
 * La columna nueva copia formato y validación en la fila plantilla (2) desde su tipo, igual que
 * createSheet. Una columna se reconoce por etiqueta o clave, como en headerMap.
 */
function ensureColumns(sheet, name) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var present = {};
  sheet.getRange(1, 1, 1, width).getValues()[0].forEach(function (cell) {
    present[normalize(cell)] = true;
  });
  var missing = SCHEMA[name].filter(function (column) {
    return !present[normalize(column.key)] && !present[normalize(COLUMN_LABELS[name][column.key])];
  });
  if (missing.length === 0) {
    return;
  }
  var needed = width + missing.length - sheet.getMaxColumns();
  if (needed > 0) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), needed);
  }
  missing.forEach(function (column, index) {
    var position = width + index + 1;
    sheet.getRange(1, position).setValue(COLUMN_LABELS[name][column.key]).setFontWeight('bold');
    var template = sheet.getRange(2, position);
    template.setNumberFormat(NUMBER_FORMATS[column.type]);
    template.setDataValidations([[validationFor(column)]]);
  });
}

function ensureSheetsExist() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      createSheet(spreadsheet, name);
    } else {
      ensureColumns(sheet, name);
    }
  });
}
```

   Si `getMaxRows() < 2` en una pestaña existente, `getRange(2, …)` no existe en la planilla falsa:
   insertar una fila (`sheet.insertRowsAfter(1, 1)`) antes de escribir la plantilla.
3. Identidad. Helper:

```javascript
/** Columnas de identidad de un evento (contrato v3): dispositivo del lote, origen del evento. */
function stampOf(deviceId, event) {
  var origin = event.origin || {};
  return { deviceId: deviceId, branch: origin.branch, pointOfSale: origin.pointOfSale };
}

function withStamp(object, stamp) {
  return Object.assign({}, object, stamp);
}
```

   (`Object.assign` existe en el runtime V8 de Apps Script y en `vm` de Node.)
4. `pushBatchAction(payload, idempotencyKey)`: `var deviceId = payload.deviceId || '';`, llamar
   `applyBatchEvent(event, stampOf(deviceId, event))`, issues como objetos:

```javascript
      issues.push({
        message: (event.type || '?') + ': ' + (error && error.message ? error.message : String(error)),
        eventId: event.id,
      });
```

   y la fila de `_PushLots` con `deviceId: deviceId`. En `pullBatchAction`, al leer `issues`:
   `JSON.parse(String(row.issues || '[]'))` ya devuelve los objetos; para filas de lotes viejos
   (strings), convertir: `.map(function (issue) { return typeof issue === 'string' ? { message: issue } : issue; })`.
5. `applyBatchEvent(event, stamp)`:

```javascript
function applyBatchEvent(event, stamp) {
  switch (event.type) {
    case 'sale':
      pushSale(event.sale, stamp);
      return;
    case 'sale-void':
      pushSaleVoid(event, stamp);
      return;
    case 'customer':
      pushCustomer(event.customer, stamp);
      return;
    case 'account-hold-confirm':
      pushAccountHoldConfirm(event, stamp);
      return;
    case 'cash-movement':
      pushCashMovement(event.movement, stamp);
      return;
    case 'customer-payment':
      pushCustomerPayment(event.payment, stamp);
      return;
    case 'stock-movement':
    case 'account-hold-release':
      // No-ops de este conector: ver README ("Qué hace cada operación").
      return;
    default:
      throw new Error('Tipo de evento desconocido para el contrato v3: ' + event.type);
  }
}
```

6. `pushSale(sale, stamp)`: cada línea y cada pago con `withStamp(…, stamp)`; además, por cada pago
   `account` **sin** `reference`, una fila en `CuentaCorriente`:
   `withStamp({ fecha: sale.createdAt, saleId: sale.id, customerId: sale.customerId, monto: payment.amount }, stamp)`.
7. `pushSaleVoid(event, stamp)`: igual que hoy más `anulacionBranch: stamp.branch, anulacionPointOfSale: stamp.pointOfSale` en `markSaleRows('Ventas', …)`.
8. `pushCustomer(customer, stamp)`: `appendObjects('Clientes', [withStamp({ …como hoy… }, stamp)])`.
9. `pushAccountHoldConfirm(event, stamp)`: fila con `withStamp`.
10. Nuevas:

```javascript
function pushCashMovement(movement, stamp) {
  if (!movement || !movement.id) {
    throw new Error('Falta movement');
  }
  var count = movement.count || {};
  appendObjects('MovimientosCaja', [
    withStamp(
      {
        movementId: movement.id,
        fecha: movement.createdAt,
        direccion: movement.direction,
        monto: movement.amount,
        concepto: movement.concept,
        descripcion: movement.description,
        origenMovimiento: movement.source,
        esperado: count.expected,
        contado: count.counted,
      },
      stamp,
    ),
  ]);
}

/** Una fila por medio en Cobranzas y el total en negativo en el libro de CuentaCorriente. */
function pushCustomerPayment(payment, stamp) {
  if (!payment || !payment.id) {
    throw new Error('Falta payment');
  }
  appendObjects(
    'Cobranzas',
    payment.payments.map(function (line) {
      return withStamp(
        {
          customerPaymentId: payment.id,
          fecha: payment.createdAt,
          customerId: payment.customerId,
          medio: line.method,
          monto: line.amount,
          totalCobranza: payment.total,
        },
        stamp,
      );
    }),
  );
  appendObjects('CuentaCorriente', [
    withStamp(
      { fecha: payment.createdAt, customerId: payment.customerId, monto: -payment.total, customerPaymentId: payment.id },
      stamp,
    ),
  ]);
}
```

11. Borrar `pushCashSession`.
12. Pull: `pullProducts`/`pullCustomers` suman `createdAt` y `blocked`:

```javascript
/** Alta de la fila como ISO; si está vacía la completa ahora (y queda fija en la planilla). */
function createdAtOf(name, row, now) {
  if (row.createdAt instanceof Date) {
    return row.createdAt.toISOString();
  }
  if (row.createdAt !== '' && row.createdAt !== undefined) {
    return String(row.createdAt);
  }
  setCells(name, row._row, { createdAt: now });
  return now;
}

function blockedOf(row) {
  return row.blocked === 'yes' ? { reason: String(row.blockedReason || '') } : undefined;
}
```

   En `pullProducts` (con `var now = new Date().toISOString();` al principio) agregar
   `createdAt: createdAtOf('Productos', row, now)` y `blocked: blockedOf(row)`, y pasar el objeto por
   `compact` para omitir `blocked` ausente (cuidando que `compact` no borre `barcodes: []`: aplicar
   `compact` solo a un objeto con `blocked`, o agregar `blocked` condicionalmente con un `if`). Igual en
   `pullCustomers` con `'Clientes'`. Nota: `row.createdAt` de una celda datetime llega como `Date`
   (así lo devuelve `getValues` en Sheets y en la planilla falsa).
   El fingerprint de `trackChanges` cambia una vez al sumar estos campos (todas las filas vuelven a
   viajar en el primer delta después de redesplegar): esperado, no hace falta evitarlo.

- [ ] **Step 6: Correr** — `pnpm vitest run src/connectors/google-sheets` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/connectors/google-sheets/bridge.gs src/connectors/google-sheets/columnas.gs src/connectors/google-sheets/bridge.test.ts src/test/fake-spreadsheet.ts
git commit -m "feat(sheets): puente v3 — movimientos de caja, cobranzas, identidad, bloqueos, alta y ensureColumns (#96)"
```

---

### Task 10: README del conector de Sheets (redespliegue y qué cambió)

**Files:**
- Modify: `src/connectors/google-sheets/README.md`

- [ ] **Step 1:** Agregar una sección "Actualizar a la versión v3 del contrato (#96)" con estos pasos,
  y actualizar "Qué hace cada operación" y la lista de pestañas:

```markdown
## Actualizar el puente a la v3 del contrato (#96)

1. Abrí la planilla → Extensiones → Apps Script.
2. Reemplazá el contenido de `bridge.gs` y de `columnas.gs` por los de esta carpeta (los dos archivos:
   `columnas.gs` tiene las etiquetas nuevas).
3. Guardá (Ctrl+S).
4. Implementar → Administrar implementaciones → lápiz sobre la implementación existente →
   Versión: **Nueva versión** → Implementar. La URL `/exec` no cambia: no hace falta tocar `/CONFIG`.
   (Crear una implementación **nueva** daría otra URL, y cambiar la URL en `/CONFIG` cuenta como otro
   origen: borraría los datos locales.)
5. En el POS, `/SINCRONIZAR`. En la planilla deberías ver:
   - pestañas nuevas **MovimientosCaja** y **Cobranzas**;
   - columnas nuevas al final de Productos (Alta, Bloqueado, Motivo del bloqueo), Clientes (Bloqueado,
     Motivo del bloqueo, Dispositivo, Sucursal, Punto de venta), Ventas, Pagos y CuentaCorriente;
   - la columna Alta completa en todas las filas de Productos y Clientes;
   - la pestaña **Turnos**, si existía, queda como estaba: el puente ya no escribe ahí.
```

Y documentar: bloquear = poner "Sí" en Bloqueado (motivo opcional); CuentaCorriente es el libro
completo (holds confirmados, pagos a cuenta sin hold con su signo, cobranzas en negativo); Sheets
procesa cada lote dentro del request, así que nunca informa `queued`/`processing`.

- [ ] **Step 2: Commit**

```bash
git add src/connectors/google-sheets/README.md
git commit -m "docs(sheets): redespliegue del puente para el contrato v3 (#96)"
```

---

### Task 11: Minibackend — esquema, lotes con procesamiento separado, pull v3

**Files:**
- Create: `demo-backend/src/lots.ts`, `demo-backend/test/lots.test.ts`
- Modify: `demo-backend/src/db.ts`, `demo-backend/src/routes/sync.ts`, `demo-backend/src/seed.ts`, `demo-backend/src/fixtures/products.json`, `demo-backend/src/fixtures/customers.json`, `demo-backend/test/routes/sync.test.ts`, `demo-backend/test/seed.test.ts`, `demo-backend/test/db.test.ts`

**Interfaces:**
- Produces (`lots.ts`):
  - `type LotIssue = { message: string; eventId?: string }`
  - `type BatchEvent = { type: string; id: string; createdAt?: string; origin?: { branch?: string; pointOfSale?: string } } & Record<string, unknown>`
  - `receiveLot(db, params: { id: string; deviceId: string; events: BatchEvent[] }, now: string): void` → `push_lots` con `status 'queued'` (`ON CONFLICT DO NOTHING`).
  - `startLot(db, id: string, now: string): boolean` (solo `queued` → `processing`).
  - `finishLot(db, id: string, now: string, extraIssue?: string): boolean` — aplica todos los eventos y deja `ok`, o `issues` si hubo alguno (o `extraIssue`).
  - `isDelayEnabled(db): boolean`, `setDelayEnabled(db, enabled: boolean): void` (tabla `demo_settings`).
  - `lotStatusFor(db, id): { status: string; issues?: LotIssue[] } | undefined`.
  - `listLots(db): { id; deviceId; status; eventCount; issues: LotIssue[]; createdAt }[]`.
- `db.ts`: `SCHEMA_VERSION = 3` con `PRAGMA user_version`; si difiere, borra todas las tablas y recrea (el `server.ts` resiembra solo porque `products` queda vacía).

- [ ] **Step 1: Tests que fallan** (`demo-backend/test/lots.test.ts`, usando `openDb(':memory:')` y `seedIfEmpty`)

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { finishLot, lotStatusFor, receiveLot, setDelayEnabled, isDelayEnabled, startLot } from '../src/lots.ts';
import { seedIfEmpty } from '../src/seed.ts';

const now = '2026-09-23T10:00:00.000Z';
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  db = openDb(':memory:');
  seedIfEmpty(db, now);
});

const stockOf = (id: string) => (db.prepare('SELECT quantity FROM stock WHERE product_id = ?').get(id) as { quantity: number }).quantity;
const balanceOf = (id: string) => (JSON.parse((db.prepare('SELECT payload FROM customers WHERE id = ?').get(id) as { payload: string }).payload) as { balance: number }).balance;

describe('lotes', () => {
  it('recibido queda queued y no aplica efectos hasta terminar', () => {
    receiveLot(db, { id: 'l1', deviceId: 'dev-1', events: [{ type: 'stock-movement', id: 'm1', movement: { id: 'm1', productId: 'alm-001', delta: -2.5, reason: 'sale', createdAt: now } }] }, now);
    expect(lotStatusFor(db, 'l1')).toEqual({ status: 'queued' });
    expect(stockOf('alm-001')).toBe(40);
    expect(startLot(db, 'l1', now)).toBe(true);
    expect(lotStatusFor(db, 'l1')).toEqual({ status: 'processing' });
    finishLot(db, 'l1', now);
    expect(lotStatusFor(db, 'l1')).toEqual({ status: 'ok' });
    expect(stockOf('alm-001')).toBe(37.5);
  });

  it('pago a cuenta sin hold suma al saldo (con signo); cobranza resta', () => {
    receiveLot(db, { id: 'l1', deviceId: 'd', events: [
      { type: 'sale', id: 's1', sale: { id: 's1', customerId: 'cust-02', payments: [{ method: 'account', amount: 300 }], lines: [], total: 300, status: 'closed', createdAt: now } },
      { type: 'sale', id: 's2', sale: { id: 's2', customerId: 'cust-02', payments: [{ method: 'account', amount: -100 }], lines: [], total: -100, status: 'closed', createdAt: now } },
      { type: 'customer-payment', id: 'cp1', payment: { id: 'cp1', customerId: 'cust-02', payments: [{ method: 'cash', amount: 400 }], total: 400, createdAt: now } },
    ] }, now);
    finishLot(db, 'l1', now);
    expect(balanceOf('cust-02')).toBe(1200 + 300 - 100 - 400);
  });

  it('tipo desconocido: issue con eventId, el resto se aplica', () => {
    receiveLot(db, { id: 'l1', deviceId: 'd', events: [
      { type: 'cash-session', id: 'cs1', session: {} },
      { type: 'cash-movement', id: 'm1', origin: { branch: 'Centro' }, movement: { id: 'm1', direction: 'in', amount: 10, concept: 'x', source: 'manual', createdAt: now } },
    ] }, now);
    finishLot(db, 'l1', now);
    expect(lotStatusFor(db, 'l1')).toEqual({ status: 'issues', issues: [{ message: expect.stringContaining('cash-session') as unknown, eventId: 'cs1' }] });
    expect(db.prepare('SELECT branch, device_id FROM cash_movements WHERE id = ?').get('m1')).toEqual({ branch: 'Centro', device_id: 'd' });
  });

  it('terminar con aviso agrega el texto del operador', () => {
    receiveLot(db, { id: 'l1', deviceId: 'd', events: [] }, now);
    finishLot(db, 'l1', now, 'Revisar a mano');
    expect(lotStatusFor(db, 'l1')).toEqual({ status: 'issues', issues: [{ message: 'Revisar a mano' }] });
  });

  it('la demora arranca apagada y se puede prender', () => {
    expect(isDelayEnabled(db)).toBe(false);
    setDelayEnabled(db, true);
    expect(isDelayEnabled(db)).toBe(true);
  });
});
```

En `test/routes/sync.test.ts`: `push()` manda `{ deviceId: 'dev-1', events }`; nuevo test "con demora
prendida, el lote queda queued en el pull y el stock no cambia"; "sin demora, el lote queda ok al
toque"; el pull trae `createdAt` en productos/clientes y el `blocked` del fixture; actualizar "aplica
los 7 tipos…" a los 8 tipos v3; `issues` como objetos. `test/db.test.ts`: una base con
`user_version` distinto se recrea vacía.

- [ ] **Step 2: Correr** — `pnpm test:backend` → FAIL.

- [ ] **Step 3: Implementación**

`db.ts`: cambiar el schema:

```sql
CREATE TABLE IF NOT EXISTS stock (
  product_id TEXT PRIMARY KEY,
  quantity REAL NOT NULL,
  updated_at TEXT NOT NULL
);
-- sales, sale_voids, stock_movements: sumar a cada una
--   device_id TEXT, branch TEXT, point_of_sale TEXT,
-- customers: sumar device_id TEXT, branch TEXT, point_of_sale TEXT (NULL si vino del seed)
CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY, payload TEXT NOT NULL,
  device_id TEXT, branch TEXT, point_of_sale TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_payments (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, payload TEXT NOT NULL,
  device_id TEXT, branch TEXT, point_of_sale TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_lots (
  id TEXT PRIMARY KEY, device_id TEXT, status TEXT NOT NULL, events TEXT NOT NULL,
  issues TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS demo_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

y sacar `cash_sessions`. Versionado:

```typescript
/** Subir cuando cambia el schema: una base vieja se recrea vacía (es una demo) y el arranque resiembra. */
const SCHEMA_VERSION = 3;

export function openDb(path: string): DatabaseSync {
  // …creación del directorio igual que hoy…
  const db = new DatabaseSync(path);
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version !== SCHEMA_VERSION) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const { name } of tables) {
      db.exec(`DROP TABLE IF EXISTS "${name}"`);
    }
    db.exec(`PRAGMA user_version = ${String(SCHEMA_VERSION)}`);
  }
  db.exec(SCHEMA);
  return db;
}
```

`lots.ts` (mueve `applyBatchEvent` desde `routes/sync.ts` y lo extiende):

```typescript
import type { DatabaseSync } from 'node:sqlite';

export type LotIssue = { message: string; eventId?: string };
export type BatchEvent = {
  type: string;
  id: string;
  createdAt?: string;
  origin?: { branch?: string; pointOfSale?: string };
} & Record<string, unknown>;

type Stamp = { deviceId: string; branch: string | null; pointOfSale: string | null };

type Payment = { method: string; amount: number; reference?: string };
type CustomerPayload = { id: string; balance?: number } & Record<string, unknown>;

function stampOf(deviceId: string, event: BatchEvent): Stamp {
  return { deviceId, branch: event.origin?.branch ?? null, pointOfSale: event.origin?.pointOfSale ?? null };
}

function adjustBalance(db: DatabaseSync, customerId: string, delta: number, now: string): void {
  const row = db.prepare('SELECT payload FROM customers WHERE id = ?').get(customerId) as { payload: string } | undefined;
  if (row === undefined) {
    return;
  }
  const customer = JSON.parse(row.payload) as CustomerPayload;
  if (customer.balance === undefined) {
    return; // sin cuenta corriente: la cobranza/pago queda registrada, no hay saldo que mover
  }
  db.prepare('UPDATE customers SET payload = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify({ ...customer, balance: Math.round((customer.balance + delta) * 100) / 100 }),
    now,
    customerId,
  );
}

function insertEvent(db: DatabaseSync, table: string, id: string, payload: unknown, stamp: Stamp, now: string): void {
  db.prepare(
    `INSERT INTO ${table} (id, payload, device_id, branch, point_of_sale, created_at) VALUES (?, ?, ?, ?, ?, ?) ` +
      'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
  ).run(id, JSON.stringify(payload), stamp.deviceId, stamp.branch, stamp.pointOfSale, now);
}

/** Aplica un evento; devuelve un issue si no lo reconoce. Nunca rechaza por contenido. */
function applyEvent(db: DatabaseSync, event: BatchEvent, stamp: Stamp, now: string): LotIssue | undefined {
  switch (event.type) {
    case 'sale': {
      const sale = event.sale as { id: string; customerId?: string; payments: Payment[] };
      insertEvent(db, 'sales', event.id, sale, stamp, now);
      if (sale.customerId !== undefined) {
        for (const payment of sale.payments) {
          if (payment.method === 'account' && payment.reference === undefined) {
            adjustBalance(db, sale.customerId, payment.amount, now); // fiado offline, o acreditación si es negativo
          }
        }
      }
      return undefined;
    }
    case 'stock-movement': {
      const movement = event.movement as { productId: string; delta: number };
      insertEvent(db, 'stock_movements', event.id, movement, stamp, now);
      db.prepare('UPDATE stock SET quantity = quantity + ?, updated_at = ? WHERE product_id = ?').run(movement.delta, now, movement.productId);
      return undefined;
    }
    case 'sale-void':
      db.prepare(
        'INSERT INTO sale_voids (id, sale_id, payload, device_id, branch, point_of_sale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
      ).run(event.id, String(event.saleId), JSON.stringify(event), stamp.deviceId, stamp.branch, stamp.pointOfSale, now);
      return undefined;
    case 'customer': {
      const customer = event.customer as { id: string };
      db.prepare(
        'INSERT INTO customers (id, payload, source, device_id, branch, point_of_sale, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
      ).run(customer.id, JSON.stringify(customer), 'pos', stamp.deviceId, stamp.branch, stamp.pointOfSale, now);
      return undefined;
    }
    case 'account-hold-confirm':
    case 'account-hold-release':
      // Mismo cuerpo que el `applyBatchEvent` de hoy (routes/sync.ts): moverlo tal cual.
      applyHoldEvent(db, event, now);
      return undefined;
    case 'cash-movement':
      insertEvent(db, 'cash_movements', event.id, event.movement, stamp, now);
      return undefined;
    case 'customer-payment': {
      const payment = event.payment as { customerId: string; total: number };
      db.prepare(
        'INSERT INTO customer_payments (id, customer_id, payload, device_id, branch, point_of_sale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO NOTHING',
      ).run(event.id, payment.customerId, JSON.stringify(payment), stamp.deviceId, stamp.branch, stamp.pointOfSale, now);
      adjustBalance(db, payment.customerId, -payment.total, now);
      return undefined;
    }
    default:
      return { message: `Tipo de evento desconocido para el contrato v3: ${event.type}`, eventId: event.id };
  }
}
```

`applyHoldEvent(db, event, now)`: los dos `case` de hold del `applyBatchEvent` actual de
`routes/sync.ts`, movidos sin cambios de lógica (usa `event.holdId as string`).

```typescript
export function receiveLot(db: DatabaseSync, params: { id: string; deviceId: string; events: BatchEvent[] }, now: string): void {
  db.prepare(
    'INSERT INTO push_lots (id, device_id, status, events, issues, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?) ' +
      'ON CONFLICT(id) DO NOTHING',
  ).run(params.id, params.deviceId, 'queued', JSON.stringify(params.events), now, now);
}

export function startLot(db: DatabaseSync, id: string, now: string): boolean {
  return db.prepare("UPDATE push_lots SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'queued'").run(now, id).changes > 0;
}

/** Aplica el lote y lo deja `ok` o `issues`. Solo desde `queued`/`processing`: terminar dos veces no reaplica. */
export function finishLot(db: DatabaseSync, id: string, now: string, extraIssue?: string): boolean {
  const row = db.prepare("SELECT device_id, events FROM push_lots WHERE id = ? AND status IN ('queued', 'processing')").get(id) as
    | { device_id: string | null; events: string }
    | undefined;
  if (row === undefined) {
    return false;
  }
  const issues: LotIssue[] = [];
  for (const event of JSON.parse(row.events) as BatchEvent[]) {
    const issue = applyEvent(db, event, stampOf(row.device_id ?? '', event), now);
    if (issue !== undefined) {
      issues.push(issue);
    }
  }
  if (extraIssue !== undefined && extraIssue.trim() !== '') {
    issues.push({ message: extraIssue.trim() });
  }
  db.prepare('UPDATE push_lots SET status = ?, issues = ?, updated_at = ? WHERE id = ?').run(
    issues.length > 0 ? 'issues' : 'ok',
    issues.length > 0 ? JSON.stringify(issues) : null,
    now,
    id,
  );
  return true;
}

export function lotStatusFor(db: DatabaseSync, id: string): { status: string; issues?: LotIssue[] } | undefined {
  const row = db.prepare('SELECT status, issues FROM push_lots WHERE id = ?').get(id) as { status: string; issues: string | null } | undefined;
  if (row === undefined) {
    return undefined;
  }
  return row.issues !== null ? { status: row.status, issues: JSON.parse(row.issues) as LotIssue[] } : { status: row.status };
}

export function listLots(db: DatabaseSync): { id: string; deviceId: string | null; status: string; eventCount: number; issues: LotIssue[]; createdAt: string }[] {
  const rows = db.prepare('SELECT id, device_id, status, events, issues, created_at FROM push_lots ORDER BY created_at DESC').all() as {
    id: string; device_id: string | null; status: string; events: string; issues: string | null; created_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    deviceId: row.device_id,
    status: row.status,
    eventCount: (JSON.parse(row.events) as unknown[]).length,
    issues: row.issues === null ? [] : (JSON.parse(row.issues) as LotIssue[]),
    createdAt: row.created_at,
  }));
}

export function isDelayEnabled(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT value FROM demo_settings WHERE key = 'delayLots'").get() as { value: string } | undefined;
  return row?.value === 'true';
}

export function setDelayEnabled(db: DatabaseSync, enabled: boolean): void {
  db.prepare("INSERT INTO demo_settings (key, value) VALUES ('delayLots', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(enabled));
}
```

`routes/sync.ts`: borrar `applyBatchEvent`/tipos locales; el handler de push:

```typescript
      const body = (await readJsonBody(req)) as { deviceId?: string; events: BatchEvent[] };
      const result = await withIdempotency(ctx.db, idempotencyKey, () => {
        const now = new Date().toISOString();
        receiveLot(ctx.db, { id: idempotencyKey, deviceId: body.deviceId ?? '', events: body.events }, now);
        // Sin demora (default) se procesa al toque, como antes de v3. Con demora, el lote queda
        // `queued` hasta que el operador lo avance desde el panel (/_demo).
        if (!isDelayEnabled(ctx.db)) {
          finishLot(ctx.db, idempotencyKey, now);
        }
        return { status: 200, body: {} };
      });
```

El handler de pull usa `lotStatusFor` por cada id pedido (omitiendo los desconocidos). La consistencia
foto/estados es trivial: SQLite síncrono dentro de un solo handler.

`seed.ts`: `ProductFixtureEntry`/`CustomerFixtureEntry` suman `createdAt: string` y
`blocked?: { reason: string }`; el payload guardado los incluye (ya lo hace al guardar la entrada
entera). `resetToSeed` borra también `cash_movements`, `customer_payments`, `push_lots`,
`demo_settings` y deja de borrar `cash_sessions`.

Fixtures: agregar `createdAt` a **cada** entrada, con fechas distintas entre 2025-01 y 2026-08 (por
ejemplo sumando días al índice), con un script puntual en el scratchpad (no se commitea):

```bash
node -e "for (const f of ['demo-backend/src/fixtures/products.json','demo-backend/src/fixtures/customers.json']) { const fs=require('fs'); const items=JSON.parse(fs.readFileSync(f,'utf8')); items.forEach((it,i)=>{ it.createdAt=new Date(Date.UTC(2025,0,5)+i*17*86400000).toISOString(); }); fs.writeFileSync(f, JSON.stringify(items,null,2)+'\n'); }"
```

y a mano: el último producto de almacén con `"blocked": { "reason": "Retirado por el proveedor" }` y
`cust-03` con `"blocked": { "reason": "Deuda vencida" }`. Revisar que el formato del JSON resultante
siga siendo legible (una entrada por línea como hoy es preferible; si el script lo expande, pasarlo
por `pnpm format` o reformatear a mano).

- [ ] **Step 4: Correr** — `pnpm test:backend && pnpm typecheck:backend` → PASS.

- [ ] **Step 5: Commit**

```bash
git add demo-backend
git commit -m "feat(demo-backend): contrato v3 — lotes queued/processing, efectos al procesar, identidad, alta y bloqueos (#96)"
```

---

### Task 12: Panel de demo — lote demorado, bloqueos, movimientos y cobranzas

**Files:**
- Modify: `demo-backend/src/routes/panel.ts`, `demo-backend/src/panel.html`, `demo-backend/test/routes/panel.test.ts`

**Interfaces:**
- Consumes: `listLots`, `startLot`, `finishLot`, `isDelayEnabled`, `setDelayEnabled` (Task 11).
- Produces (rutas sin auth, bajo `/_demo/api/`):
  - `GET /settings` → `{ delayLots: boolean }`; `PUT /settings` body `{ delayLots: boolean }`.
  - `GET /lots` → `listLots`; `POST /lots/:id/start`; `POST /lots/:id/finish` body `{ issue?: string }`.
  - `GET /catalog/products` → `{ id, name, createdAt, blocked? }[]`; `GET /catalog/customers` → ídem.
  - `POST /catalog/(products|customers)/:id/block` body `{ reason: string }`; `DELETE` misma ruta → desbloquea. Ambos actualizan `updated_at` (viaja en el pull por delta).
  - `GET /cash-movements`, `GET /customer-payments` → payload + `deviceId`, `branch`, `pointOfSale`.
  - `GET /sales` suma `deviceId`, `branch`, `pointOfSale` a cada venta.
  - Se va `GET /cash-sessions`.

- [ ] **Step 1: Tests que fallan** (`panel.test.ts`, mismo arranque de servidor que los tests existentes)

```typescript
it('prende la demora y avanza un lote paso a paso', async () => {
  await fetch(`${baseUrl}/_demo/api/settings`, { method: 'PUT', body: JSON.stringify({ delayLots: true }) });
  await pushLot('l1', []); // helper: POST /sync/push con auth, deviceId y eventos
  expect(await getJson('/_demo/api/lots')).toMatchObject([{ id: 'l1', status: 'queued', eventCount: 0 }]);
  await fetch(`${baseUrl}/_demo/api/lots/l1/start`, { method: 'POST' });
  expect(await getJson('/_demo/api/lots')).toMatchObject([{ status: 'processing' }]);
  await fetch(`${baseUrl}/_demo/api/lots/l1/finish`, { method: 'POST', body: JSON.stringify({ issue: 'Revisar' }) });
  expect(await getJson('/_demo/api/lots')).toMatchObject([{ status: 'issues', issues: [{ message: 'Revisar' }] }]);
});

it('bloquea y desbloquea un producto, y el pull por delta lo trae', async () => {
  const first = await pullJson({}); // helper: POST /sync/pull sin cursores
  await fetch(`${baseUrl}/_demo/api/catalog/products/alm-001/block`, { method: 'POST', body: JSON.stringify({ reason: 'Vencido' }) });
  const delta = await pullJson({ products: first.products.nextCursor });
  expect(delta.products.items).toEqual([expect.objectContaining({ id: 'alm-001', blocked: { reason: 'Vencido' } })]);
  await fetch(`${baseUrl}/_demo/api/catalog/products/alm-001/block`, { method: 'DELETE' });
  const catalog = await getJson('/_demo/api/catalog/products');
  expect(catalog.find((item: { id: string }) => item.id === 'alm-001')).not.toHaveProperty('blocked');
});

it('lista movimientos de caja y cobranzas con su identidad', async () => {
  await pushLot('l1', [
    { type: 'cash-movement', id: 'm1', createdAt: now, origin: { branch: 'Centro', pointOfSale: 'Caja 1' }, movement: { id: 'm1', direction: 'in', amount: 10, concept: 'Cambio', source: 'manual', createdAt: now } },
  ]);
  expect(await getJson('/_demo/api/cash-movements')).toEqual([expect.objectContaining({ id: 'm1', deviceId: 'dev-1', branch: 'Centro', pointOfSale: 'Caja 1' })]);
});
```

(Registrar `syncRoutes` y `panelRoutes` en el `beforeAll` del archivo; escribir los helpers
`pushLot`, `pullJson`, `getJson` arriba del bloque. Actualizar/borrar el test que use
`/_demo/api/cash-sessions`.)

- [ ] **Step 2: Correr** — `pnpm test:backend` → FAIL.

- [ ] **Step 3: Implementación — rutas** (`panel.ts`). Para leer bodies usar `readJsonBody` de
`http-helpers.ts`. Bloqueo:

```typescript
  {
    method: 'POST',
    pattern: /^\/_demo\/api\/catalog\/(?<kind>products|customers)\/(?<id>[^/]+)\/block$/,
    requiresAuth: false,
    handler: async (req, res, ctx) => {
      const body = (await readJsonBody(req)) as { reason?: string };
      setBlocked(ctx.db, ctx.params.kind === 'products' ? 'products' : 'customers', ctx.params.id ?? '', { reason: body.reason ?? '' });
      sendJson(res, 200, {});
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/_demo\/api\/catalog\/(?<kind>products|customers)\/(?<id>[^/]+)\/block$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      setBlocked(ctx.db, ctx.params.kind === 'products' ? 'products' : 'customers', ctx.params.id ?? '', undefined);
      sendJson(res, 200, {});
    },
  },
```

con

```typescript
/** Bloqueo informativo (contrato v3): toca el payload y `updated_at`, así viaja en el pull por delta. */
function setBlocked(db: DatabaseSync, table: 'products' | 'customers', id: string, blocked: { reason: string } | undefined): void {
  const row = db.prepare(`SELECT payload FROM ${table} WHERE id = ?`).get(id) as { payload: string } | undefined;
  if (row === undefined) {
    return;
  }
  const { blocked: _previous, ...rest } = JSON.parse(row.payload) as Record<string, unknown>;
  const payload = blocked === undefined ? rest : { ...rest, blocked };
  db.prepare(`UPDATE ${table} SET payload = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(payload), new Date().toISOString(), id);
}
```

Settings, lots (`listLots`, `startLot(db, id, now)`, `finishLot(db, id, now, body.issue)`), listas de
`cash_movements`/`customer_payments` (`SELECT payload, device_id, branch, point_of_sale …` →
`{ ...payload, deviceId, branch, pointOfSale }`) siguiendo el mismo formato de las rutas existentes.
Borrar la ruta de `cash-sessions`.

- [ ] **Step 4: Implementación — `panel.html`**. Reemplazar la sección "Turnos de caja cerrados" y
sumar, arriba de todo, después del botón de reset:

```html
    <section>
      <h2>Lotes de push</h2>
      <label><input type="checkbox" id="delay-lots" /> Demorar lotes nuevos (quedan en cola hasta avanzarlos a mano)</label>
      <table id="lots-table"><thead><tr><th>id</th><th>dispositivo</th><th>eventos</th><th>estado</th><th>avisos</th><th></th></tr></thead><tbody></tbody></table>
    </section>
    <section>
      <h2>Productos</h2>
      <table id="catalog-products-table"><thead><tr><th>id</th><th>nombre</th><th>alta</th><th>bloqueo</th><th></th></tr></thead><tbody></tbody></table>
    </section>
    <section>
      <h2>Clientes</h2>
      <table id="catalog-customers-table"><thead><tr><th>id</th><th>nombre</th><th>alta</th><th>bloqueo</th><th></th></tr></thead><tbody></tbody></table>
    </section>
    <section>
      <h2>Movimientos de caja</h2>
      <table id="cash-movements-table"><thead><tr><th>id</th><th>sentido</th><th>monto</th><th>concepto</th><th>origen</th><th>dispositivo</th><th>sucursal</th><th>punto de venta</th></tr></thead><tbody></tbody></table>
    </section>
    <section>
      <h2>Cobranzas</h2>
      <table id="customer-payments-table"><thead><tr><th>id</th><th>cliente</th><th>total</th><th>dispositivo</th><th>sucursal</th><th>punto de venta</th></tr></thead><tbody></tbody></table>
    </section>
```

La tabla de ventas suma columnas dispositivo/sucursal/punto de venta. Script:

```javascript
      async function post(url, body, method = 'POST') {
        await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
        refresh();
      }
      window.startLot = (id) => post(`/_demo/api/lots/${id}/start`);
      window.finishLot = (id, withIssue) => {
        const issue = withIssue ? prompt('Texto del aviso') : undefined;
        if (withIssue && issue === null) return;
        post(`/_demo/api/lots/${id}/finish`, issue ? { issue } : {});
      };
      window.block = (kind, id) => {
        const reason = prompt('Motivo del bloqueo (puede quedar vacío)');
        if (reason === null) return;
        post(`/_demo/api/catalog/${kind}/${id}/block`, { reason });
      };
      window.unblock = (kind, id) => post(`/_demo/api/catalog/${kind}/${id}/block`, undefined, 'DELETE');

      const delay = document.getElementById('delay-lots');
      delay.addEventListener('change', () => post('/_demo/api/settings', { delayLots: delay.checked }, 'PUT'));

      function lotActions(l) {
        if (l.status === 'queued') return `<button onclick="startLot('${l.id}')">Empezar</button> <button onclick="finishLot('${l.id}', false)">Terminar OK</button> <button onclick="finishLot('${l.id}', true)">Terminar con aviso</button>`;
        if (l.status === 'processing') return `<button onclick="finishLot('${l.id}', false)">Terminar OK</button> <button onclick="finishLot('${l.id}', true)">Terminar con aviso</button>`;
        return '';
      }
      function catalogRow(kind) {
        return (item) => `<tr><td>${item.id}</td><td>${item.name}</td><td>${item.createdAt ?? ''}</td><td>${item.blocked ? `Bloqueado: ${item.blocked.reason || '(sin motivo)'}` : ''}</td><td>${item.blocked ? `<button onclick="unblock('${kind}', '${item.id}')">Desbloquear</button>` : `<button onclick="block('${kind}', '${item.id}')">Bloquear</button>`}</td></tr>`;
      }
```

y en `refresh()`: cargar settings (`delay.checked = (await (await fetch('/_demo/api/settings')).json()).delayLots`),
`loadTable('/_demo/api/lots', 'lots-table', (l) => \`<tr><td>${l.id}</td><td>${l.deviceId ?? ''}</td><td>${l.eventCount}</td><td>${l.status}</td><td>${l.issues.map((i) => i.message + (i.eventId ? \` (${i.eventId})\` : '')).join('; ')}</td><td>${lotActions(l)}</td></tr>\`)`,
las dos tablas de catálogo con `catalogRow('products')`/`catalogRow('customers')`, y las de
movimientos/cobranzas. Sacar la carga de `cash-sessions`. Sumar un auto-refresh cada 3 s
(`setInterval(refresh, 3000)`) para ver los lotes llegar sin recargar.

- [ ] **Step 5: Correr** — `pnpm test:backend && pnpm typecheck:backend` → PASS.

- [ ] **Step 6: Commit**

```bash
git add demo-backend
git commit -m "feat(demo-backend): panel con lote demorado, bloqueos, movimientos de caja y cobranzas (#96)"
```

---

### Task 13: Documentación del contrato v3 y CLAUDE.md

**Files:**
- Modify: `docs/connector-api.openapi.yaml`, `CLAUDE.md`

- [ ] **Step 1: OpenAPI** — `info.version: '3.0.0'`; descripción: v3 reemplaza a v2 (resumen de los
cambios de la spec §1–§4) y la nota de transición de identidad. `x-pos-status` de push/pull/holds:
`implemented-v3`. Cambios de `components.schemas`:

```yaml
    EventOrigin:
      type: object
      required: [branch, pointOfSale]
      description: |
        Sucursal y punto de venta, texto libre, estampados al encolar el evento en el POS (no al armar
        el lote). **Transición**: obligatorios en v3, pero tolerados ausentes hasta la Etapa 2 de #94
        (#97) — un backend tiene que aceptar un `origin` vacío.
      properties:
        branch: { type: string }
        pointOfSale: { type: string }

    EventEnvelope:
      type: object
      required: [id, type, createdAt, origin]
      properties:
        id: { type: string }
        type: { type: string }
        createdAt: { type: string, format: date-time }
        origin: { $ref: '#/components/schemas/EventOrigin' }

    Blocked:
      type: object
      required: [reason]
      description: Bloqueo informativo — nunca impide operar; el POS lo muestra y el usuario decide. `reason` puede ser vacío.
      properties:
        reason: { type: string }

    CashMovement:
      type: object
      required: [id, direction, amount, concept, source, createdAt]
      properties:
        id: { type: string }
        direction: { type: string, enum: [in, out] }
        amount: { type: number, exclusiveMinimum: 0 }
        concept: { type: string }
        description: { type: string }
        source: { type: string, enum: [manual, count-adjustment] }
        count:
          type: object
          required: [expected, counted]
          description: Obligatorio si source = count-adjustment. Un arqueo con diferencia 0 no viaja.
          properties:
            expected: { type: number }
            counted: { type: number }
        createdAt: { type: string, format: date-time }

    CustomerPayment:
      type: object
      required: [id, customerId, payments, total, createdAt]
      properties:
        id: { type: string }
        customerId: { type: string }
        payments: { type: array, items: { $ref: '#/components/schemas/Payment' }, description: 'method != account, amount > 0' }
        total: { type: number }
        createdAt: { type: string, format: date-time }

    LotIssue:
      type: object
      required: [message]
      properties:
        message: { type: string }
        eventId: { type: string, description: Id del evento del lote al que se refiere el aviso. }

    BatchLotStatus:
      oneOf:
        - { type: object, required: [status], properties: { status: { type: string, enum: [queued] } } }
        - { type: object, required: [status], properties: { status: { type: string, enum: [processing] } } }
        - { type: object, required: [status], properties: { status: { type: string, enum: [ok] } } }
        - type: object
          required: [status, issues]
          properties:
            status: { type: string, enum: [issues] }
            issues: { type: array, items: { $ref: '#/components/schemas/LotIssue' } }
```

- Cada `*Event` pasa a `allOf: [{ $ref: EventEnvelope }, { …payload… }]`; se suman
  `CashMovementEvent` (`movement`) y `CustomerPaymentEvent` (`payment`); se borran `CashSession` y
  `CashSessionEvent`; `OutboxBatchItem.oneOf` lista los 8.
- `Product` y `Customer`: `createdAt` requerido, `blocked: { $ref: Blocked }`.
- `PushBatchRequest.required: [deviceId, events]`, `PullBatchRequest.required: [deviceId, cursors, pendingLotIds]`.
- Descripciones: `SaleLine.qty`/`StockMovement.delta`/`StockItem.quantity` con signo, hasta 3
  decimales; `Sale.total` puede ser ≤ 0; `Payment.amount` con signo, 2 decimales; pago `account` sin
  `reference` = fiado offline (positivo) o acreditación (negativo, nunca con hold).
- `/sync/pull`: la regla de aplicación del POS se reescribe a los estados v3 (lote no informado =
  `processing`; en esta versión del POS, `queued`/`processing` descartan el pull entero; la Etapa 3
  la refina) y "foto y estados del mismo instante".
- `/sync/push`: el backend puede dejar un lote `queued`/`processing` y resolverlo después; un tipo de
  evento desconocido se informa como `LotIssue` con `eventId`, nunca como error del push.

- [ ] **Step 2: CLAUDE.md** — actualizar:
  - "Patrón outbox": `origin` estampado al encolar, `deviceId` por request, estados
    `queued`/`processing`/`ok`/`issues` (con la regla de Etapa 1 = descarte), `LotIssue`, `cash-session`
    legado excluido en `listPendingOutbox`.
  - "Connector API": contrato v3, 8 tipos de evento, `cash-movement`/`customer-payment` sin UI todavía
    (Etapas 5/6), bloqueos y `createdAt` en el pull, puerto con `PushBatch`/`PullBatchParams.deviceId`,
    schemas compartidos en `sync/connector.ts`.
  - "Utilidades de consola": sacar "se suma cuando exista" y documentar `pos.deviceId()`.
  - `/CONFIG`: Sucursal y Punto de venta opcionales (obligatorios desde la Etapa 2).
  - Minibackend: procesamiento separado de la recepción, panel con demora/bloqueos, `SCHEMA_VERSION`.
  - Sheets: pestañas/columnas nuevas, `ensureColumns`, libro de CuentaCorriente.
  - "Estado del proyecto": entrada nueva para la Etapa 1 de #94.

- [ ] **Step 3: Commit**

```bash
git add docs/connector-api.openapi.yaml CLAUDE.md
git commit -m "docs: contrato del Connector API v3 y CLAUDE.md (#96)"
```

---

### Task 14: e2e y verificación completa

**Files:**
- Modify: `e2e/cash-session.spec.ts` (y cualquier spec que falle por los cambios)

- [ ] **Step 1:** En `e2e/cash-session.spec.ts`, el test "…cerrarlo con arqueo y encolar el evento de
  outbox" pasa a "…cerrarlo con arqueo" y verifica que **no** hay evento `cash-session` en el outbox:

```typescript
  const outboxEvents = await getAllFromStore<StoredOutboxEvent>(page, 'outbox');
  // Contrato v3 (#96): el turno local sigue hasta la Etapa 5, pero ya no viaja.
  expect(outboxEvents.some((event) => event.type === 'cash-session')).toBe(false);
```

- [ ] **Step 2: Verificación completa**

Run, en orden, y leer la salida de cada uno:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:backend
pnpm typecheck:backend
pnpm build
pnpm test:e2e
```

Expected: todo en verde. Si `minibackend-sync.spec.ts` u otro e2e contra el minibackend falla por el
schema (base SQLite vieja), confirmar que `openDb` recrea con `SCHEMA_VERSION` y que el spec arranca
de una base limpia.

- [ ] **Step 3: Commit**

```bash
git add e2e
git commit -m "test(e2e): el cierre de turno ya no encola cash-session (#96)"
```

---

## Prueba en el navegador (se entrega al final, no es una task de código)

Levantar `pnpm dev` (app + minibackend). Pasos a documentar en el reporte final:

1. `/CONFIG` → tipo "REST (minibackend de demo)", URL del minibackend, Sucursal "Centro", Punto de
   venta "Caja 1" → Ctrl+Enter. `/DIAGNOSTICO` muestra "Dispositivo: <uuid>"; `pos.deviceId()` en
   DevTools devuelve lo mismo.
2. `@` → los clientes muestran "Alta: <fecha>" con fechas distintas y reales (no la de hoy).
3. Panel `/_demo` → Productos → Bloquear "Arroz 1kg" con motivo. En el POS, `/SINCRONIZAR`. En
   DevTools → Application → IndexedDB → `offline-pos` → `products`, el producto tiene
   `blocked: { reason }`. (La UI de bloqueos llega en la Etapa 4.)
4. Panel → prender "Demorar lotes nuevos". En el POS, `/CAJA` (abrir turno si hace falta), vender algo
   y cobrar. Esperar el push (o `/SINCRONIZAR`). En el panel aparece el lote `queued` con el
   dispositivo. `/DIAGNOSTICO` → lote en espera "en cola", último pull descartado (`sync/pending-lot`,
   informativo). Panel → Empezar → `/SINCRONIZAR` → "procesando". Panel → Terminar con aviso
   ("Revisar a mano") → `/SINCRONIZAR` → el lote sale de la espera y el aviso se ve en `/DIAGNOSTICO`;
   el stock del producto vendido bajó en el panel/pull.
5. En la tabla de ventas del panel se ven dispositivo, sucursal "Centro" y punto de venta "Caja 1".

**No verificable en el navegador en esta etapa**: `cash-movement` y `customer-payment` (sin UI hasta
las Etapas 5 y 6). Verificación: tests de `lots.test.ts`/`panel.test.ts` y `bridge.test.ts`, más un
`curl` de ejemplo contra el minibackend:

```bash
curl -s -X POST http://localhost:4000/sync/push -H "Authorization: Bearer demo-token" -H "Content-Type: application/json" -H "Idempotency-Key: curl-lot-1" -d "{\"deviceId\":\"curl\",\"events\":[{\"type\":\"cash-movement\",\"id\":\"m-curl\",\"createdAt\":\"2026-09-23T10:00:00.000Z\",\"origin\":{\"branch\":\"Centro\",\"pointOfSale\":\"Caja 1\"},\"movement\":{\"id\":\"m-curl\",\"direction\":\"out\",\"amount\":150,\"concept\":\"Flete\",\"source\":\"manual\",\"createdAt\":\"2026-09-23T10:00:00.000Z\"}}]}"
```

(Confirmar el puerto y el token reales del minibackend en `demo-backend/src/server.ts` y
`router.ts` antes de documentarlo.)

**Sheets**: pasos de redespliegue del README (Task 10) y prueba contra una planilla real — sincronizar,
ver columnas nuevas y Alta completada, bloquear un producto con "Sí" y verlo en IndexedDB tras
`/SINCRONIZAR`, vender y ver Dispositivo/Sucursal/Punto de venta en Ventas y Pagos.
