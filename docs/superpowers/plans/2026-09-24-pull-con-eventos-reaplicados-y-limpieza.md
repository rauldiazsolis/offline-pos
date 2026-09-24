# Pull con eventos reaplicados y limpieza a 7 días — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el pull aplique siempre datos maestros y bloqueos, reaplique sobre stock y saldo del
backend los eventos que el backend todavía no refleja (lotes `queued` y pendientes nunca enviados),
retenga stock y saldo mientras haya un lote `processing`, recupere el ack perdido del lote en curso, y
que la terminal borre lo sincronizado con más de 7 días.

**Architecture:** Tres funciones puras nuevas deciden todo (`domain/reapply.ts`: efectos por evento;
`sync/pull-rule.ts`: clasificación de lotes; `sync/pull-adjust.ts`: stock y saldos ajustados antes de
aplicar) y una más para la limpieza (`domain/local-cleanup.ts`). `storage/apply-pull.ts` y
`storage/local-cleanup.ts` las ejecutan en una transacción Dexie; `sync/engine.ts` orquesta y
`sync/cleanup-schedule.ts` fija la cadencia de 24 h. La UI (barra de estado, `/DIAGNOSTICO`,
`pos.status()`) lee un signal nuevo y el registro de la última limpieza.

**Tech Stack:** TypeScript estricto, Preact + `@preact/signals`, Dexie, Vitest (+ `fake-indexeddb`),
Testing Library, minibackend Node (`node:sqlite`).

**Spec:** `docs/superpowers/specs/2026-09-24-pull-con-eventos-reaplicados-y-limpieza-design.md`

## Global Constraints

- `any` prohibido; `unknown` solo en el borde con validación Zod inmediata (CLAUDE.md).
- Funciones de negocio devuelven `Result<T>`, nunca lanzan; `try/catch` solo en adaptadores (Dexie).
- Todo `ErrorCode` nuevo se traduce en `ui/errors.ts` (switch exhaustivo); un código que deja de
  usarse se saca de `ErrorMeta`.
- `domain/` no importa `ui/`, `storage/` ni `sync/`.
- Redondeo: cantidades a 3 decimales, importes a 2.
- Claves de `localStorage` siempre bajo el prefijo `offline-pos:`.
- Contrato del Connector API sigue en versión 3.0.0 (solo se precisa semántica).
- Comandos de verificación locales: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm test:backend`,
  `pnpm build`, `pnpm test:e2e`. No esperar ni leer CI de GitHub.
- Mensajes de commit en español, formato `tipo(ámbito): descripción (#98)`, terminando con
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/domain/reapply.ts` (+ test) | Crear | Efectos de stock/saldo de un conjunto de eventos, deduplicados y redondeados. |
| `src/domain/push-lot.ts` (+ test) | Modificar | `PushLot.notReceivedAt` y `markLotNotReceived`. |
| `src/sync/push-lot.ts` (+ test) | Modificar | `AwaitingLot.eventIds`. |
| `src/sync/pull-rule.ts` (+ test) | Crear | Clasificar lotes informados; tipo `PullApplication`. |
| `src/sync/pull-adjust.ts` (+ test) | Crear | Stock y clientes ajustados (reaplicación o retención) antes de aplicar. |
| `src/storage/apply-pull.ts` (+ test) | Crear | Aplicar un pull (delta o foto) en una transacción, leyendo el outbox adentro. |
| `src/storage/reconcile.ts` (+ test) | Modificar | Sacar `reconcileSnapshot` (queda sin uso); tests sobre `applySnapshotReconciled`. |
| `src/sync/engine.ts` (+ test) | Modificar | `pendingLotIds` con el lote en curso, ack recuperado, cursores, `PullApplication`, disparo de limpieza. |
| `src/domain/result.ts`, `src/ui/errors.ts` (+ test) | Modificar | Sacar `sync/pending-lot`; sumar `storage/cleanup-failed`. |
| `src/ui/state/sync.ts` | Modificar | `lastPullApplicationSignal`; `SyncLogEntry.application`. |
| `src/ui/components/StatusBar.tsx` (+ test) | Modificar | Sufijo "stock y saldos en espera del backend". |
| `src/ui/format-lot.ts` (+ test) | Modificar | Textos de aplicación del pull, lotes con eventos y limpieza. |
| `src/sync/diagnostics.ts` | Modificar | Suma `lastPullApplication` y `lastCleanup`. |
| `src/ui/screens/diagnostico-screen.tsx` (+ test) | Modificar | Lote en curso no recibido, aplicación del pull, sección Limpieza. |
| `src/ui/console/pos-console.ts` (+ test) | Modificar | Mismos datos en `pos.status()`. |
| `src/domain/local-cleanup.ts` (+ test) | Crear | Qué borrar (regla de 7 días, ancla, protegidos). |
| `src/storage/local-cleanup.ts` (+ test) | Crear | Leer candidatos y borrar en una transacción. |
| `src/sync/cleanup-schedule.ts` (+ test) | Crear | Cadencia de 24 h, cerrojo, registro de la última limpieza. |
| `demo-backend/test/routes/sync.test.ts` | Modificar | Documentar: un cambio de saldo mueve el cursor del cliente. |
| `docs/connector-api.openapi.yaml` | Modificar | Semántica de §3 del spec. |
| `src/connectors/google-sheets/README.md` | Modificar | Una línea sobre la consistencia. |
| `CLAUDE.md` | Modificar | Patrón outbox, Connector API, barra de estado, estado del proyecto. |

---

### Task 1: Efectos reaplicables por evento (`domain/reapply.ts`)

**Files:**
- Create: `src/domain/reapply.ts`
- Test: `src/domain/reapply.test.ts`

**Interfaces:**
- Consumes: `OutboxEvent` (`src/domain/outbox.ts`).
- Produces:
  ```ts
  export type ReapplyEffects = {
    stock: ReadonlyMap<string, number>;   // productId → delta
    balance: ReadonlyMap<string, number>; // customerId → delta
  };
  export function reapplyEffects(events: readonly OutboxEvent[]): ReapplyEffects;
  export function roundQuantity(value: number): number; // 3 decimales
  export function roundAmount(value: number): number;   // 2 decimales
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/reapply.test.ts
import { describe, expect, it } from 'vitest';
import type { OutboxEvent } from './outbox.ts';
import type { Sale } from './sale.ts';
import { reapplyEffects, roundAmount, roundQuantity } from './reapply.ts';

const now = '2026-09-24T10:00:00.000Z';
const envelope = { status: 'pending' as const, createdAt: now };

function sale(id: string, overrides: Partial<Sale> = {}): Sale {
  return { id, lines: [], payments: [], total: 0, status: 'closed', createdAt: now, ...overrides };
}

describe('reapplyEffects', () => {
  it('un stock-movement suma su delta al producto', () => {
    const events: OutboxEvent[] = [
      { ...envelope, id: 'm1', type: 'stock-movement', movement: { id: 'm1', productId: 'p1', delta: -2, reason: 'sale', saleId: 's1', createdAt: now } },
      { ...envelope, id: 'm2', type: 'stock-movement', movement: { id: 'm2', productId: 'p1', delta: 0.5, reason: 'sale-void', saleId: 's1', createdAt: now } },
    ];
    expect(reapplyEffects(events).stock).toEqual(new Map([['p1', -1.5]]));
  });

  it('una venta suma al saldo cada pago a cuenta, con o sin hold, e ignora los demás medios', () => {
    const events: OutboxEvent[] = [
      {
        ...envelope,
        id: 's1',
        type: 'sale',
        sale: sale('s1', {
          customerId: 'c1',
          payments: [
            { method: 'account', amount: 100 },
            { method: 'account', amount: 50, reference: 'hold-1' },
            { method: 'cash', amount: 30 },
          ],
        }),
      },
    ];
    const effects = reapplyEffects(events);
    expect(effects.balance).toEqual(new Map([['c1', 150]]));
    expect(effects.stock.size).toBe(0);
  });

  it('una venta sin cliente no mueve ningún saldo', () => {
    const events: OutboxEvent[] = [{ ...envelope, id: 's1', type: 'sale', sale: sale('s1') }];
    expect(reapplyEffects(events).balance.size).toBe(0);
  });

  it('una cobranza resta su total del saldo del cliente', () => {
    const events: OutboxEvent[] = [
      {
        ...envelope,
        id: 'cp1',
        type: 'customer-payment',
        payment: { id: 'cp1', customerId: 'c1', payments: [{ method: 'cash', amount: 40 }], total: 40, createdAt: now },
      },
    ];
    expect(reapplyEffects(events).balance).toEqual(new Map([['c1', -40]]));
  });

  it('anulación, cliente, holds y movimientos de caja no mueven stock ni saldo', () => {
    const events: OutboxEvent[] = [
      { ...envelope, id: 'v1', type: 'sale-void', saleId: 's1', voidedAt: now },
      { ...envelope, id: 'c1', type: 'customer', customer: { id: 'c1', name: 'Ana', createdAt: now } },
      { ...envelope, id: 'h1', type: 'account-hold-confirm', holdId: 'hold-1', saleId: 's1' },
      { ...envelope, id: 'h2', type: 'account-hold-release', holdId: 'hold-2' },
      {
        ...envelope,
        id: 'cm1',
        type: 'cash-movement',
        movement: { id: 'cm1', direction: 'in', amount: 10, concept: 'x', source: 'manual', createdAt: now },
      },
    ];
    const effects = reapplyEffects(events);
    expect(effects.stock.size).toBe(0);
    expect(effects.balance.size).toBe(0);
  });

  it('un evento repetido (mismo id) cuenta una sola vez', () => {
    const movement: OutboxEvent = {
      ...envelope,
      id: 'm1',
      type: 'stock-movement',
      movement: { id: 'm1', productId: 'p1', delta: -1, reason: 'sale', createdAt: now },
    };
    expect(reapplyEffects([movement, { ...movement, status: 'synced' }]).stock).toEqual(
      new Map([['p1', -1]]),
    );
  });

  it('redondea cantidades a 3 decimales e importes a 2', () => {
    const events: OutboxEvent[] = [
      { ...envelope, id: 'm1', type: 'stock-movement', movement: { id: 'm1', productId: 'p1', delta: 0.1, reason: 'sale', createdAt: now } },
      { ...envelope, id: 'm2', type: 'stock-movement', movement: { id: 'm2', productId: 'p1', delta: 0.2, reason: 'sale', createdAt: now } },
      { ...envelope, id: 's1', type: 'sale', sale: sale('s1', { customerId: 'c1', payments: [{ method: 'account', amount: 0.1 }, { method: 'account', amount: 0.2 }] }) },
    ];
    const effects = reapplyEffects(events);
    expect(effects.stock.get('p1')).toBe(0.3);
    expect(effects.balance.get('c1')).toBe(0.3);
    expect(roundQuantity(1.23456)).toBe(1.235);
    expect(roundAmount(1.005 + 0.001)).toBe(1.01);
  });
});
```

Antes de correr, verificá los campos reales de `CashMovement` (`src/domain/cash-movement.ts`),
`CustomerPayment` (`src/domain/customer-payment.ts`) y `Customer` (`src/domain/customer.ts`) y ajustá
los literales del test si algún campo obligatorio difiere (no cambies los tipos del dominio).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/domain/reapply.test.ts`
Expected: FAIL — `Failed to resolve import "./reapply.ts"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/reapply.ts
import type { OutboxEvent } from './outbox.ts';

/**
 * Efectos sobre stock y saldo de un conjunto de eventos del outbox, para
 * reaplicarlos encima de la foto del backend (Etapa 3 de #94, #98): los
 * eventos que el backend todavía no refleja (lotes `queued`, lote en curso
 * no recibido, pendientes nunca enviados). Espeja lo que hace el backend al
 * procesar un lote y lo que hace el POS al cerrar una venta
 * (`storage/sale-repository.ts`). Deduplica por id de evento.
 */
export type ReapplyEffects = {
  stock: ReadonlyMap<string, number>;
  balance: ReadonlyMap<string, number>;
};

export function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

function add(map: Map<string, number>, key: string, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function rounded(map: Map<string, number>, round: (value: number) => number): Map<string, number> {
  return new Map([...map].map(([key, value]) => [key, round(value)]));
}

export function reapplyEffects(events: readonly OutboxEvent[]): ReapplyEffects {
  const stock = new Map<string, number>();
  const balance = new Map<string, number>();
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    switch (event.type) {
      case 'stock-movement':
        add(stock, event.movement.productId, event.movement.delta);
        break;
      case 'sale': {
        const customerId = event.sale.customerId;
        if (customerId === undefined) {
          break;
        }
        // Con o sin hold: el monto de un hold confirmado ya es el del pago (mismo lote).
        for (const payment of event.sale.payments) {
          if (payment.method === 'account') {
            add(balance, customerId, payment.amount);
          }
        }
        break;
      }
      case 'customer-payment':
        add(balance, event.payment.customerId, -event.payment.total);
        break;
      case 'sale-void':
      case 'customer':
      case 'account-hold-confirm':
      case 'account-hold-release':
      case 'cash-movement':
        break;
      default: {
        // Un tipo que el contrato ya no tiene (p. ej. `cash-session`) no mueve stock ni saldo.
        const legacy: never = event;
        void legacy;
      }
    }
  }
  return { stock: rounded(stock, roundQuantity), balance: rounded(balance, roundAmount) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/domain/reapply.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/reapply.ts src/domain/reapply.test.ts
git commit -m "feat(domain): efectos de stock y saldo a reaplicar sobre la foto (#98)"
```

---

### Task 2: Lotes que recuerdan sus eventos

**Files:**
- Modify: `src/domain/push-lot.ts` (tipo `PushLot`, función nueva)
- Modify: `src/sync/push-lot.ts:39-40` (`AwaitingLot`)
- Modify: `src/sync/engine.ts:188` (`addAwaitingLot` en `pushPendingLot`)
- Test: `src/domain/push-lot.test.ts`, `src/sync/push-lot.test.ts`, `src/sync/engine.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // domain/push-lot.ts
  export type PushLot = { …campos actuales…; notReceivedAt?: string };
  export function markLotNotReceived(lot: PushLot, now: string): PushLot;
  // sync/push-lot.ts
  export type AwaitingLot = {
    id: string;
    sentAt: string;
    lastStatus?: 'queued' | 'processing';
    /** Ausente en lotes guardados antes de la Etapa 3 (#98). */
    eventIds?: string[];
  };
  ```

- [ ] **Step 1: Write the failing tests**

En `src/domain/push-lot.test.ts`, agregar:

```ts
import { buildPushLot, markLotFailed, markLotNotReceived } from './push-lot.ts';

describe('markLotNotReceived', () => {
  it('anota cuándo el backend informó que no recibió el lote, sin tocar id ni eventos', () => {
    const lot = buildPushLot(['e1', 'e2'], { id: 'lot-1', now: '2026-09-24T10:00:00.000Z' });
    const marked = markLotNotReceived(lot, '2026-09-24T10:05:00.000Z');
    expect(marked).toEqual({ ...lot, notReceivedAt: '2026-09-24T10:05:00.000Z' });
  });

  it('un reintento fallido conserva la marca', () => {
    const lot = markLotNotReceived(
      buildPushLot(['e1'], { id: 'lot-1', now: '2026-09-24T10:00:00.000Z' }),
      '2026-09-24T10:05:00.000Z',
    );
    expect(markLotFailed(lot, { now: '2026-09-24T10:06:00.000Z', error: 'x' }).notReceivedAt).toBe(
      '2026-09-24T10:05:00.000Z',
    );
  });
});
```

(Si el archivo ya importa `buildPushLot`/`markLotFailed`, sumá solo `markLotNotReceived` al import.)

En `src/sync/push-lot.test.ts`, agregar:

```ts
it('updateAwaitingLots conserva los eventIds de cada lote', () => {
  addAwaitingLot({ id: 'lot-1', sentAt: '2026-09-24T10:00:00.000Z', eventIds: ['e1', 'e2'] });
  updateAwaitingLots(new Set(), { 'lot-1': 'queued' });
  expect(getAwaitingLots()).toEqual([
    { id: 'lot-1', sentAt: '2026-09-24T10:00:00.000Z', eventIds: ['e1', 'e2'], lastStatus: 'queued' },
  ]);
});
```

En `src/sync/engine.test.ts`, reemplazar el cuerpo del test `'tras el ack, agrega el lote a la lista de espera de resolución'` (línea ~155) para que espere los `eventIds`:

```ts
it('tras el ack, agrega el lote a la lista de espera con sus eventos', async () => {
  await db.outbox.add(buildOutboxEventForSale(sale, { now, origin: { branch: 'b', pointOfSale: 'p' } }));
  await pushPendingLot(fakeConnector(), now);
  const awaiting = getAwaitingLots();
  expect(awaiting).toHaveLength(1);
  expect(awaiting[0]?.eventIds).toEqual(['sale-1']);
});
```

(Usá el mismo armado de evento que ya usa el test original que reemplazás; si importa otro builder,
conservalo — lo que cambia es la aserción sobre `eventIds`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/domain/push-lot.test.ts src/sync/push-lot.test.ts src/sync/engine.test.ts`
Expected: FAIL — `markLotNotReceived` no existe; `eventIds` ausente en el lote en espera; error de
tipos en `AwaitingLot`.

- [ ] **Step 3: Implement**

En `src/domain/push-lot.ts`, sumar al tipo `PushLot` (después de `lastError?`):

```ts
  /**
   * Un pull informó que el backend no conoce este lote (Etapa 3, #98): nunca
   * llegó. Solo para `/DIAGNOSTICO`; el lote se reintenta igual.
   */
  notReceivedAt?: string;
```

y al final del archivo:

```ts
/** Marca que el backend, consultado en un pull, no conoce este lote (#98). El id y los eventIds no cambian. */
export function markLotNotReceived(lot: PushLot, now: string): PushLot {
  return { ...lot, notReceivedAt: now };
}
```

En `src/sync/push-lot.ts`, reemplazar el tipo:

```ts
/**
 * `lastStatus`: último estado en curso que informó el backend (contrato v3); ausente = sin informar.
 * `eventIds`: los eventos exactos del lote, para reaplicarlos mientras esté `queued` (#98) y para
 * que la limpieza no los borre; ausente en lotes guardados antes de la Etapa 3.
 */
export type AwaitingLot = {
  id: string;
  sentAt: string;
  lastStatus?: 'queued' | 'processing';
  eventIds?: string[];
};
```

En `src/sync/engine.ts::pushPendingLot`, reemplazar `addAwaitingLot({ id: lot.id, sentAt: now });` por:

```ts
    addAwaitingLot({ id: lot.id, sentAt: now, eventIds: lot.eventIds });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/domain/push-lot.test.ts src/sync/push-lot.test.ts src/sync/engine.test.ts`
Expected: PASS. Si algún test existente de `engine.test.ts` compara `getAwaitingLots()` con
`toEqual([{ id, sentAt }])` después de un push real, actualizalo sumando `eventIds` (los tests que
arman el lote a mano con `addAwaitingLot` no cambian).

- [ ] **Step 5: Commit**

```bash
git add src/domain/push-lot.ts src/domain/push-lot.test.ts src/sync/push-lot.ts src/sync/push-lot.test.ts src/sync/engine.ts src/sync/engine.test.ts
git commit -m "feat(sync): los lotes en espera recuerdan sus eventos (#98)"
```

---

### Task 3: Clasificación de lotes informados (`sync/pull-rule.ts`)

**Files:**
- Create: `src/sync/pull-rule.ts`
- Test: `src/sync/pull-rule.test.ts`

**Interfaces:**
- Consumes: `AwaitingLot` (Task 2), `PushLot` (Task 2), `BatchLotStatus`, `LotIssue` (`src/sync/connector.ts`).
- Produces:
  ```ts
  export type PullApplication =
    | { kind: 'applied' }
    | { kind: 'reapplied'; events: number }
    | { kind: 'retained'; lotIds: string[] };

  export type LotClassification = {
    resolvedIds: Set<string>;
    inProgress: Record<string, 'queued' | 'processing'>;
    issues: LotIssue[];
    recoveredLot: AwaitingLot | undefined;
    currentLotNotReceived: boolean;
    retainingLotIds: string[];
    queuedEventIds: string[];
  };

  export function classifyLots(params: {
    awaiting: readonly AwaitingLot[];
    currentLot: PushLot | undefined;
    reported: Readonly<Record<string, BatchLotStatus>>;
  }): LotClassification;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/sync/pull-rule.test.ts
import { describe, expect, it } from 'vitest';
import { buildPushLot } from '../domain/push-lot.ts';
import { classifyLots } from './pull-rule.ts';

const sentAt = '2026-09-24T10:00:00.000Z';
const currentLot = buildPushLot(['e9'], { id: 'cur', now: sentAt });

describe('classifyLots', () => {
  it('ok e issues resuelven el lote y juntan los avisos', () => {
    const result = classifyLots({
      awaiting: [
        { id: 'a', sentAt, eventIds: ['e1'] },
        { id: 'b', sentAt, eventIds: ['e2'] },
      ],
      currentLot: undefined,
      reported: { a: { status: 'ok' }, b: { status: 'issues', issues: [{ message: 'x', eventId: 'e2' }] } },
    });
    expect(result.resolvedIds).toEqual(new Set(['a', 'b']));
    expect(result.issues).toEqual([{ message: 'x', eventId: 'e2' }]);
    expect(result.retainingLotIds).toEqual([]);
    expect(result.queuedEventIds).toEqual([]);
  });

  it('queued reaplica sus eventos y guarda el estado', () => {
    const result = classifyLots({
      awaiting: [{ id: 'a', sentAt, eventIds: ['e1', 'e2'] }],
      currentLot: undefined,
      reported: { a: { status: 'queued' } },
    });
    expect(result.queuedEventIds).toEqual(['e1', 'e2']);
    expect(result.inProgress).toEqual({ a: 'queued' });
    expect(result.retainingLotIds).toEqual([]);
  });

  it('processing retiene', () => {
    const result = classifyLots({
      awaiting: [{ id: 'a', sentAt, eventIds: ['e1'] }],
      currentLot: undefined,
      reported: { a: { status: 'processing' } },
    });
    expect(result.retainingLotIds).toEqual(['a']);
    expect(result.inProgress).toEqual({ a: 'processing' });
    expect(result.queuedEventIds).toEqual([]);
  });

  it('un lote con ack no informado retiene (contrato v3)', () => {
    const result = classifyLots({
      awaiting: [{ id: 'a', sentAt, eventIds: ['e1'] }],
      currentLot: undefined,
      reported: {},
    });
    expect(result.retainingLotIds).toEqual(['a']);
    expect(result.inProgress).toEqual({});
  });

  it('un lote queued guardado antes de la Etapa 3 (sin eventIds) retiene', () => {
    const result = classifyLots({
      awaiting: [{ id: 'a', sentAt }],
      currentLot: undefined,
      reported: { a: { status: 'queued' } },
    });
    expect(result.retainingLotIds).toEqual(['a']);
    expect(result.inProgress).toEqual({ a: 'queued' });
  });

  it('el lote en curso no informado: no recibido, sin retener ni recuperar', () => {
    const result = classifyLots({ awaiting: [], currentLot, reported: {} });
    expect(result.currentLotNotReceived).toBe(true);
    expect(result.recoveredLot).toBeUndefined();
    expect(result.retainingLotIds).toEqual([]);
  });

  it('el lote en curso informado se recupera como lote en espera y se clasifica por su estado', () => {
    const queued = classifyLots({ awaiting: [], currentLot, reported: { cur: { status: 'queued' } } });
    expect(queued.recoveredLot).toEqual({ id: 'cur', sentAt, eventIds: ['e9'] });
    expect(queued.currentLotNotReceived).toBe(false);
    expect(queued.queuedEventIds).toEqual(['e9']);

    const processing = classifyLots({ awaiting: [], currentLot, reported: { cur: { status: 'processing' } } });
    expect(processing.retainingLotIds).toEqual(['cur']);

    const done = classifyLots({ awaiting: [], currentLot, reported: { cur: { status: 'ok' } } });
    expect(done.resolvedIds).toEqual(new Set(['cur']));
  });

  it('un lote que retiene no impide juntar los eventos de otro en cola', () => {
    const result = classifyLots({
      awaiting: [
        { id: 'a', sentAt, eventIds: ['e1'] },
        { id: 'b', sentAt, eventIds: ['e2'] },
      ],
      currentLot: undefined,
      reported: { a: { status: 'processing' }, b: { status: 'queued' } },
    });
    expect(result.retainingLotIds).toEqual(['a']);
    expect(result.queuedEventIds).toEqual(['e2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/sync/pull-rule.test.ts`
Expected: FAIL — no se resuelve `./pull-rule.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/sync/pull-rule.ts
import type { PushLot } from '../domain/push-lot.ts';
import type { BatchLotStatus, LotIssue } from './connector.ts';
import type { AwaitingLot } from './push-lot.ts';

/** Cómo se aplicó un pull exitoso (Etapa 3 de #94, #98) — para la barra de estado y `/DIAGNOSTICO`. */
export type PullApplication =
  | { kind: 'applied' }
  | { kind: 'reapplied'; events: number }
  | { kind: 'retained'; lotIds: string[] };

export type LotClassification = {
  /** Lotes `ok`/`issues`: salen de la lista de espera. */
  resolvedIds: Set<string>;
  /** Último estado en curso informado, para guardarlo en la lista de espera. */
  inProgress: Record<string, 'queued' | 'processing'>;
  issues: LotIssue[];
  /** El lote en curso vino informado: el backend lo recibió aunque el ack se perdió. */
  recoveredLot: AwaitingLot | undefined;
  /** Había lote en curso y el backend no lo conoce: nunca llegó. */
  currentLotNotReceived: boolean;
  /** Lotes por los que se retienen stock y saldo (`processing`, con ack no informado, o `queued` sin `eventIds`). */
  retainingLotIds: string[];
  /** Eventos de lotes `queued` a reaplicar; los pendientes del outbox se leen aparte. */
  queuedEventIds: string[];
};

/**
 * Regla del pull (spec de #98, §1). Pura: el motor aplica lo que decide acá.
 * El lote en curso viaja en `pendingLotIds`; si el backend lo informa se lo
 * trata como un lote en espera más (ack recuperado), si no, como no recibido.
 */
export function classifyLots(params: {
  awaiting: readonly AwaitingLot[];
  currentLot: PushLot | undefined;
  reported: Readonly<Record<string, BatchLotStatus>>;
}): LotClassification {
  const { currentLot, reported } = params;
  const recoveredLot: AwaitingLot | undefined =
    currentLot !== undefined && reported[currentLot.id] !== undefined
      ? { id: currentLot.id, sentAt: currentLot.createdAt, eventIds: currentLot.eventIds }
      : undefined;

  const result: LotClassification = {
    resolvedIds: new Set(),
    inProgress: {},
    issues: [],
    recoveredLot,
    currentLotNotReceived: currentLot !== undefined && recoveredLot === undefined,
    retainingLotIds: [],
    queuedEventIds: [],
  };

  const lots = recoveredLot !== undefined ? [...params.awaiting, recoveredLot] : params.awaiting;
  for (const lot of lots) {
    const status = reported[lot.id];
    if (status === undefined) {
      // Contrato v3: un lote con ack que el backend no informa cuenta como `processing`.
      result.retainingLotIds.push(lot.id);
      continue;
    }
    switch (status.status) {
      case 'queued':
        result.inProgress[lot.id] = 'queued';
        if (lot.eventIds === undefined) {
          result.retainingLotIds.push(lot.id);
        } else {
          result.queuedEventIds.push(...lot.eventIds);
        }
        break;
      case 'processing':
        result.inProgress[lot.id] = 'processing';
        result.retainingLotIds.push(lot.id);
        break;
      case 'ok':
        result.resolvedIds.add(lot.id);
        break;
      case 'issues':
        result.resolvedIds.add(lot.id);
        result.issues.push(...status.issues);
        break;
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/sync/pull-rule.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sync/pull-rule.ts src/sync/pull-rule.test.ts
git commit -m "feat(sync): regla del pull por estado de lote, con el lote en curso (#98)"
```

---

### Task 4: Stock y saldos ajustados antes de aplicar (`sync/pull-adjust.ts`)

**Files:**
- Create: `src/sync/pull-adjust.ts`
- Test: `src/sync/pull-adjust.test.ts`

**Interfaces:**
- Consumes: `ReapplyEffects`, `roundAmount`, `roundQuantity` (Task 1); `ConnectorCustomer` (`src/sync/connector.ts`); `StockItem` (`src/domain/stock.ts`).
- Produces:
  ```ts
  export function adjustPull(params: {
    customers: readonly ConnectorCustomer[];
    stock: readonly StockItem[];
    retain: boolean;
    effects: ReapplyEffects;
    localStock: readonly StockItem[];
    localBalances: ReadonlyMap<string, number>;
    now: string;
  }): { customers: ConnectorCustomer[]; stock: StockItem[] };
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/sync/pull-adjust.test.ts
import { describe, expect, it } from 'vitest';
import type { ReapplyEffects } from '../domain/reapply.ts';
import type { ConnectorCustomer } from './connector.ts';
import { adjustPull } from './pull-adjust.ts';

const now = '2026-09-24T10:00:00.000Z';
const noEffects: ReapplyEffects = { stock: new Map(), balance: new Map() };

function customer(id: string, balance?: number): ConnectorCustomer {
  return {
    id,
    name: id,
    createdAt: now,
    ...(balance !== undefined ? { creditLimit: 1000, margin: 0, balance } : {}),
  };
}

describe('adjustPull — sin retener', () => {
  it('suma los efectos al stock del backend y crea la fila de un producto que no vino', () => {
    const result = adjustPull({
      customers: [],
      stock: [{ productId: 'p1', quantity: 10, updatedAt: now }],
      retain: false,
      effects: { stock: new Map([['p1', -2], ['p2', -1]]), balance: new Map() },
      localStock: [],
      localBalances: new Map(),
      now,
    });
    expect(result.stock).toEqual([
      { productId: 'p1', quantity: 8, updatedAt: now },
      { productId: 'p2', quantity: -1, updatedAt: now },
    ]);
  });

  it('suma los efectos al saldo solo de los clientes que vinieron y con saldo', () => {
    const result = adjustPull({
      customers: [customer('c1', 100), customer('c2')],
      stock: [],
      retain: false,
      effects: { stock: new Map(), balance: new Map([['c1', 50], ['c2', 10], ['c3', 5]]) },
      localStock: [],
      localBalances: new Map(),
      now,
    });
    expect(result.customers.map((item) => item.balance)).toEqual([150, undefined]);
    expect(result.customers).toHaveLength(2);
  });

  it('sin efectos devuelve lo del backend tal cual', () => {
    const stock = [{ productId: 'p1', quantity: 3, updatedAt: now }];
    const customers = [customer('c1', 20)];
    expect(
      adjustPull({ customers, stock, retain: false, effects: noEffects, localStock: [], localBalances: new Map(), now }),
    ).toEqual({ customers, stock });
  });
});

describe('adjustPull — reteniendo', () => {
  it('usa el stock local entero e ignora el del backend y los efectos', () => {
    const localStock = [{ productId: 'p1', quantity: 7, updatedAt: '2026-09-23T00:00:00.000Z' }];
    const result = adjustPull({
      customers: [],
      stock: [{ productId: 'p1', quantity: 99, updatedAt: now }],
      retain: true,
      effects: { stock: new Map([['p1', -5]]), balance: new Map() },
      localStock,
      localBalances: new Map(),
      now,
    });
    expect(result.stock).toEqual(localStock);
  });

  it('conserva el saldo local de los clientes que tienen cuenta local; el resto queda como vino', () => {
    const result = adjustPull({
      customers: [customer('c1', 999), customer('c2', 30), customer('c3')],
      stock: [],
      retain: true,
      effects: noEffects,
      localStock: [],
      localBalances: new Map([['c1', 120]]),
      now,
    });
    expect(result.customers.map((item) => item.balance)).toEqual([120, 30, undefined]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/sync/pull-adjust.test.ts`
Expected: FAIL — no se resuelve `./pull-adjust.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/sync/pull-adjust.ts
import { roundAmount, roundQuantity, type ReapplyEffects } from '../domain/reapply.ts';
import type { StockItem } from '../domain/stock.ts';
import type { ConnectorCustomer } from './connector.ts';

/**
 * Stock y clientes del pull tal como se van a aplicar (spec de #98, §1). Pura.
 *
 * - Reteniendo (algún lote `processing`): el stock queda el local entero y
 *   cada cliente con cuenta local conserva su saldo local; datos maestros y
 *   bloqueos llegan igual.
 * - Sin retener: valor del backend + efectos de los eventos a reaplicar. El
 *   stock viaja completo, así que un producto con efectos y sin fila parte de
 *   0; el saldo se ajusta solo en los clientes que vinieron con saldo (los que
 *   no vienen conservan el local, que ya incluye todo lo de esta terminal).
 */
export function adjustPull(params: {
  customers: readonly ConnectorCustomer[];
  stock: readonly StockItem[];
  retain: boolean;
  effects: ReapplyEffects;
  localStock: readonly StockItem[];
  localBalances: ReadonlyMap<string, number>;
  now: string;
}): { customers: ConnectorCustomer[]; stock: StockItem[] } {
  if (params.retain) {
    return {
      stock: [...params.localStock],
      customers: params.customers.map((item) => {
        const local = params.localBalances.get(item.id);
        return item.balance !== undefined && local !== undefined ? { ...item, balance: local } : item;
      }),
    };
  }

  const incoming = new Set(params.stock.map((item) => item.productId));
  const stock = params.stock.map((item) => {
    const delta = params.effects.stock.get(item.productId);
    return delta === undefined ? item : { ...item, quantity: roundQuantity(item.quantity + delta) };
  });
  for (const [productId, delta] of params.effects.stock) {
    if (!incoming.has(productId)) {
      stock.push({ productId, quantity: delta, updatedAt: params.now });
    }
  }

  const customers = params.customers.map((item) => {
    const delta = params.effects.balance.get(item.id);
    return item.balance === undefined || delta === undefined
      ? item
      : { ...item, balance: roundAmount(item.balance + delta) };
  });
  return { customers, stock };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/sync/pull-adjust.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sync/pull-adjust.ts src/sync/pull-adjust.test.ts
git commit -m "feat(sync): stock y saldos del pull ajustados por reaplicación o retención (#98)"
```

---

### Task 5: Aplicar el pull en una transacción (`storage/apply-pull.ts`)

**Files:**
- Create: `src/storage/apply-pull.ts`
- Test: `src/storage/apply-pull.test.ts`

**Interfaces:**
- Consumes: `reapplyEffects` (Task 1), `adjustPull` (Task 4), `applySnapshotReconciled`/`SnapshotTable` (`src/storage/reconcile.ts`), `splitConnectorCustomers` (`src/domain/customer.ts`), `isLegacyOutboxType` (`src/domain/outbox.ts`), `PullBatchResult` (`src/sync/connector.ts`).
- Produces:
  ```ts
  export type PullApplyInput = {
    full: boolean;
    result: PullBatchResult;
    retain: boolean;
    queuedEventIds: readonly string[];
    now: string;
  };
  export type PullApplyReport = { skipped: SnapshotTable[]; reappliedEvents: number };
  export async function applyPull(input: PullApplyInput): Promise<Result<PullApplyReport>>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/storage/apply-pull.test.ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildOutboxEventForSale,
  buildOutboxEventsForStockMovements,
  markSynced,
} from '../domain/outbox.ts';
import type { Product } from '../domain/product.ts';
import type { Sale } from '../domain/sale.ts';
import type { PullBatchResult } from '../sync/connector.ts';
import { applyPull } from './apply-pull.ts';
import { db } from './db.ts';

const now = '2026-09-24T10:00:00.000Z';
const origin = { branch: 'b', pointOfSale: 'p' };

function product(id: string, name = `Producto ${id}`): Product {
  return { id, sku: `SKU-${id}`, barcodes: [], name, price: 100, taxRate: 0.21, category: 'x', tracksStock: true };
}

function pull(overrides: Partial<PullBatchResult> = {}): PullBatchResult {
  return { products: { items: [] }, customers: { items: [] }, stock: [], lots: {}, ...overrides };
}

function saleEvents(id: string, productId: string, qty: number, customerId?: string) {
  const sale: Sale = {
    id,
    lines: [],
    payments: customerId !== undefined ? [{ method: 'account', amount: 100 }] : [],
    total: 100,
    status: 'closed',
    createdAt: now,
    ...(customerId !== undefined ? { customerId } : {}),
  };
  return [
    buildOutboxEventForSale(sale, { now, origin }),
    ...buildOutboxEventsForStockMovements(
      [{ id: `${id}-m`, productId, delta: -qty, reason: 'sale', saleId: id, createdAt: now }],
      { now, origin },
    ),
  ];
}

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
  vi.restoreAllMocks();
});

describe('applyPull — delta sin retener', () => {
  it('reaplica los pendientes del outbox sobre el stock del backend', async () => {
    await db.outbox.bulkAdd(saleEvents('s1', 'p1', 2));

    const report = await applyPull({
      full: false,
      result: pull({ stock: [{ productId: 'p1', quantity: 10, updatedAt: now }] }),
      retain: false,
      queuedEventIds: [],
      now,
    });

    expect(report).toEqual({ ok: true, value: { skipped: [], reappliedEvents: 2 } });
    expect((await db.stock.get('p1'))?.quantity).toBe(8);
  });

  it('reaplica los eventos de lotes en cola (ya synced) y no los cuenta dos veces', async () => {
    const events = saleEvents('s1', 'p1', 3).map(markSynced);
    await db.outbox.bulkAdd(events);

    await applyPull({
      full: false,
      result: pull({ stock: [{ productId: 'p1', quantity: 10, updatedAt: now }] }),
      retain: false,
      queuedEventIds: [...events.map((event) => event.id), events[1]?.id ?? ''],
      now,
    });

    expect((await db.stock.get('p1'))?.quantity).toBe(7);
  });

  it('suma al saldo del backend solo en los clientes que vinieron', async () => {
    await db.outbox.bulkAdd(saleEvents('s1', 'p1', 1, 'c1'));
    await db.customerAccounts.put({ customerId: 'c2', creditLimit: 0, margin: 0, balance: 77, updatedAt: now });

    await applyPull({
      full: false,
      result: pull({
        customers: {
          items: [{ id: 'c1', name: 'Ana', createdAt: now, creditLimit: 1000, margin: 0, balance: 200 }],
        },
      }),
      retain: false,
      queuedEventIds: [],
      now,
    });

    expect((await db.customerAccounts.get('c1'))?.balance).toBe(300);
    expect((await db.customerAccounts.get('c2'))?.balance).toBe(77);
  });

  it('un cliente sin cuenta no recibe una inventada', async () => {
    await db.outbox.bulkAdd(saleEvents('s1', 'p1', 1, 'c1'));
    await applyPull({
      full: false,
      result: pull({ customers: { items: [{ id: 'c1', name: 'Ana', createdAt: now }] } }),
      retain: false,
      queuedEventIds: [],
      now,
    });
    expect(await db.customerAccounts.get('c1')).toBeUndefined();
  });
});

describe('applyPull — reteniendo', () => {
  it('aplica datos maestros y bloqueos, conserva stock y saldo locales', async () => {
    await db.products.put(product('p1', 'Viejo'));
    await db.stock.put({ productId: 'p1', quantity: 4, updatedAt: '2026-09-23T00:00:00.000Z' });
    await db.customerAccounts.put({ customerId: 'c1', creditLimit: 1000, margin: 0, balance: 50, updatedAt: now });
    await db.outbox.bulkAdd(saleEvents('s1', 'p1', 1, 'c1'));

    const report = await applyPull({
      full: false,
      result: pull({
        products: { items: [{ ...product('p1', 'Nuevo'), createdAt: now, blocked: { reason: 'revisar' } }] },
        customers: {
          items: [{ id: 'c1', name: 'Ana', createdAt: now, creditLimit: 2000, margin: 0, balance: 999 }],
        },
        stock: [{ productId: 'p1', quantity: 99, updatedAt: now }],
      }),
      retain: true,
      queuedEventIds: [],
      now,
    });

    expect(report).toEqual({ ok: true, value: { skipped: [], reappliedEvents: 0 } });
    const saved = await db.products.get('p1');
    expect(saved?.name).toBe('Nuevo');
    expect(saved?.blocked).toEqual({ reason: 'revisar' });
    expect((await db.stock.get('p1'))?.quantity).toBe(4);
    const account = await db.customerAccounts.get('c1');
    expect(account?.balance).toBe(50);
    expect(account?.creditLimit).toBe(2000);
  });

  it('una foto completa reteniendo reconcilia productos pero no borra stock local', async () => {
    await db.products.bulkPut([product('p1'), product('p2')]);
    await db.stock.put({ productId: 'p2', quantity: 4, updatedAt: now });

    const report = await applyPull({
      full: true,
      result: pull({ products: { items: [{ ...product('p1'), createdAt: now }] } }),
      retain: true,
      queuedEventIds: [],
      now,
    });

    expect(report.ok).toBe(true);
    expect(await db.products.get('p2')).toBeUndefined();
    expect((await db.stock.get('p2'))?.quantity).toBe(4);
  });
});

describe('applyPull — foto completa sin retener', () => {
  it('reconcilia bajas y reaplica los pendientes', async () => {
    await db.products.bulkPut([product('p1'), product('p2')]);
    await db.stock.bulkPut([
      { productId: 'p1', quantity: 1, updatedAt: now },
      { productId: 'p2', quantity: 1, updatedAt: now },
    ]);
    await db.outbox.bulkAdd(saleEvents('s1', 'p1', 2));

    await applyPull({
      full: true,
      result: pull({
        products: { items: [{ ...product('p1'), createdAt: now }] },
        stock: [{ productId: 'p1', quantity: 10, updatedAt: now }],
      }),
      retain: false,
      queuedEventIds: [],
      now,
    });

    expect(await db.products.get('p2')).toBeUndefined();
    expect(await db.stock.get('p2')).toBeUndefined();
    expect((await db.stock.get('p1'))?.quantity).toBe(8);
  });

  it('si Dexie falla devuelve sync/reconcile-failed sin cambiar nada', async () => {
    await db.products.put(product('p1', 'Viejo'));
    vi.spyOn(db.products, 'bulkPut').mockRejectedValueOnce(new Error('boom'));

    const report = await applyPull({
      full: true,
      result: pull({ products: { items: [{ ...product('p1', 'Nuevo'), createdAt: now }] } }),
      retain: false,
      queuedEventIds: [],
      now,
    });

    expect(report).toEqual({ ok: false, error: 'sync/reconcile-failed', meta: { message: 'boom' } });
    expect((await db.products.get('p1'))?.name).toBe('Viejo');
  });
});
```

Si `Product` no admite `createdAt`/`blocked` como campos del tipo de la fila, verificá
`src/domain/product.ts` y `connectorProductSchema` (`src/sync/connector.ts`) — la Etapa 1 los guarda
en la fila; ajustá solo los literales del test.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/storage/apply-pull.test.ts`
Expected: FAIL — no se resuelve `./apply-pull.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/storage/apply-pull.ts
import { splitConnectorCustomers } from '../domain/customer.ts';
import { isLegacyOutboxType, type OutboxEvent } from '../domain/outbox.ts';
import { reapplyEffects } from '../domain/reapply.ts';
import { err, ok, type Result } from '../domain/result.ts';
import type { PullBatchResult } from '../sync/connector.ts';
import { adjustPull } from '../sync/pull-adjust.ts';
import { db } from './db.ts';
import { applySnapshotReconciled, type SnapshotTable } from './reconcile.ts';

export type PullApplyInput = {
  full: boolean;
  result: PullBatchResult;
  /** Algún lote `processing` (o equivalente): stock y saldo quedan los locales. */
  retain: boolean;
  /** Eventos de lotes `queued` (ya `synced`) a reaplicar además de los pendientes. */
  queuedEventIds: readonly string[];
  now: string;
};

export type PullApplyReport = { skipped: SnapshotTable[]; reappliedEvents: number };

/** Pendientes del outbox ∪ eventos de lotes en cola, deduplicados; nunca un tipo que el contrato ya no tiene. */
async function eventsToReapply(queuedEventIds: readonly string[]): Promise<OutboxEvent[]> {
  const pending = await db.outbox.where('status').equals('pending').toArray();
  const queued = (await db.outbox.bulkGet([...queuedEventIds])).filter(
    (event): event is OutboxEvent => event !== undefined,
  );
  const byId = new Map<string, OutboxEvent>();
  for (const event of [...queued, ...pending]) {
    if (!isLegacyOutboxType(event.type)) {
      byId.set(event.id, event);
    }
  }
  return [...byId.values()];
}

/**
 * Aplica un pull (spec de #98, §1) en **una** transacción: datos maestros y
 * bloqueos siempre; stock y saldo del backend más los eventos que el backend
 * todavía no refleja, o los locales si hay que retener. El outbox se lee
 * adentro, así una venta cerrada mientras el pull estaba en vuelo entra en la
 * reaplicación. Delta: `bulkPut`. Foto completa: `applySnapshotReconciled`
 * (bajas incluidas). Cursores y repositorios en memoria son del motor.
 */
export async function applyPull(input: PullApplyInput): Promise<Result<PullApplyReport>> {
  try {
    return ok(
      await db.transaction(
        'rw',
        [db.products, db.stock, db.customers, db.customerAccounts, db.outbox],
        async () => {
          const events = input.retain ? [] : await eventsToReapply(input.queuedEventIds);
          const localAccounts = input.retain ? await db.customerAccounts.toArray() : [];
          const adjusted = adjustPull({
            customers: input.result.customers.items,
            stock: input.result.stock,
            retain: input.retain,
            effects: reapplyEffects(events),
            localStock: input.retain ? await db.stock.toArray() : [],
            localBalances: new Map(
              localAccounts.map((account) => [account.customerId, account.balance]),
            ),
            now: input.now,
          });

          if (input.full) {
            const { skipped } = await applySnapshotReconciled(
              {
                products: input.result.products.items,
                stock: adjusted.stock,
                customers: adjusted.customers,
                cursors: {},
              },
              { now: input.now },
            );
            return { skipped, reappliedEvents: events.length };
          }

          if (input.result.products.items.length > 0) {
            await db.products.bulkPut(input.result.products.items);
          }
          if (adjusted.stock.length > 0) {
            await db.stock.bulkPut(adjusted.stock);
          }
          if (adjusted.customers.length > 0) {
            const { customers, accounts } = splitConnectorCustomers(adjusted.customers, {
              now: input.now,
            });
            await db.customers.bulkPut(customers);
            if (accounts.length > 0) {
              await db.customerAccounts.bulkPut(accounts);
            }
          }
          return { skipped: [], reappliedEvents: events.length };
        },
      ),
    );
  } catch (error) {
    return err('sync/reconcile-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/storage/apply-pull.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storage/apply-pull.ts src/storage/apply-pull.test.ts
git commit -m "feat(storage): aplicar el pull con reaplicación o retención en una transacción (#98)"
```

---

### Task 6: El motor usa la regla nueva

**Files:**
- Modify: `src/sync/engine.ts` (`logSyncAttempt`, `pullAndApply`, `finishPullCycle`, imports)
- Modify: `src/domain/result.ts:55-56` (sacar `sync/pending-lot`)
- Modify: `src/ui/errors.ts:81-82` y `src/ui/errors.test.ts:121-...` (sacar el case y su test)
- Modify: `src/ui/state/sync.ts` (`lastPullApplicationSignal`, `SyncLogEntry.application`)
- Modify: `src/storage/reconcile.ts` (sacar `reconcileSnapshot`), `src/storage/reconcile.test.ts`
- Test: `src/sync/engine.test.ts`

**Interfaces:**
- Consumes: `classifyLots`, `PullApplication` (Task 3); `applyPull` (Task 5); `markLotNotReceived` (Task 2); `markSynced`.
- Produces:
  ```ts
  // ui/state/sync.ts
  export const lastPullApplicationSignal: Signal<PullApplication | null>;
  export function setLastPullApplication(application: PullApplication | null): void;
  export type SyncLogEntry = { at; kind; request; result; application?: PullApplication };
  ```

- [ ] **Step 1: Write the failing tests**

En `src/sync/engine.test.ts`, reemplazar el `describe('runPullCycle — gateado por lotes de push pendientes', …)` entero (líneas ~590-768) por el siguiente. Conservá del bloque original, sin cambios, los tests `'un lote resuelto ok se saca de la lista de espera…'`, `'un lote resuelto con issues…'`, `'un pull exitoso sin issues queda en el log…'`, `'un fallo de red en el pull queda en el log…'` y `'sin lotes en espera, pullBatch se llama con pendingLotIds vacío…'`; los tres primeros tests del bloque (`sigue pending`, `no informa nada`, `processing también descarta`) se reemplazan por estos:

```ts
describe('runPullCycle — regla del pull (Etapa 3, #98)', () => {
  const productRow = {
    id: 'p1',
    sku: 'S1',
    barcodes: [],
    name: 'Viejo',
    price: 1,
    taxRate: 0,
    category: 'x',
    tracksStock: true,
  };

  function pullWith(lots: Record<string, unknown>, stockQty = 10) {
    return vi.fn().mockResolvedValue(
      ok({
        products: { items: [{ ...productRow, name: 'Nuevo', createdAt: now }], nextCursor: 'pc-2' },
        customers: {
          items: [{ id: 'c1', name: 'Ana', createdAt: now, creditLimit: 1000, margin: 0, balance: 500 }],
          nextCursor: 'cc-2',
        },
        stock: [{ productId: 'p1', quantity: stockQty, updatedAt: now }],
        lots,
      }),
    );
  }

  async function seedLocal(): Promise<void> {
    await db.products.put(productRow);
    await db.stock.put({ productId: 'p1', quantity: 4, updatedAt: now });
    await db.customerAccounts.put({ customerId: 'c1', creditLimit: 1000, margin: 0, balance: 50, updatedAt: now });
  }

  it('processing: aplica datos maestros, retiene stock y saldo y no avanza el cursor de clientes', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await seedLocal();
    addAwaitingLot({ id: 'lot-1', sentAt: now, eventIds: ['e1'] });

    const report = await runPullCycle(
      fakeConnector({ pullBatch: pullWith({ 'lot-1': { status: 'processing' } }) }),
      now,
    );

    expect(report.ok).toBe(true);
    expect((await db.products.get('p1'))?.name).toBe('Nuevo');
    expect((await db.stock.get('p1'))?.quantity).toBe(4);
    expect((await db.customerAccounts.get('c1'))?.balance).toBe(50);
    expect(getProductsCursor()).toBe('pc-2');
    expect(getCustomersCursor()).toBeUndefined();
    expect(lastPullApplicationSignal.value).toEqual({ kind: 'retained', lotIds: ['lot-1'] });
    expect(syncStatusSignal.value).toBe('online-idle');
    expect(syncLogSignal.value[0]?.application).toEqual({ kind: 'retained', lotIds: ['lot-1'] });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(getAwaitingLots()).toEqual([
      { id: 'lot-1', sentAt: now, eventIds: ['e1'], lastStatus: 'processing' },
    ]);
  });

  it('un lote con ack que el backend no informa retiene igual (contrato v3)', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await seedLocal();
    addAwaitingLot({ id: 'lot-1', sentAt: now, eventIds: ['e1'] });

    await runPullCycle(fakeConnector({ pullBatch: pullWith({}) }), now);

    expect((await db.stock.get('p1'))?.quantity).toBe(4);
    expect(getAwaitingLots()).toEqual([{ id: 'lot-1', sentAt: now, eventIds: ['e1'] }]);
  });

  it('queued: toma el valor del backend y le reaplica los eventos del lote', async () => {
    await seedLocal();
    const movement = buildOutboxEventsForStockMovements(
      [{ id: 'm1', productId: 'p1', delta: -3, reason: 'sale', createdAt: now }],
      { now, origin: { branch: 'b', pointOfSale: 'p' } },
    ).map(markSynced);
    await db.outbox.bulkAdd(movement);
    addAwaitingLot({ id: 'lot-1', sentAt: now, eventIds: ['m1'] });

    await runPullCycle(fakeConnector({ pullBatch: pullWith({ 'lot-1': { status: 'queued' } }) }), now);

    expect((await db.stock.get('p1'))?.quantity).toBe(7);
    expect((await db.customerAccounts.get('c1'))?.balance).toBe(500);
    expect(getCustomersCursor()).toBe('cc-2');
    expect(lastPullApplicationSignal.value).toEqual({ kind: 'reapplied', events: 1 });
  });

  it('sin lotes: reaplica los pendientes nunca enviados (el pull ya no pisa ventas sin enviar)', async () => {
    await seedLocal();
    await db.outbox.bulkAdd(
      buildOutboxEventsForStockMovements(
        [{ id: 'm1', productId: 'p1', delta: -2, reason: 'sale', createdAt: now }],
        { now, origin: { branch: 'b', pointOfSale: 'p' } },
      ),
    );

    await runPullCycle(fakeConnector({ pullBatch: pullWith({}) }), now);

    expect((await db.stock.get('p1'))?.quantity).toBe(8);
  });

  it('manda el lote en curso en pendingLotIds; si el backend no lo conoce, lo marca no recibido y reaplica sus eventos', async () => {
    await seedLocal();
    await db.outbox.bulkAdd(
      buildOutboxEventsForStockMovements(
        [{ id: 'm1', productId: 'p1', delta: -1, reason: 'sale', createdAt: now }],
        { now, origin: { branch: 'b', pointOfSale: 'p' } },
      ),
    );
    setCurrentPushLot(buildPushLot(['m1'], { id: 'cur', now }));
    const pullBatch = pullWith({});

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(pullBatch).toHaveBeenCalledWith(expect.objectContaining({ pendingLotIds: ['cur'] }));
    expect(getCurrentPushLot()?.notReceivedAt).toBe(now);
    expect((await db.stock.get('p1'))?.quantity).toBe(9);
    expect((await db.outbox.get('m1'))?.status).toBe('pending');
  });

  it('si el backend conoce el lote en curso, recupera el ack: eventos synced, lote a la espera, sin reenviar', async () => {
    await seedLocal();
    await db.outbox.bulkAdd(
      buildOutboxEventsForStockMovements(
        [{ id: 'm1', productId: 'p1', delta: -1, reason: 'sale', createdAt: now }],
        { now, origin: { branch: 'b', pointOfSale: 'p' } },
      ),
    );
    setCurrentPushLot(buildPushLot(['m1'], { id: 'cur', now }));

    await runPullCycle(fakeConnector({ pullBatch: pullWith({ cur: { status: 'queued' } }) }), now);

    expect(getCurrentPushLot()).toBeUndefined();
    expect((await db.outbox.get('m1'))?.status).toBe('synced');
    expect(getAwaitingLots()).toEqual([
      { id: 'cur', sentAt: now, eventIds: ['m1'], lastStatus: 'queued' },
    ]);
    expect((await db.stock.get('p1'))?.quantity).toBe(9);

    const pushBatch = vi.fn().mockResolvedValue(ok(undefined));
    await pushPendingLot(fakeConnector({ pushBatch }), now);
    expect(pushBatch).not.toHaveBeenCalled();
  });

  it('una foto completa que retiene no cuenta como hecha', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await seedLocal();
    addAwaitingLot({ id: 'lot-1', sentAt: now, eventIds: ['e1'] });

    await runPullCycle(
      fakeConnector({ pullBatch: pullWith({ 'lot-1': { status: 'processing' } }) }),
      now,
      { full: true },
    );

    expect(getLastFullSyncAt()).toBeUndefined();
    expect(getCustomersCursor()).toBeUndefined();
    expect((await db.stock.get('p1'))?.quantity).toBe(4);
  });

  // …acá siguen, sin cambios, los 5 tests conservados del bloque original…
});
```

Imports a sumar en `engine.test.ts`: `buildOutboxEventsForStockMovements`, `markSynced` (de
`../domain/outbox.ts`), `lastPullApplicationSignal` (de `../ui/state/sync.ts`). `buildPushLot`,
`setCurrentPushLot`, `getCurrentPushLot`, `getLastFullSyncAt` ya están importados.

En los tests de `describe('runPullCycle — delta')` que hoy esperan `{ applied: true }` implícito, no
cambia nada. En el test `'actualiza el stock recibido'` el valor esperado sigue igual (no hay
pendientes). Sumá al final de `afterEach` del archivo: `lastPullApplicationSignal.value = null;`.

En `src/ui/errors.test.ts`, borrar el test `'sync/pending-lot: explica que se esperó…'`.

En `src/storage/reconcile.test.ts`: cambiar el import a `import { applySnapshotReconciled } from './reconcile.ts';`,
agregar después de los helpers:

```ts
/** Lo mismo que hacía `reconcileSnapshot` (se sacó en #98): la reconciliación dentro de su transacción. */
async function reconcile(snap: ProbeSnapshot, params: { now: string; allowEmptyTables?: boolean }) {
  return db.transaction(
    'rw',
    [db.products, db.stock, db.customers, db.customerAccounts, db.outbox],
    () => applySnapshotReconciled(snap, params),
  );
}
```

reemplazar cada `await reconcileSnapshot(x, { now })` por `await reconcile(x, { now })` y cada
aserción `expect(result).toEqual({ ok: true, value: { skipped: [...] } })` por
`expect(result).toEqual({ skipped: [...] })` (el helper ya no envuelve en `Result`). Borrar el test
`'si la transacción falla no cambia nada y devuelve sync/reconcile-failed'` (ese caso lo cubre ahora
`apply-pull.test.ts`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/sync/engine.test.ts src/storage/reconcile.test.ts`
Expected: FAIL — `lastPullApplicationSignal` no existe, `pendingLotIds` no incluye `cur`, el pull con
`processing` devuelve `sync/pending-lot`.

- [ ] **Step 3: Implement**

`src/domain/result.ts`: borrar las dos líneas

```ts
  // sync/engine.ts (pull batch, #87): un lote de push que nos interesa sigue sin resolverse
  'sync/pending-lot': undefined;
```

`src/ui/errors.ts`: borrar el `case 'sync/pending-lot':` y su `return`.

`src/ui/state/sync.ts`: sumar el import `import type { PullApplication } from '../../sync/pull-rule.ts';`,
agregar `application?: PullApplication;` a `SyncLogEntry`, y después de `setPushLotIssues`:

```ts
/**
 * Cómo se aplicó el último pull exitoso (Etapa 3 de #94, #98): `retained`
 * = datos maestros aplicados, stock y saldos locales a la espera de que el
 * backend termine un lote. La barra de estado lo muestra; no es un error.
 */
export const lastPullApplicationSignal = signal<PullApplication | null>(null);

export function setLastPullApplication(application: PullApplication | null): void {
  lastPullApplicationSignal.value = application;
}
```

`src/storage/reconcile.ts`: borrar la función `reconcileSnapshot` completa y los imports que queden
sin uso (`err`, `ok`, `Result`); actualizar el comentario de `applySnapshotReconciled` para decir que
la llaman `storage/apply-pull.ts` y `sync/apply-connection.ts` dentro de su transacción.

`src/sync/engine.ts`:

1. Imports: sacar `reconcileSnapshot`, `toProbeSnapshot` (queda `withTimeout`), `splitConnectorCustomers`
   si queda sin uso; sumar:

```ts
import { markLotNotReceived } from '../domain/push-lot.ts'; // junto a los otros de push-lot
import { applyPull } from '../storage/apply-pull.ts';
import { classifyLots, type PullApplication } from './pull-rule.ts';
import { type AwaitingLot } from './push-lot.ts'; // junto a los otros de ./push-lot.ts
import { setLastPullApplication } from '../ui/state/sync.ts'; // junto a los otros
```

2. Reemplazar `logSyncAttempt` por:

```ts
/**
 * Registra un intento real de push/pull para `/DIAGNOSTICO` — `request`/
 * `result` son literalmente lo que el call site ya tiene en la mano, sin
 * resumir, así se puede correlacionar con la pestaña Network. Un ciclo
 * exitoso no toca la consola, salvo un pull que retuvo stock y saldos: es el
 * comportamiento esperado mientras un lote se procesa (#98), va a `console.info`.
 */
function logSyncAttempt(
  kind: 'push' | 'pull',
  now: string,
  request: unknown,
  result: Result<unknown>,
  application?: PullApplication,
): void {
  const entry: SyncLogEntry = {
    at: now,
    kind,
    request,
    result: result.ok ? { ok: true } : { ok: false, error: result.error, meta: result.meta },
    ...(application !== undefined ? { application } : {}),
  };
  appendSyncLogEntry(entry);
  if (!result.ok) {
    console.error(`[sync] ${kind} falló: ${result.error}`, entry);
    return;
  }
  if (application?.kind === 'retained') {
    console.info('[sync] pull aplicado sin stock ni saldos — lote(s) procesando', entry);
  }
}
```

3. Reemplazar `PullOutcome` y `pullAndApply` por:

```ts
type PullOutcome = {
  application?: PullApplication;
  failure?: Failure;
  issues: LotIssue[];
  request: unknown;
};

/**
 * Ack recuperado (#98): el backend informó el lote en curso, así que lo
 * recibió aunque la respuesta del push se perdió. Mismo efecto que el ack:
 * eventos `synced`, lote a la lista de espera, nunca se reenvía.
 */
async function recoverLostAck(lot: AwaitingLot): Promise<void> {
  const events = (await db.outbox.bulkGet(lot.eventIds ?? [])).filter(
    (event): event is OutboxEvent => event !== undefined && event.status === 'pending',
  );
  await db.outbox.bulkPut(events.map(markSynced));
  clearCurrentPushLot();
  addAwaitingLot(lot);
}

/**
 * Un ciclo de **pull** (spec de #98): un solo `pullBatch` que pregunta por
 * los lotes en espera y por el lote en curso. Datos maestros y bloqueos se
 * aplican siempre; stock y saldo, con el valor del backend más los eventos
 * que todavía no refleja, o los locales si algún lote sigue `processing`
 * (en ese caso el cursor de clientes no avanza: el saldo viaja en el cliente).
 */
async function pullAndApply(
  connector: Connector,
  now: string,
  options: { full: boolean },
): Promise<PullOutcome> {
  const awaiting = getAwaitingLots();
  const currentLot = getCurrentPushLot();
  const productsCursor = getProductsCursor();
  const customersCursor = getCustomersCursor();
  const cursors = options.full
    ? {}
    : {
        ...(productsCursor !== undefined ? { products: productsCursor } : {}),
        ...(customersCursor !== undefined ? { customers: customersCursor } : {}),
      };

  const request = {
    deviceId: getDeviceId(),
    cursors,
    pendingLotIds: [
      ...awaiting.map((lot) => lot.id),
      ...(currentLot !== undefined ? [currentLot.id] : []),
    ],
  };
  const pullPromise = connector.pullBatch(request);
  // Solo la foto completa lleva tope de tiempo (mismo criterio que antes de #87).
  const pullResult = options.full
    ? await withTimeout(pullPromise, FULL_REFRESH_TIMEOUT_MS)
    : await pullPromise;
  if (!pullResult.ok) {
    return { failure: pullResult, issues: [], request };
  }

  const lots = classifyLots({ awaiting, currentLot, reported: pullResult.value.lots });
  if (lots.recoveredLot !== undefined) {
    await recoverLostAck(lots.recoveredLot);
  } else if (currentLot !== undefined && lots.currentLotNotReceived) {
    setCurrentPushLot(markLotNotReceived(currentLot, now));
  }
  updateAwaitingLots(lots.resolvedIds, lots.inProgress);

  const retain = lots.retainingLotIds.length > 0;
  const applied = await applyPull({
    full: options.full,
    result: pullResult.value,
    retain,
    queuedEventIds: lots.queuedEventIds,
    now,
  });
  if (!applied.ok) {
    return { failure: applied, issues: lots.issues, request };
  }
  if (applied.value.skipped.length > 0) {
    return {
      failure: err('sync/empty-snapshot', { tables: applied.value.skipped }) as Failure,
      issues: lots.issues,
      request,
    };
  }

  const { products, customers } = pullResult.value;
  if (products.nextCursor !== undefined) {
    setProductsCursor(products.nextCursor);
  }
  if (!retain && customers.nextCursor !== undefined) {
    setCustomersCursor(customers.nextCursor);
  }
  if (options.full || products.items.length > 0) {
    setCatalogRepository(await loadCatalogRepository());
  }
  if (options.full || customers.items.length > 0) {
    setCustomerRepository(await loadCustomerRepository());
  }
  if (options.full && !retain) {
    setLastFullSyncAt(now);
    fullRefreshDoneThisSession = true;
  }

  const application: PullApplication = retain
    ? { kind: 'retained', lotIds: lots.retainingLotIds }
    : applied.value.reappliedEvents > 0
      ? { kind: 'reapplied', events: applied.value.reappliedEvents }
      : { kind: 'applied' };
  return { application, issues: lots.issues, request };
}
```

4. En `finishPullCycle`, reemplazar la línea `logSyncAttempt('pull', now, outcome.request, outcome.failure ?? ok(undefined));` por:

```ts
  logSyncAttempt(
    'pull',
    now,
    outcome.request,
    outcome.failure ?? ok(undefined),
    outcome.application,
  );
```

y justo después de `setLastSyncFailure(null);` agregar `setLastPullApplication(outcome.application ?? null);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/sync src/storage src/ui/errors.test.ts`
Expected: PASS. Si un test de `runPullCycleNow — foto completa…` esperaba que el catálogo se
recargara solo con items, sigue pasando (la foto siempre recarga).

Run: `pnpm typecheck && pnpm lint`
Expected: sin errores (en particular, ningún `sync/pending-lot` suelto).

- [ ] **Step 5: Commit**

```bash
git add src/sync/engine.ts src/sync/engine.test.ts src/domain/result.ts src/ui/errors.ts src/ui/errors.test.ts src/ui/state/sync.ts src/storage/reconcile.ts src/storage/reconcile.test.ts
git commit -m "feat(sync): pull con datos maestros siempre, eventos reaplicados y ack recuperado (#98)"
```

---

### Task 7: Barra de estado y `/DIAGNOSTICO` muestran cómo se aplicó el pull

**Files:**
- Modify: `src/ui/format-lot.ts` (+ `src/ui/format-lot.test.ts`; crearlo si no existe)
- Modify: `src/ui/components/StatusBar.tsx` (+ su test, `src/ui/components/StatusBar.test.tsx`; crearlo si no existe)
- Modify: `src/sync/diagnostics.ts`
- Modify: `src/ui/screens/diagnostico-screen.tsx`, `src/ui/screens/diagnostico-screen.test.tsx`
- Modify: `src/ui/console/pos-console.ts` (+ su test)

**Interfaces:**
- Consumes: `lastPullApplicationSignal` (Task 6), `PullApplication` (Task 3), `AwaitingLot.eventIds`, `PushLot.notReceivedAt` (Task 2).
- Produces:
  ```ts
  // ui/format-lot.ts
  export function formatAwaitingLotStatus(lot: AwaitingLot): string; // ahora con "· N eventos"
  export function formatPullApplication(application: PullApplication): string;
  // sync/diagnostics.ts — SyncDiagnostics suma:
  lastPullApplication: PullApplication | null;
  ```

- [ ] **Step 1: Write the failing tests**

`src/ui/format-lot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatAwaitingLotStatus, formatPullApplication } from './format-lot.ts';

describe('formatAwaitingLotStatus', () => {
  it('suma la cantidad de eventos cuando se conoce', () => {
    expect(formatAwaitingLotStatus({ id: 'a', sentAt: 'x', lastStatus: 'queued', eventIds: ['e1', 'e2'] })).toBe(
      'en cola · 2 eventos',
    );
    expect(formatAwaitingLotStatus({ id: 'a', sentAt: 'x', eventIds: ['e1'] })).toBe('sin informar · 1 evento');
    expect(formatAwaitingLotStatus({ id: 'a', sentAt: 'x', lastStatus: 'processing' })).toBe('procesando');
  });
});

describe('formatPullApplication', () => {
  it('describe las tres formas de aplicar un pull', () => {
    expect(formatPullApplication({ kind: 'applied' })).toBe('Aplicado completo');
    expect(formatPullApplication({ kind: 'reapplied', events: 3 })).toBe(
      'Aplicado + 3 eventos reaplicados (lotes en cola y pendientes)',
    );
    expect(formatPullApplication({ kind: 'retained', lotIds: ['L1', 'L2'] })).toBe(
      'Stock y saldos retenidos: lote L1, L2 procesando — cursor de clientes retenido',
    );
  });
});
```

`src/ui/components/StatusBar.test.tsx` (si ya existe, sumá solo el `describe`):

```tsx
import { render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import {
  lastPullApplicationSignal,
  lastSyncedAtSignal,
  syncConfiguredSignal,
  syncStatusSignal,
} from '../state/sync.ts';
import { StatusBar } from './StatusBar.tsx';

afterEach(() => {
  lastPullApplicationSignal.value = null;
  lastSyncedAtSignal.value = null;
});

describe('StatusBar — pull que retiene (#98)', () => {
  it('avisa que stock y saldos esperan al backend, sin marcar error', () => {
    syncConfiguredSignal.value = true;
    syncStatusSignal.value = 'online-idle';
    lastPullApplicationSignal.value = { kind: 'retained', lotIds: ['L1'] };
    render(<StatusBar />);
    expect(screen.getByText(/Sincronizado.*stock y saldos en espera del backend/)).not.toBeNull();
  });

  it('sin retención no muestra el aviso', () => {
    syncConfiguredSignal.value = true;
    syncStatusSignal.value = 'online-idle';
    lastPullApplicationSignal.value = { kind: 'reapplied', events: 2 };
    render(<StatusBar />);
    expect(screen.queryByText(/en espera del backend/)).toBeNull();
  });
});
```

`src/ui/screens/diagnostico-screen.test.tsx`: en el objeto `diagnostics` de arriba, sumar
`lastPullApplication: { kind: 'retained', lotIds: ['LOT-A'] },`, cambiar
`currentLot: undefined` por
`currentLot: { id: 'LOT-CUR', eventIds: ['e1'], createdAt: '2026-09-23T10:00:00.000Z', retries: 1, nextAttemptAt: '2026-09-23T10:01:00.000Z', notReceivedAt: '2026-09-23T10:00:30.000Z' },`,
y sumar a `LOT-B` `eventIds: ['e1', 'e2']`. Agregar al primer `describe`:

```tsx
  it('muestra cómo se aplicó el último pull, los eventos de cada lote y el lote en curso no recibido', () => {
    render(<DiagnosticoScreen />);
    expect(screen.getByText(/Stock y saldos retenidos: lote LOT-A procesando/)).not.toBeNull();
    expect(screen.getByText(/LOT-B .*en cola · 2 eventos/)).not.toBeNull();
    expect(screen.getByText(/No recibido por el backend/)).not.toBeNull();
  });
```

En el test de `pos-console` (`src/ui/console/pos-console.test.ts`), sumar `lastPullApplication: null`
al fixture de `SyncDiagnostics` que use, y un test:

```ts
it('status() incluye cómo se aplicó el último pull', () => {
  const pos = createPosConsole({ ...deps, collectDiagnostics: () => ({ ...diagnostics, lastPullApplication: { kind: 'applied' } }) });
  expect(pos.status().ultimoPullAplicado).toBe('Aplicado completo');
});
```

(adaptá `deps`/`diagnostics` a los nombres que ya usa ese archivo de test).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/ui`
Expected: FAIL — `formatPullApplication` no existe, falta el sufijo en la barra, falta el texto en la pantalla, `lastPullApplication` no está en `SyncDiagnostics`.

- [ ] **Step 3: Implement**

`src/ui/format-lot.ts` — reemplazar `formatAwaitingLotStatus` y sumar:

```ts
import type { PullApplication } from '../sync/pull-rule.ts';

function eventCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'evento' : 'eventos'}`;
}

/** Último estado en curso informado por el backend (contrato v3); con la cantidad de eventos si se conoce (#98). */
export function formatAwaitingLotStatus(lot: AwaitingLot): string {
  const status = lot.lastStatus !== undefined ? LOT_STATUS_LABEL[lot.lastStatus] : 'sin informar';
  return lot.eventIds !== undefined ? `${status} · ${eventCount(lot.eventIds.length)}` : status;
}

/** Cómo se aplicó el último pull exitoso (#98) — `/DIAGNOSTICO` y `pos.status()`. */
export function formatPullApplication(application: PullApplication): string {
  switch (application.kind) {
    case 'applied':
      return 'Aplicado completo';
    case 'reapplied':
      return `Aplicado + ${eventCount(application.events)} reaplicados (lotes en cola y pendientes)`;
    case 'retained':
      return `Stock y saldos retenidos: lote ${application.lotIds.join(', ')} procesando — cursor de clientes retenido`;
  }
}
```

`src/ui/components/StatusBar.tsx` — sumar `lastPullApplicationSignal` al import y reemplazar el tramo
final de `statusText()` (desde `const lastSyncedAt = lastSyncedAtSignal.value;` después del bloque
`sync-error`) por:

```tsx
  const lastSyncedAt = lastSyncedAtSignal.value;
  const synced =
    lastSyncedAt !== null
      ? `Sincronizado (${new Date(lastSyncedAt).toLocaleTimeString()})`
      : 'Sincronizado';
  const counts = localCatalogCountsSignal.value;
  const base =
    counts !== null
      ? `${synced} · ${String(counts.products)} productos · ${String(counts.customers)} clientes`
      : synced;
  // Un pull que retuvo stock y saldos no es un error (#98): solo se avisa.
  return lastPullApplicationSignal.value?.kind === 'retained'
    ? `${base} · stock y saldos en espera del backend`
    : base;
```

`src/sync/diagnostics.ts` — sumar `lastPullApplicationSignal` al import de `ui/state/sync.ts`,
`import type { PullApplication } from './pull-rule.ts';`, el campo
`lastPullApplication: PullApplication | null;` al tipo y
`lastPullApplication: lastPullApplicationSignal.value,` a `collectDiagnostics()`.

`src/ui/screens/diagnostico-screen.tsx`:
- import `formatPullApplication` junto a los otros de `../format-lot.ts`;
- en la tarjeta "Último push", dentro del fragmento de `currentLot`, después del párrafo "Próximo intento":

```tsx
              {currentLot.notReceivedAt !== undefined && (
                <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                  No recibido por el backend (según el pull de{' '}
                  {new Date(currentLot.notReceivedAt).toLocaleString()})
                </p>
              )}
```

- en la tarjeta "Último pull", después del párrafo con `lastSyncedAt`:

```tsx
          {diagnostics.lastPullApplication !== null && (
            <p style={{ margin: 0 }}>{formatPullApplication(diagnostics.lastPullApplication)}</p>
          )}
```

`src/ui/console/pos-console.ts` — en `PosStatus` sumar `ultimoPullAplicado: string | null;` y a
`ultimoPush` sumar `noRecibido: string | null;`; en `formatStatus`:
`ultimoPullAplicado: diagnostics.lastPullApplication !== null ? formatPullApplication(diagnostics.lastPullApplication) : null,`
y dentro del objeto de `ultimoPush`: `noRecibido: diagnostics.currentLot.notReceivedAt ?? null,`
(importar `formatPullApplication` de `../format-lot.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/ui src/sync/diagnostics*`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/format-lot.ts src/ui/format-lot.test.ts src/ui/components/StatusBar.tsx src/ui/components/StatusBar.test.tsx src/sync/diagnostics.ts src/ui/screens/diagnostico-screen.tsx src/ui/screens/diagnostico-screen.test.tsx src/ui/console/pos-console.ts src/ui/console/pos-console.test.ts
git commit -m "feat(ui): barra de estado y /DIAGNOSTICO muestran cómo se aplicó el pull (#98)"
```

---

### Task 8: Regla de limpieza (`domain/local-cleanup.ts`)

**Files:**
- Create: `src/domain/local-cleanup.ts`
- Test: `src/domain/local-cleanup.test.ts`

**Interfaces:**
- Consumes: `CashSession` (`src/domain/cash-session.ts`), `OutboxEvent` (`src/domain/outbox.ts`).
- Produces:
  ```ts
  export const CLEANUP_RETENTION_MS: number; // 7 días
  export type CleanupCounts = { sales: number; stockMovements: number; accountMovements: number; outbox: number; cashSessions: number };
  export type CleanupInput = {
    now: string;
    pendingEvents: readonly OutboxEvent[];
    protectedEventIds: ReadonlySet<string>;
    sales: readonly { id: string; createdAt: string }[];
    stockMovements: readonly { id: string; saleId?: string; createdAt: string }[];
    accountMovements: readonly { id: string; saleId?: string; createdAt: string }[];
    syncedEvents: readonly { id: string; createdAt: string }[];
    cashSessions: readonly CashSession[];
  };
  export type CleanupPlan = {
    sales: string[]; stockMovements: string[]; accountMovements: string[]; outbox: string[]; cashSessions: string[];
    /** Último turno cerrado (ancla del arqueo hasta la Etapa 5). */
    anchor: CashSession | undefined;
  };
  export function planLocalCleanup(input: CleanupInput): CleanupPlan;
  ```

Nota de alcance respecto del spec: `accountMovements` no son eventos del outbox (no tienen evento
propio); los que tienen `saleId` siguen a su venta y los que no lo tienen se **conservan** (hoy no
existen; la Etapa 6 decide su regla cuando genere cobranzas).

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/local-cleanup.test.ts
import { describe, expect, it } from 'vitest';
import type { CashSession } from './cash-session.ts';
import { planLocalCleanup, type CleanupInput } from './local-cleanup.ts';
import type { OutboxEvent } from './outbox.ts';

const now = '2026-09-24T12:00:00.000Z';
const old = '2026-09-10T12:00:00.000Z'; // 14 días
const recent = '2026-09-20T12:00:00.000Z'; // 4 días

function input(overrides: Partial<CleanupInput> = {}): CleanupInput {
  return {
    now,
    pendingEvents: [],
    protectedEventIds: new Set(),
    sales: [],
    stockMovements: [],
    accountMovements: [],
    syncedEvents: [],
    cashSessions: [],
    ...overrides,
  };
}

function session(id: string, sales: string[], closedAt?: string): CashSession {
  return { id, openedAt: old, openingAmount: 0, sales, ...(closedAt !== undefined ? { closedAt } : {}) };
}

describe('planLocalCleanup', () => {
  it('borra ventas viejas sincronizadas con sus movimientos, y conserva las recientes', () => {
    const plan = planLocalCleanup(
      input({
        sales: [
          { id: 's-old', createdAt: old },
          { id: 's-new', createdAt: recent },
        ],
        stockMovements: [
          { id: 'm-old', saleId: 's-old', createdAt: old },
          { id: 'm-new', saleId: 's-new', createdAt: recent },
        ],
        accountMovements: [
          { id: 'a-old', saleId: 's-old', createdAt: old },
          { id: 'a-free', createdAt: old },
        ],
      }),
    );
    expect(plan.sales).toEqual(['s-old']);
    expect(plan.stockMovements).toEqual(['m-old']);
    expect(plan.accountMovements).toEqual(['a-old']);
  });

  it('nunca borra una venta con su evento o su anulación pendientes', () => {
    const pendingEvents = [
      { id: 's1', type: 'sale', status: 'pending', createdAt: old },
      { id: 'v2', type: 'sale-void', saleId: 's2', voidedAt: old, status: 'pending', createdAt: old },
    ] as OutboxEvent[];
    const plan = planLocalCleanup(
      input({
        pendingEvents,
        sales: [
          { id: 's1', createdAt: old },
          { id: 's2', createdAt: old },
        ],
      }),
    );
    expect(plan.sales).toEqual([]);
  });

  it('borra eventos synced viejos salvo los protegidos (lotes en espera o en curso)', () => {
    const plan = planLocalCleanup(
      input({
        protectedEventIds: new Set(['e-lot']),
        syncedEvents: [
          { id: 'e-old', createdAt: old },
          { id: 'e-lot', createdAt: old },
          { id: 'e-new', createdAt: recent },
        ],
      }),
    );
    expect(plan.outbox).toEqual(['e-old']);
  });

  it('el último turno cerrado y el abierto son el ancla: se conservan con sus ventas', () => {
    const plan = planLocalCleanup(
      input({
        sales: [
          { id: 's-a', createdAt: old },
          { id: 's-b', createdAt: old },
          { id: 's-c', createdAt: old },
        ],
        cashSessions: [
          session('t1', ['s-a'], '2026-09-05T12:00:00.000Z'),
          session('t2', ['s-b'], '2026-09-11T12:00:00.000Z'),
          session('t3', ['s-c']),
        ],
      }),
    );
    expect(plan.anchor?.id).toBe('t2');
    expect(plan.cashSessions).toEqual(['t1']);
    expect(plan.sales).toEqual(['s-a']);
  });

  it('un turno cerrado hace menos de 7 días no se borra aunque no sea el ancla', () => {
    const plan = planLocalCleanup(
      input({
        cashSessions: [
          session('t1', [], '2026-09-19T12:00:00.000Z'),
          session('t2', [], '2026-09-21T12:00:00.000Z'),
        ],
      }),
    );
    expect(plan.cashSessions).toEqual([]);
  });

  it('un movimiento pendiente nunca se borra', () => {
    const pendingEvents = [
      { id: 'm1', type: 'stock-movement', status: 'pending', createdAt: old },
    ] as OutboxEvent[];
    const plan = planLocalCleanup(
      input({ pendingEvents, stockMovements: [{ id: 'm1', createdAt: old }] }),
    );
    expect(plan.stockMovements).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/domain/local-cleanup.test.ts`
Expected: FAIL — no se resuelve `./local-cleanup.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/local-cleanup.ts
import type { CashSession } from './cash-session.ts';
import type { OutboxEvent } from './outbox.ts';

/** Lo sincronizado se conserva 7 días (epic #94, Etapa 3 — #98). */
export const CLEANUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type CleanupCounts = {
  sales: number;
  stockMovements: number;
  accountMovements: number;
  outbox: number;
  cashSessions: number;
};

type Dated = { id: string; createdAt: string };
type SaleLinked = Dated & { saleId?: string };

export type CleanupInput = {
  now: string;
  /** Todo lo pendiente del outbox (nunca se borra, ni lo que depende de ello). */
  pendingEvents: readonly OutboxEvent[];
  /** Eventos de lotes en espera o en curso: hacen falta para reaplicar. */
  protectedEventIds: ReadonlySet<string>;
  sales: readonly Dated[];
  stockMovements: readonly SaleLinked[];
  accountMovements: readonly SaleLinked[];
  syncedEvents: readonly Dated[];
  cashSessions: readonly CashSession[];
};

export type CleanupPlan = {
  sales: string[];
  stockMovements: string[];
  accountMovements: string[];
  outbox: string[];
  cashSessions: string[];
  anchor: CashSession | undefined;
};

/**
 * Qué borrar de la base local (spec de #98, §4). Pura. Se borra lo que tiene
 * más de 7 días y está sincronizado; nunca lo pendiente, los eventos de lotes
 * sin resolver, ni el ancla del arqueo — mientras existan turnos (hasta la
 * Etapa 5, #100): el último turno cerrado, el abierto y sus ventas. Un evento
 * `sale` ausente del outbox cuenta como sincronizado: lo pendiente nunca se
 * borra, así que solo pudo irse por una limpieza anterior.
 */
export function planLocalCleanup(input: CleanupInput): CleanupPlan {
  const cutoff = new Date(input.now).getTime() - CLEANUP_RETENTION_MS;
  const isOld = (iso: string): boolean => new Date(iso).getTime() < cutoff;

  const pendingIds = new Set(input.pendingEvents.map((event) => event.id));
  const pendingVoidSaleIds = new Set(
    input.pendingEvents.flatMap((event) => (event.type === 'sale-void' ? [event.saleId] : [])),
  );

  const open = input.cashSessions.find((session) => session.closedAt === undefined);
  const anchor = input.cashSessions
    .filter((session) => session.closedAt !== undefined)
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0];
  const kept = [open, anchor].filter((session): session is CashSession => session !== undefined);
  const keptSessionIds = new Set(kept.map((session) => session.id));
  const keptSaleIds = new Set(kept.flatMap((session) => session.sales));

  const sales = input.sales
    .filter(
      (sale) =>
        isOld(sale.createdAt) &&
        !pendingIds.has(sale.id) &&
        !pendingVoidSaleIds.has(sale.id) &&
        !keptSaleIds.has(sale.id),
    )
    .map((sale) => sale.id);
  const deletedSales = new Set(sales);

  const stockMovements = input.stockMovements
    .filter(
      (movement) =>
        !pendingIds.has(movement.id) &&
        (movement.saleId !== undefined
          ? deletedSales.has(movement.saleId)
          : isOld(movement.createdAt)),
    )
    .map((movement) => movement.id);

  // Sin evento propio: siguen a su venta; sin venta se conservan (la Etapa 6 define su regla).
  const accountMovements = input.accountMovements
    .filter((movement) => movement.saleId !== undefined && deletedSales.has(movement.saleId))
    .map((movement) => movement.id);

  const outbox = input.syncedEvents
    .filter(
      (event) =>
        isOld(event.createdAt) && !input.protectedEventIds.has(event.id) && !pendingIds.has(event.id),
    )
    .map((event) => event.id);

  const cashSessions = input.cashSessions
    .filter(
      (session) =>
        session.closedAt !== undefined && isOld(session.closedAt) && !keptSessionIds.has(session.id),
    )
    .map((session) => session.id);

  return { sales, stockMovements, accountMovements, outbox, cashSessions, anchor };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/domain/local-cleanup.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/local-cleanup.ts src/domain/local-cleanup.test.ts
git commit -m "feat(domain): regla de limpieza de datos locales a 7 días (#98)"
```

---

### Task 9: Ejecutar la limpieza en IndexedDB (`storage/local-cleanup.ts`)

**Files:**
- Create: `src/storage/local-cleanup.ts`
- Test: `src/storage/local-cleanup.test.ts`
- Modify: `src/domain/result.ts` (código nuevo), `src/ui/errors.ts` (+ `src/ui/errors.test.ts`)

**Interfaces:**
- Consumes: `planLocalCleanup`, `CLEANUP_RETENTION_MS`, `CleanupCounts` (Task 8).
- Produces:
  ```ts
  // domain/result.ts
  'storage/cleanup-failed': { message: string };
  // storage/local-cleanup.ts
  export type CleanupReport = { counts: CleanupCounts; anchorClosedAt?: string };
  export async function runLocalCleanup(params: {
    now: string;
    protectedEventIds: ReadonlySet<string>;
  }): Promise<Result<CleanupReport>>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/storage/local-cleanup.test.ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOutboxEventForSale, markSynced } from '../domain/outbox.ts';
import type { Sale } from '../domain/sale.ts';
import { db } from './db.ts';
import { runLocalCleanup } from './local-cleanup.ts';

const now = '2026-09-24T12:00:00.000Z';
const old = '2026-09-10T12:00:00.000Z';
const origin = { branch: 'b', pointOfSale: 'p' };

function sale(id: string, createdAt: string): Sale {
  return { id, lines: [], payments: [], total: 0, status: 'closed', createdAt };
}

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
  vi.restoreAllMocks();
});

describe('runLocalCleanup', () => {
  it('borra la venta vieja sincronizada, su movimiento y su evento; deja lo pendiente', async () => {
    await db.sales.bulkAdd([sale('s-old', old), sale('s-pend', old)]);
    await db.stockMovements.add({ id: 'm1', productId: 'p1', delta: -1, reason: 'sale', saleId: 's-old', createdAt: old });
    await db.outbox.bulkAdd([
      markSynced(buildOutboxEventForSale(sale('s-old', old), { now: old, origin })),
      buildOutboxEventForSale(sale('s-pend', old), { now: old, origin }),
    ]);

    const report = await runLocalCleanup({ now, protectedEventIds: new Set() });

    expect(report).toEqual({
      ok: true,
      value: { counts: { sales: 1, stockMovements: 1, accountMovements: 0, outbox: 1, cashSessions: 0 } },
    });
    expect(await db.sales.get('s-old')).toBeUndefined();
    expect(await db.sales.get('s-pend')).not.toBeUndefined();
    expect(await db.stockMovements.get('m1')).toBeUndefined();
    expect(await db.outbox.get('s-pend')).not.toBeUndefined();
  });

  it('informa la fecha del ancla', async () => {
    await db.cashSessions.put({ id: 't1', openedAt: old, closedAt: old, openingAmount: 0, sales: [] });
    const report = await runLocalCleanup({ now, protectedEventIds: new Set() });
    expect(report.ok && report.value.anchorClosedAt).toBe(old);
  });

  it('si Dexie falla devuelve storage/cleanup-failed', async () => {
    vi.spyOn(db.sales, 'bulkDelete').mockRejectedValueOnce(new Error('boom'));
    await db.sales.add(sale('s-old', old));
    const report = await runLocalCleanup({ now, protectedEventIds: new Set() });
    expect(report).toEqual({ ok: false, error: 'storage/cleanup-failed', meta: { message: 'boom' } });
  });
});
```

En `src/ui/errors.test.ts` agregar:

```ts
it('storage/cleanup-failed: dice que no se pudo limpiar y por qué', () => {
  expect(describeError({ ok: false, error: 'storage/cleanup-failed', meta: { message: 'boom' } })).toBe(
    'No se pudieron borrar los datos locales viejos: boom',
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/storage/local-cleanup.test.ts src/ui/errors.test.ts`
Expected: FAIL — módulo inexistente; código de error desconocido.

- [ ] **Step 3: Implement**

`src/domain/result.ts` — sumar en `ErrorMeta` (junto a los de `storage/reconcile.ts`):

```ts
  // storage/local-cleanup.ts (limpieza a 7 días, #98)
  'storage/cleanup-failed': { message: string };
```

`src/ui/errors.ts` — sumar el case (junto a `sync/reconcile-failed`):

```ts
    case 'storage/cleanup-failed':
      return `No se pudieron borrar los datos locales viejos: ${failure.meta.message}`;
```

`src/storage/local-cleanup.ts`:

```ts
import {
  CLEANUP_RETENTION_MS,
  planLocalCleanup,
  type CleanupCounts,
} from '../domain/local-cleanup.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { db } from './db.ts';

export type CleanupReport = { counts: CleanupCounts; anchorClosedAt?: string };

/**
 * Borra lo sincronizado con más de 7 días (spec de #98, §4) en una sola
 * transacción; la regla es `domain/local-cleanup.ts::planLocalCleanup`. Lee
 * por los índices `createdAt` que ya existen, así solo trae candidatos.
 */
export async function runLocalCleanup(params: {
  now: string;
  protectedEventIds: ReadonlySet<string>;
}): Promise<Result<CleanupReport>> {
  const cutoff = new Date(new Date(params.now).getTime() - CLEANUP_RETENTION_MS).toISOString();
  try {
    return ok(
      await db.transaction(
        'rw',
        [db.sales, db.stockMovements, db.accountMovements, db.outbox, db.cashSessions],
        async () => {
          const [pendingEvents, sales, stockMovements, accountMovements, oldEvents, cashSessions] =
            await Promise.all([
              db.outbox.where('status').equals('pending').toArray(),
              db.sales.where('createdAt').below(cutoff).toArray(),
              db.stockMovements.where('createdAt').below(cutoff).toArray(),
              db.accountMovements.where('createdAt').below(cutoff).toArray(),
              db.outbox.where('createdAt').below(cutoff).toArray(),
              db.cashSessions.toArray(),
            ]);
          const plan = planLocalCleanup({
            now: params.now,
            pendingEvents,
            protectedEventIds: params.protectedEventIds,
            sales,
            stockMovements,
            accountMovements,
            syncedEvents: oldEvents.filter((event) => event.status === 'synced'),
            cashSessions,
          });
          await db.sales.bulkDelete(plan.sales);
          await db.stockMovements.bulkDelete(plan.stockMovements);
          await db.accountMovements.bulkDelete(plan.accountMovements);
          await db.outbox.bulkDelete(plan.outbox);
          await db.cashSessions.bulkDelete(plan.cashSessions);
          return {
            counts: {
              sales: plan.sales.length,
              stockMovements: plan.stockMovements.length,
              accountMovements: plan.accountMovements.length,
              outbox: plan.outbox.length,
              cashSessions: plan.cashSessions.length,
            },
            ...(plan.anchor?.closedAt !== undefined ? { anchorClosedAt: plan.anchor.closedAt } : {}),
          };
        },
      ),
    );
  } catch (error) {
    return err('storage/cleanup-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/storage/local-cleanup.test.ts src/ui/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/local-cleanup.ts src/storage/local-cleanup.test.ts src/domain/result.ts src/ui/errors.ts src/ui/errors.test.ts
git commit -m "feat(storage): limpieza de datos locales sincronizados con más de 7 días (#98)"
```

---

### Task 10: Cadencia de la limpieza y su lugar en `/DIAGNOSTICO`

**Files:**
- Create: `src/sync/cleanup-schedule.ts`
- Test: `src/sync/cleanup-schedule.test.ts`
- Modify: `src/sync/engine.ts` (`runPullCycleNow`, `startSyncEngine`) (+ `engine.test.ts`)
- Modify: `src/sync/diagnostics.ts`, `src/ui/format-lot.ts` (+ test), `src/ui/screens/diagnostico-screen.tsx` (+ test), `src/ui/console/pos-console.ts` (+ test)

**Interfaces:**
- Consumes: `runLocalCleanup`, `CleanupReport` (Task 9); `getAwaitingLots`, `getCurrentPushLot`.
- Produces:
  ```ts
  export const CLEANUP_INTERVAL_MS: number; // 24 h
  export type CleanupRecord = CleanupReport & { at: string };
  export function getLastCleanup(): CleanupRecord | undefined;
  export function isCleanupDue(last: CleanupRecord | undefined, now: string): boolean;
  export function protectedEventIds(): Set<string>;
  export async function runCleanupIfDue(params: {
    now: string;
    acquireLock: () => (() => void) | undefined;
  }): Promise<void>;
  // ui/format-lot.ts
  export function formatCleanup(record: CleanupRecord | undefined): { last: string; anchor: string };
  // sync/diagnostics.ts — SyncDiagnostics suma: lastCleanup: CleanupRecord | undefined;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/sync/cleanup-schedule.test.ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../storage/db.ts';
import {
  CLEANUP_INTERVAL_MS,
  getLastCleanup,
  isCleanupDue,
  protectedEventIds,
  runCleanupIfDue,
} from './cleanup-schedule.ts';
import { addAwaitingLot, setCurrentPushLot } from './push-lot.ts';
import { buildPushLot } from '../domain/push-lot.ts';

const now = '2026-09-24T12:00:00.000Z';
const freeLock = () => () => undefined;

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('isCleanupDue', () => {
  it('sin registro, toca; antes de 24 h no; a las 24 h sí', () => {
    expect(isCleanupDue(undefined, now)).toBe(true);
    const last = { at: now, counts: { sales: 0, stockMovements: 0, accountMovements: 0, outbox: 0, cashSessions: 0 } };
    expect(isCleanupDue(last, new Date(Date.parse(now) + CLEANUP_INTERVAL_MS - 1).toISOString())).toBe(false);
    expect(isCleanupDue(last, new Date(Date.parse(now) + CLEANUP_INTERVAL_MS).toISOString())).toBe(true);
  });
});

describe('protectedEventIds', () => {
  it('junta los eventos de los lotes en espera y del lote en curso', () => {
    addAwaitingLot({ id: 'a', sentAt: now, eventIds: ['e1'] });
    addAwaitingLot({ id: 'b', sentAt: now });
    setCurrentPushLot(buildPushLot(['e2'], { id: 'cur', now }));
    expect(protectedEventIds()).toEqual(new Set(['e1', 'e2']));
  });
});

describe('runCleanupIfDue', () => {
  it('corre, guarda el registro y no vuelve a correr antes de 24 h', async () => {
    const acquireLock = vi.fn(freeLock);
    await runCleanupIfDue({ now, acquireLock });
    expect(getLastCleanup()?.at).toBe(now);
    await runCleanupIfDue({ now, acquireLock });
    expect(acquireLock).toHaveBeenCalledTimes(1);
  });

  it('con el cerrojo tomado se saltea sin registrar nada', async () => {
    await runCleanupIfDue({ now, acquireLock: () => undefined });
    expect(getLastCleanup()).toBeUndefined();
  });

  it('libera el cerrojo aunque la limpieza falle', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(db.sales, 'bulkDelete').mockRejectedValueOnce(new Error('boom'));
    const release = vi.fn();
    await runCleanupIfDue({ now, acquireLock: () => release });
    expect(release).toHaveBeenCalledTimes(1);
    expect(getLastCleanup()).toBeUndefined();
  });
});
```

En `src/sync/engine.test.ts`, dentro de `describe('runPullCycleNow', …)` (usa config guardada y
`fetch` stubeado como sus tests vecinos), agregar:

```ts
it('después de un pull exitoso corre la limpieza (como mucho una vez cada 24 h)', async () => {
  // …mismo armado de config y fetch que el test "con config guardada, arma el conector real y corre un pull"…
  await runPullCycleNow();
  expect(getLastCleanup()).not.toBeUndefined();
});
```

(importar `getLastCleanup` de `./cleanup-schedule.ts`; copiá el armado de config/`fetch` del test
vecino citado, completo, en vez de referenciarlo).

En `src/ui/format-lot.test.ts` agregar:

```ts
describe('formatCleanup', () => {
  it('sin registro dice que todavía no corrió', () => {
    expect(formatCleanup(undefined)).toEqual({ last: 'Todavía no corrió', anchor: 'Sin turnos cerrados' });
  });

  it('resume lo borrado y el ancla', () => {
    const text = formatCleanup({
      at: '2026-09-24T12:00:00.000Z',
      counts: { sales: 3, stockMovements: 4, accountMovements: 1, outbox: 9, cashSessions: 2 },
      anchorClosedAt: '2026-09-20T18:00:00.000Z',
    });
    expect(text.last).toMatch(/3 ventas, 5 movimientos, 9 eventos, 2 turnos/);
    expect(text.anchor).toMatch(/^Último turno cerrado: /);
  });
});
```

En `src/ui/screens/diagnostico-screen.test.tsx`, sumar al fixture `lastCleanup: undefined,` y el test:

```tsx
  it('muestra la sección de limpieza', () => {
    render(<DiagnosticoScreen />);
    expect(screen.getByText('Limpieza de datos locales')).not.toBeNull();
    expect(screen.getByText('Todavía no corrió')).not.toBeNull();
  });
```

En el test de `pos-console`, sumar `lastCleanup: undefined` al fixture y verificar
`pos.status().limpieza` igual a `{ ultima: 'Todavía no corrió', ancla: 'Sin turnos cerrados' }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/sync/cleanup-schedule.test.ts src/sync/engine.test.ts src/ui`
Expected: FAIL — módulo inexistente, `formatCleanup` no existe, `lastCleanup` fuera de `SyncDiagnostics`.

- [ ] **Step 3: Implement**

```ts
// src/sync/cleanup-schedule.ts
import { runLocalCleanup, type CleanupReport } from '../storage/local-cleanup.ts';
import { getAwaitingLots, getCurrentPushLot } from './push-lot.ts';

/**
 * Cuándo corre la limpieza de datos locales (spec de #98, §4): al arrancar y
 * después de cada pull exitoso, como mucho una vez cada 24 h, con el cerrojo
 * de sync tomado (toca el outbox que lee el push). El registro de la última
 * ejecución vive en `localStorage` (best-effort, como los cursores: si se
 * pierde, la limpieza vuelve a correr antes — nunca borra de más).
 */
const LAST_CLEANUP_KEY = 'offline-pos:cleanup:last-run';
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type CleanupRecord = CleanupReport & { at: string };

export function getLastCleanup(): CleanupRecord | undefined {
  try {
    const raw = localStorage.getItem(LAST_CLEANUP_KEY);
    return raw === null ? undefined : (JSON.parse(raw) as CleanupRecord);
  } catch {
    return undefined;
  }
}

function setLastCleanup(record: CleanupRecord): void {
  try {
    localStorage.setItem(LAST_CLEANUP_KEY, JSON.stringify(record));
  } catch {
    /* best-effort */
  }
}

export function isCleanupDue(last: CleanupRecord | undefined, now: string): boolean {
  return last === undefined || Date.parse(now) - Date.parse(last.at) >= CLEANUP_INTERVAL_MS;
}

/** Eventos de lotes sin resolver: la reaplicación los necesita, la limpieza no los toca. */
export function protectedEventIds(): Set<string> {
  return new Set([
    ...getAwaitingLots().flatMap((lot) => lot.eventIds ?? []),
    ...(getCurrentPushLot()?.eventIds ?? []),
  ]);
}

export async function runCleanupIfDue(params: {
  now: string;
  acquireLock: () => (() => void) | undefined;
}): Promise<void> {
  if (!isCleanupDue(getLastCleanup(), params.now)) {
    return;
  }
  const release = params.acquireLock();
  if (release === undefined) {
    return;
  }
  try {
    const result = await runLocalCleanup({
      now: params.now,
      protectedEventIds: protectedEventIds(),
    });
    if (!result.ok) {
      console.error('[limpieza] no se pudieron borrar los datos locales viejos', result);
      return;
    }
    setLastCleanup({ at: params.now, ...result.value });
  } finally {
    release();
  }
}
```

`src/sync/engine.ts`:

```ts
import { runCleanupIfDue } from './cleanup-schedule.ts';

/** Limpieza a 7 días (#98): nunca con `/CONFIG` abierto; el cerrojo lo toma ella misma. */
async function maybeRunCleanup(): Promise<void> {
  if (syncPausedSignal.value) {
    return;
  }
  await runCleanupIfDue({ now: new Date().toISOString(), acquireLock: tryAcquireSyncLock });
}
```

En `runPullCycleNow`, guardar el resultado y disparar la limpieza **después** de soltar el cerrojo:

```ts
export async function runPullCycleNow(options: { full?: boolean } = {}): Promise<void> {
  let pulled = false;
  await withConnectorCycle(async (connector, now, config) => {
    const full = /* …igual que hoy… */;
    const result = await runPullCycle(connector, now, { full });
    pulled = result.ok;
    if (!full && pushLotIssuesSignal.value !== null) {
      await runPullCycle(connector, now, { full: true });
    }
  });
  if (pulled) {
    await maybeRunCleanup();
  }
}
```

En `startSyncEngine`, reemplazar `void runPushThenPull();` por:

```ts
  // Al arrancar: la limpieza corre aunque no haya red (no depende del backend).
  void runPushThenPull().then(maybeRunCleanup);
```

`src/sync/diagnostics.ts` — `import { getLastCleanup, type CleanupRecord } from './cleanup-schedule.ts';`,
campo `lastCleanup: CleanupRecord | undefined;` y `lastCleanup: getLastCleanup(),`.

`src/ui/format-lot.ts`:

```ts
import type { CleanupRecord } from '../sync/cleanup-schedule.ts';

/** Última limpieza de datos locales y ancla del arqueo (#98) — `/DIAGNOSTICO` y `pos.status()`. */
export function formatCleanup(record: CleanupRecord | undefined): { last: string; anchor: string } {
  if (record === undefined) {
    return { last: 'Todavía no corrió', anchor: 'Sin turnos cerrados' };
  }
  const { counts } = record;
  const movements = counts.stockMovements + counts.accountMovements;
  return {
    last:
      `${new Date(record.at).toLocaleString()} — ${String(counts.sales)} ventas, ` +
      `${String(movements)} movimientos, ${String(counts.outbox)} eventos, ` +
      `${String(counts.cashSessions)} turnos`,
    anchor:
      record.anchorClosedAt !== undefined
        ? `Último turno cerrado: ${new Date(record.anchorClosedAt).toLocaleString()}`
        : 'Sin turnos cerrados',
  };
}
```

`src/ui/screens/diagnostico-screen.tsx` — importar `formatCleanup`; después de la tarjeta "Lotes de
push en espera de confirmación", agregar:

```tsx
      <div style={cardStyle}>
        <p style={labelStyle}>Limpieza de datos locales</p>
        <p style={{ margin: 0 }}>{formatCleanup(diagnostics.lastCleanup).last}</p>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          {formatCleanup(diagnostics.lastCleanup).anchor}
        </p>
      </div>
```

(El `<p style={labelStyle}>` renderiza "Limpieza de datos locales" tal cual; el `textTransform` es solo
CSS, así que `getByText` lo encuentra.)

`src/ui/console/pos-console.ts` — en `PosStatus`: `limpieza: { ultima: string; ancla: string };`; en
`formatStatus`: `limpieza: (({ last, anchor }) => ({ ultima: last, ancla: anchor }))(formatCleanup(diagnostics.lastCleanup)),`
(importar `formatCleanup`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/sync src/ui src/storage src/domain`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/sync/cleanup-schedule.ts src/sync/cleanup-schedule.test.ts src/sync/engine.ts src/sync/engine.test.ts src/sync/diagnostics.ts src/ui/format-lot.ts src/ui/format-lot.test.ts src/ui/screens/diagnostico-screen.tsx src/ui/screens/diagnostico-screen.test.tsx src/ui/console/pos-console.ts src/ui/console/pos-console.test.ts
git commit -m "feat(sync): limpieza a 7 días al arrancar y tras cada pull, visible en /DIAGNOSTICO (#98)"
```

---

### Task 11: Contrato, minibackend, README de Sheets y CLAUDE.md

**Files:**
- Modify: `docs/connector-api.openapi.yaml` (descripción de `/sync/pull`, `pendingLotIds`, `balance`)
- Modify: `demo-backend/test/routes/sync.test.ts`
- Modify: `src/connectors/google-sheets/README.md` (fila `pullBatch` de la tabla, línea ~109)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the minibackend test (documenta el requisito del cursor de saldo)**

En `demo-backend/test/routes/sync.test.ts`, dentro del mismo `describe` que el test `'con cursor trae
solo lo actualizado después, y devuelve nextCursor'`, agregar:

```ts
  it('un fiado sin hold mueve el saldo y el cursor del cliente (el POS lo ve en el delta)', async () => {
    const first = (await (await pull({ cursors: {}, pendingLotIds: [] })).json()) as {
      customers: { items: { id: string; balance?: number }[]; nextCursor?: string };
    };
    const withAccount = first.customers.items.find((item) => item.balance !== undefined);
    expect(withAccount).toBeDefined();
    const cursor = first.customers.nextCursor ?? '';

    await push('lot-balance', [
      {
        id: 'sale-balance',
        type: 'sale',
        createdAt: new Date().toISOString(),
        origin: {},
        sale: {
          id: 'sale-balance',
          customerId: withAccount?.id,
          payments: [{ method: 'account', amount: 10 }],
          lines: [],
          total: 10,
          status: 'closed',
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    const delta = (await (await pull({ cursors: { customers: cursor }, pendingLotIds: [] })).json()) as {
      customers: { items: { id: string; balance?: number }[] };
    };
    const updated = delta.customers.items.find((item) => item.id === withAccount?.id);
    expect(updated?.balance).toBe((withAccount?.balance ?? 0) + 10);
  });
```

Si el seed del minibackend no llegara a tener un cliente con cuenta en la base en memoria del test,
revisá cómo los otros tests de ese archivo siembran clientes (`seed`/fixtures) y usá el mismo armado.
Si los timestamps de `updated_at` coinciden al milisegundo con el cursor, esperá 5 ms antes del push
(`await new Promise((resolve) => setTimeout(resolve, 5));`).

- [ ] **Step 2: Run it**

Run: `pnpm test:backend`
Expected: PASS sin cambios de código en el minibackend (ya cumple: `adjustBalance` actualiza
`updated_at`). Si falla por el motivo real (el cursor no se mueve), frená y avisá — el spec dice que
el minibackend ya cumple.

- [ ] **Step 3: Contrato**

En `docs/connector-api.openapi.yaml`, dentro de la `description` de `POST /sync/pull`, reemplazar el
párrafo que empieza en "`lots` en la respuesta solo trae estado…" y el de "**Regla de aplicación**…"
por:

```yaml
        `lots` en la respuesta trae estado para los ids de `pendingLotIds`
        que el backend recibió; un id que no recibió se omite. Del lado del
        POS, un lote con ack que no viene informado cuenta como `processing`;
        el lote que el POS mandó sin recibir ack (también viaja en
        `pendingLotIds`) y no viene informado, como **no recibido**. Si viene
        informado, el POS lo toma como un ack recuperado y no lo reenvía.

        **Consistencia**: la foto (productos, clientes con su saldo, stock) y
        los estados de lote tienen que ser **del mismo instante**. Un lote
        `queued` todavía no tiene ningún efecto en la foto; uno `ok`/`issues`
        ya los tiene todos. Todo cambio de saldo de un cliente mueve su
        cursor (`updatedAt`), así viaja en el pull por delta.

        **Regla de aplicación del POS (Etapa 3 del epic #94, #98)**: datos
        maestros y bloqueos de productos y clientes se aplican siempre. Stock
        y saldos: si algún lote sigue `processing` (o equivalente), el POS
        conserva los suyos y no avanza el cursor de clientes; si no, toma los
        del backend y les reaplica los efectos de los eventos de lotes
        `queued` y de los que todavía no envió. El backend puede bloquear
        productos y clientes por lo que surja al procesar un lote, aun
        mientras está `processing`. Un lote `issues` nunca bloquea: el POS
        solo le muestra los avisos al humano.
```

y en `PullBatchRequest.pendingLotIds.description`:

```yaml
          description: |
            idempotency_id de lotes de push que el POS mandó y todavía no
            confirmó ok/issues, más el lote en curso cuyo ack no llegó (si hay
            uno). El backend informa solo los que recibió.
```

- [ ] **Step 4: README de Sheets**

En la fila `pullBatch` de la tabla "Qué hace cada operación" de
`src/connectors/google-sheets/README.md`, después de "…nunca informa `queued`/`processing`.",
agregar: "Como todo el request corre con el lock del script, la foto y los estados de lote son
siempre del mismo instante (requisito del contrato); y como no trae stock ni saldo, la reaplicación de
eventos del POS (#98) no hace nada con este conector."

- [ ] **Step 5: CLAUDE.md**

- En "Patrón outbox", reemplazar el párrafo **"Pull: un solo lote, gateado por el estado de los lotes
  de push (#87)"** por uno que describa la regla de la Etapa 3: el lote en curso viaja en
  `pendingLotIds` (ack recuperado / no recibido, `sync/pull-rule.ts::classifyLots`); datos maestros y
  bloqueos siempre; stock y saldo del backend + reaplicación (`domain/reapply.ts`,
  `sync/pull-adjust.ts`, `storage/apply-pull.ts`, una transacción que lee el outbox) o retenidos con
  un lote `processing` (cursor de clientes sin avanzar, foto completa que no cuenta como hecha);
  `AwaitingLot.eventIds`; `lastPullApplicationSignal` y `PullApplication`; `sync/pending-lot`
  eliminado. Mantener la referencia a `/DIAGNOSTICO`.
- En "Log de intentos y `/DIAGNOSTICO`": un pull que retiene va a `console.info` (ya no el descarte
  por lote en curso); el log guarda `application`.
- Sumar un párrafo **"Limpieza a 7 días (#98)"** en "Patrón outbox": regla
  (`domain/local-cleanup.ts::planLocalCleanup`), ancla (último turno cerrado + abierto hasta la Etapa
  5), protegidos (eventos de lotes sin resolver), cadencia (`sync/cleanup-schedule.ts`, arranque + tras
  pull exitoso, 24 h, cerrojo, `offline-pos:cleanup:last-run`), efecto conocido (`/ANULAR` pierde las
  ventas borradas), `accountMovements` sin venta se conservan.
- En "Barra de estado": el sufijo "· stock y saldos en espera del backend" en `online-idle`.
- En "Estado del proyecto": entrada nueva para la Etapa 3 del epic #94 (issue #98, spec y plan de
  esta etapa), con la desviación del plan (`accountMovements` sin `saleId`) y la issue `backlog` del
  cálculo por ítem.

- [ ] **Step 6: Verificar y commitear**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:backend`
Expected: todo en verde.

```bash
git add docs/connector-api.openapi.yaml demo-backend/test/routes/sync.test.ts src/connectors/google-sheets/README.md CLAUDE.md
git commit -m "docs: contrato, README de Sheets y CLAUDE.md para el pull reaplicado y la limpieza (#98)"
```

---

### Task 12: Verificación completa y prueba en navegador

**Files:** ninguno nuevo (solo si algo falla).

- [ ] **Step 1: Suite completa**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:backend && pnpm build && pnpm test:e2e`
Expected: todo en verde. Los e2e no dependen de `sync/pending-lot` (verificado al escribir el plan);
si alguno falla, diagnosticar con superpowers:systematic-debugging antes de tocar código.

- [ ] **Step 2: Levantar app + minibackend**

Run: `pnpm dev` (Vite + minibackend). Configurar `/CONFIG` con "REST (minibackend de demo)",
`http://localhost:4000`. Abrir el panel `http://localhost:4000/_demo` y encender **"Demorar lotes
nuevos"**.

- [ ] **Step 3: Instrucciones para el usuario (van en el reporte final)**

1. Abrir turno (`/CAJA`), vender un producto con stock → el stock local baja. Esperar el push (o
   `/SINCRONIZAR`) → en `/DIAGNOSTICO` el lote aparece "en cola · N eventos".
   Esperado tras el pull: "Aplicado + N eventos reaplicados"; el stock sigue en el valor local. Cambiar
   el nombre o bloquear un producto en el panel y ver que llega igual en el próximo pull.
2. En el panel, "Empezar" el lote → `/SINCRONIZAR`. Esperado: `/DIAGNOSTICO` dice "Stock y saldos
   retenidos: lote … procesando — cursor de clientes retenido"; la barra, "Sincronizado (…) · … ·
   stock y saldos en espera del backend", en verde (no error). Un bloqueo nuevo en el panel llega igual.
3. "Terminar OK" → `/SINCRONIZAR`. Esperado: "Aplicado completo"; el stock coincide con el del panel;
   el aviso de la barra desaparece.
4. Venta a cuenta corriente sin red (fiado offline, cortando la red del navegador antes de `/CUENTA`)
   con el lote demorado: el saldo del cliente se comporta igual que el stock en los pasos 1-3.
5. Ack perdido: no se puede forzar a mano con la UI — cubierto por los tests del motor (`engine.test.ts`,
   "recupera el ack" y "no recibido").
6. Limpieza: cubierta por tests. Opcional: en DevTools → Application → IndexedDB → `offline-pos` →
   `sales`, cambiar el `createdAt` de una venta sincronizada a hace 10 días (y el de su evento en
   `outbox`), borrar `offline-pos:cleanup:last-run` de Local Storage, recargar y ver en
   `/DIAGNOSTICO` → "Limpieza de datos locales" la venta borrada. Si la venta es del último turno
   cerrado o del abierto, **no** se borra (ancla).
```
