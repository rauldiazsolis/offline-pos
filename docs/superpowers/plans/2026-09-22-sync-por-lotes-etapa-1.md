# Sincronización por lotes — Etapa 1: núcleo + REST de referencia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el contrato de sync por-recurso/por-evento (10 endpoints, N requests por ciclo)
por dos operaciones batch (`pushBatch`/`pullBatch`) con cadencias propias, backend REST de
referencia incluido, dejando Google Sheets con un adaptador de compatibilidad (Etapa 2 le da su
propia reescritura de `bridge.gs`).

**Architecture:** El puerto `Connector` pasa de 10 métodos a 2 (`pushBatch`, `pullBatch`) más
`requestAccountHold` (síncrono, sin cambios). El backoff de outbox pasa de por-evento a por-lote
(`domain/push-lot.ts`, nuevo — mismo patrón que `domain/outbox.ts` pero a nivel de lote,
persistido en `localStorage` vía `sync/push-lot.ts`, mismo criterio best-effort que
`sync/cursor.ts`). `sync/engine.ts` separa push y pull en dos ciclos independientes con cadencias
propias; un pull nunca aplica datos mientras algún lote de push que le interesa siga `pending` en
el backend. `demo-backend` y `connectors/rest/` implementan el contrato nuevo de punta a punta;
`connectors/google-sheets/` recibe un adaptador mecánico que sigue llamando a los mismos endpoints
de `bridge.gs` sin cambios (Etapa 2 le da un batch real del lado del puente).

**Tech Stack:** TypeScript estricto, Zod, Dexie, Vitest + Testing Library, Playwright (e2e contra
build real), Node `node:sqlite` (demo-backend), `ulid`.

**Spec:** `docs/superpowers/specs/2026-09-22-sync-por-lotes-design.md` (issue #87) — el plan
argumenta a partir del spec, que viaja con él; quien ejecute cada tarea lee los dos.

## Global Constraints

- `any` prohibido sin excepción; `unknown` solo en la firma de una función que recibe algo externo
  y lo valida con Zod en la línea siguiente (CLAUDE.md, "TypeScript estricto").
- Toda función de negocio devuelve `Result<T>` (`domain/result.ts`), nunca lanza — `try/catch` solo
  en los adaptadores que envuelven algo que sí lanza por naturaleza (`fetch`, Dexie, `JSON.parse`).
- IDs generados en el cliente son ULID (`storage/ids.ts::newId`), siempre — incluido el
  `idempotency_id` de un lote de push.
- Backend nunca rechaza: el minibackend de demo no simula ningún camino de error de negocio, solo
  falla ante problemas de transporte reales (auth, JSON inválido).
- No agregar dependencias nuevas si el motor de sync existente ya resuelve el problema (reintentos,
  backoff) — ver CLAUDE.md, nota de Fase 2 sobre TanStack Query.
- Cada archivo de test que toque Dexie importa `'fake-indexeddb/auto'` al principio.
- Un `ErrorCode` nuevo se agrega a `ErrorMeta` (`domain/result.ts`) y se traduce en el `switch`
  exhaustivo de `ui/errors.ts::describeError` en la misma tarea que lo introduce — nunca se deja
  pendiente (el `default: never` no compila si falta).

---

## Decisiones de diseño de esta etapa (contexto para quien ejecute)

Estas resuelven los "Puntos a resolver en el plan" del spec, confirmadas con el usuario antes de
escribir este documento:

1. **`idempotency_id` del lote**: ULID generado una vez al construir el lote, **congelado** junto
   con el conjunto exacto de `id`s de eventos incluidos — un reintento del mismo lote reenvía
   siempre el mismo id y el mismo conjunto, nunca se recalcula agregando eventos nuevos que hayan
   entrado al outbox mientras ese lote seguía en vuelo (evita duplicar un lote que sí llegó pero
   cuyo ack se perdió). El backend resuelve cualquier duplicado como pueda — no es responsabilidad
   del POS garantizar una dedup perfecta más allá de esto.
2. **Semántica de `/SINCRONIZAR`**: fuerza el push del lote pendiente ya (ignorando su backoff) y
   un pull completo ya (ignorando la cadencia de 2 h), en ese orden.
3. **Cerrojo de sync**: se reusa el mismo `tryAcquireSyncLock`/`acquireSyncLockWaiting` que ya
   existe — cada request individual (un push, un pull delta, un pull completo) lo toma y lo suelta
   alrededor de sí mismo, nunca durante todo el intervalo de espera entre ciclos.
4. **Alcance de conectores en esta etapa**: `connectors/rest/` y `demo-backend/` implementan el
   contrato nuevo de punta a punta. `connectors/google-sheets/` recibe un adaptador mecánico
   (mismos endpoints de `bridge.gs` de hoy, sin tocar el puente) que sigue funcionando —
   `bridge.gs` en sí (batch real, lock puertas adentro) es alcance de la Etapa 2.

Qué reemplaza esta etapa (queda sin efecto): `pushOnce`/`pushPendingEvents` por evento,
`SYNC_INTERVAL_MS` de 5 min + foto completa cada 1 h (PR #83/#84), el backoff por evento de
`domain/outbox.ts` (`markFailed`/`isDue`/`isSyncStruggling`/`nextRetryDelayMs`).

---

### Task 1: `domain/push-lot.ts` — backoff a nivel de lote (pura, nueva)

**Files:**
- Create: `src/domain/push-lot.ts`
- Test: `src/domain/push-lot.test.ts`

**Interfaces:**
- Consumes: nada (módulo de dominio puro, sin dependencias de storage/sync).
- Produces: `PushLot`, `buildPushLot(eventIds: string[], params: { id: string; now: string }): PushLot`,
  `markLotFailed(lot: PushLot, params: { now: string; error: string }): PushLot`,
  `isLotDue(lot: PushLot, now: string): boolean`, `nextRetryDelayMs(retries: number): number`,
  `isPushStruggling(lot: PushLot | undefined): boolean`, `PUSH_ERROR_RETRY_THRESHOLD`. Task 2 y
  Task 7 consumen estos nombres tal cual.

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// src/domain/push-lot.test.ts
import { describe, expect, it } from 'vitest';
import {
  buildPushLot,
  isLotDue,
  isPushStruggling,
  markLotFailed,
  nextRetryDelayMs,
  PUSH_ERROR_RETRY_THRESHOLD,
} from './push-lot.ts';

describe('nextRetryDelayMs', () => {
  it('backoff exponencial con techo de 5 minutos', () => {
    expect(nextRetryDelayMs(0)).toBe(1000);
    expect(nextRetryDelayMs(1)).toBe(2000);
    expect(nextRetryDelayMs(2)).toBe(4000);
    expect(nextRetryDelayMs(20)).toBe(5 * 60 * 1000);
  });
});

describe('buildPushLot', () => {
  it('arranca en retries=0 y nextAttemptAt=now, con el id y los eventIds congelados', () => {
    const lot = buildPushLot(['e1', 'e2'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' });
    expect(lot).toEqual({
      id: 'lot-1',
      eventIds: ['e1', 'e2'],
      createdAt: '2026-01-01T00:00:00.000Z',
      retries: 0,
      nextAttemptAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('markLotFailed', () => {
  it('suma un reintento, guarda el error y calcula el próximo intento con backoff', () => {
    const lot = buildPushLot(['e1'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' });

    const failed = markLotFailed(lot, { now: '2026-01-01T00:00:00.000Z', error: 'sync/request-failed' });

    expect(failed.retries).toBe(1);
    expect(failed.lastError).toBe('sync/request-failed');
    expect(failed.nextAttemptAt).toBe('2026-01-01T00:00:02.000Z'); // +2000ms (retries=1)
    expect(failed.id).toBe('lot-1');
    expect(failed.eventIds).toEqual(['e1']); // el conjunto no cambia al fallar
  });
});

describe('isLotDue', () => {
  it('true si nextAttemptAt ya pasó, false si es futuro', () => {
    const lot = markLotFailed(buildPushLot(['e1'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' }), {
      now: '2026-01-01T00:00:00.000Z',
      error: 'x',
    });

    expect(isLotDue(lot, '2026-01-01T00:00:01.000Z')).toBe(false); // backoff de 2s todavía no pasó
    expect(isLotDue(lot, '2026-01-01T00:00:02.500Z')).toBe(true);
  });
});

describe('isPushStruggling', () => {
  it('false sin lote o con pocos reintentos, true al llegar al umbral', () => {
    expect(isPushStruggling(undefined)).toBe(false);

    let lot = buildPushLot(['e1'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' });
    for (let i = 0; i < PUSH_ERROR_RETRY_THRESHOLD - 1; i += 1) {
      lot = markLotFailed(lot, { now: '2026-01-01T00:00:00.000Z', error: 'x' });
    }
    expect(isPushStruggling(lot)).toBe(false);

    lot = markLotFailed(lot, { now: '2026-01-01T00:00:00.000Z', error: 'x' });
    expect(isPushStruggling(lot)).toBe(true);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `pnpm vitest run src/domain/push-lot.test.ts`
Expected: FAIL — `push-lot.ts` no existe todavía.

- [ ] **Step 3: Implementación mínima**

```typescript
// src/domain/push-lot.ts
/**
 * Backoff de un LOTE de push (Fase de rediseño de sync, #87) — mismo patrón
 * que el backoff por-evento que reemplaza (ver git blame de domain/outbox.ts),
 * pero a nivel de lote: con push batch (un solo idempotency_id por ciclo de
 * envío), el reintento es del lote entero, no de un evento individual.
 */
export type PushLot = {
  /** ULID, congelado junto con `eventIds` para toda la vida de este lote — ver CLAUDE.md. */
  id: string;
  /** Conjunto exacto de outbox.id incluidos — nunca se recalcula en un reintento. */
  eventIds: string[];
  createdAt: string;
  retries: number;
  nextAttemptAt: string;
  lastError?: string;
};

const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

/** Backoff exponencial con techo, determinístico (sin jitter aleatorio) — igual que el que reemplaza. */
export function nextRetryDelayMs(retries: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** retries, MAX_RETRY_DELAY_MS);
}

export function buildPushLot(eventIds: string[], params: { id: string; now: string }): PushLot {
  return {
    id: params.id,
    eventIds,
    createdAt: params.now,
    retries: 0,
    nextAttemptAt: params.now,
  };
}

/** Registra un intento fallido: suma un reintento y calcula cuándo reintentar. El id y los eventIds no cambian. */
export function markLotFailed(lot: PushLot, params: { now: string; error: string }): PushLot {
  const retries = lot.retries + 1;
  const nextAttemptAt = new Date(
    new Date(params.now).getTime() + nextRetryDelayMs(retries),
  ).toISOString();
  return { ...lot, retries, nextAttemptAt, lastError: params.error };
}

/** true si ya pasó la ventana de backoff del lote. */
export function isLotDue(lot: PushLot, now: string): boolean {
  return new Date(lot.nextAttemptAt).getTime() <= new Date(now).getTime();
}

export const PUSH_ERROR_RETRY_THRESHOLD = 3;

/** true si el lote en vuelo lleva varios reintentos fallidos seguidos — dispara `sync-error` en la barra. */
export function isPushStruggling(lot: PushLot | undefined): boolean {
  return lot !== undefined && lot.retries >= PUSH_ERROR_RETRY_THRESHOLD;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `pnpm vitest run src/domain/push-lot.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/push-lot.ts src/domain/push-lot.test.ts
git commit -m "feat(sync): backoff de push a nivel de lote (domain/push-lot.ts)"
```

---

### Task 2: `domain/outbox.ts` — simplificar `OutboxEvent` (sin retry por evento)

**Files:**
- Modify: `src/domain/outbox.ts`
- Modify: `src/domain/outbox.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `OutboxEvent = OutboxEventPayload & { id: string; status: 'pending' | 'synced'; createdAt: string }`
  (sin `retries`/`nextAttemptAt`/`lastError`), `buildOutboxEventForSale`, `buildOutboxEventsForStockMovements`,
  `buildOutboxEventForVoid`, `buildOutboxEventForCustomer`, `buildOutboxEventForHoldConfirm`,
  `buildOutboxEventForHoldRelease`, `buildOutboxEventForCashSession` (misma firma, sin los campos de
  retry), `markSynced(event: OutboxEvent): OutboxEvent`. Se **eliminan** `nextRetryDelayMs`,
  `markFailed`, `isDue`, `isSyncStruggling`, `SYNC_ERROR_RETRY_THRESHOLD` (ahora viven en
  `domain/push-lot.ts`, Task 1). Task 6 (`sync/engine.ts`) consume los builders + `markSynced`.

- [ ] **Step 1: Actualizar el test — quitar los casos de retry por evento, ajustar los que quedan**

Reemplazar el contenido de `src/domain/outbox.test.ts` completo (los imports de
`isDue`/`isSyncStruggling`/`markFailed`/`nextRetryDelayMs`/`SYNC_ERROR_RETRY_THRESHOLD` y sus
`describe` correspondientes se borran — esa cobertura ya vive en `push-lot.test.ts`, Task 1):

```typescript
// src/domain/outbox.test.ts
import { describe, expect, it } from 'vitest';
import type { Sale } from './sale.ts';
import {
  buildOutboxEventForCashSession,
  buildOutboxEventForCustomer,
  buildOutboxEventForHoldConfirm,
  buildOutboxEventForHoldRelease,
  buildOutboxEventForSale,
  buildOutboxEventForVoid,
  buildOutboxEventsForStockMovements,
  markSynced,
} from './outbox.ts';

const sale: Sale = {
  id: 'sale-1',
  lines: [],
  payments: [],
  total: 0,
  status: 'closed',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const now = '2026-01-01T00:00:00.000Z';

describe('buildOutboxEventForSale', () => {
  it('arranca pending, con el id de la venta como id del evento', () => {
    const event = buildOutboxEventForSale(sale, { now });
    expect(event).toEqual({ type: 'sale', sale, id: 'sale-1', status: 'pending', createdAt: now });
  });
});

describe('buildOutboxEventsForStockMovements', () => {
  it('un evento por movimiento, cada uno con el id del movimiento', () => {
    const movements = [
      { id: 'm1', productId: 'p1', delta: -1, reason: 'sale' as const, saleId: 'sale-1', createdAt: now },
      { id: 'm2', productId: 'p2', delta: -2, reason: 'sale' as const, saleId: 'sale-1', createdAt: now },
    ];
    const events = buildOutboxEventsForStockMovements(movements, { now });
    expect(events.map((e) => e.id)).toEqual(['m1', 'm2']);
    expect(events[0]).toMatchObject({ type: 'stock-movement', status: 'pending' });
  });
});

describe('buildOutboxEventForVoid', () => {
  it('id propio, distinto del id de la venta anulada', () => {
    const event = buildOutboxEventForVoid({
      id: 'void-1',
      saleId: 'sale-1',
      voidedAt: now,
      voidReason: 'error de cobro',
      now,
    });
    expect(event).toEqual({
      type: 'sale-void',
      saleId: 'sale-1',
      voidedAt: now,
      voidReason: 'error de cobro',
      id: 'void-1',
      status: 'pending',
      createdAt: now,
    });
  });
});

describe('buildOutboxEventForCustomer', () => {
  it('id del cliente como id del evento', () => {
    const customer = { id: 'c1', name: 'Juan Pérez', createdAt: now };
    expect(buildOutboxEventForCustomer(customer, { now })).toEqual({
      type: 'customer',
      customer,
      id: 'c1',
      status: 'pending',
      createdAt: now,
    });
  });
});

describe('buildOutboxEventForHoldConfirm / HoldRelease', () => {
  it('confirm lleva holdId y saleId, con id propio', () => {
    const event = buildOutboxEventForHoldConfirm({ id: 'confirm-1', holdId: 'hold-1', saleId: 'sale-1', now });
    expect(event).toEqual({
      type: 'account-hold-confirm',
      holdId: 'hold-1',
      saleId: 'sale-1',
      id: 'confirm-1',
      status: 'pending',
      createdAt: now,
    });
  });

  it('release lleva holdId, con id propio', () => {
    const event = buildOutboxEventForHoldRelease({ id: 'release-1', holdId: 'hold-1', now });
    expect(event).toEqual({
      type: 'account-hold-release',
      holdId: 'hold-1',
      id: 'release-1',
      status: 'pending',
      createdAt: now,
    });
  });
});

describe('buildOutboxEventForCashSession', () => {
  it('id del turno como id del evento', () => {
    const session = { id: 'cs1', openedAt: now, openingAmount: 500, sales: ['s1'] };
    expect(buildOutboxEventForCashSession(session, { now })).toEqual({
      type: 'cash-session',
      session,
      id: 'cs1',
      status: 'pending',
      createdAt: now,
    });
  });
});

describe('markSynced', () => {
  it('pasa el evento a synced sin tocar el resto de los campos', () => {
    const event = buildOutboxEventForSale(sale, { now });
    expect(markSynced(event)).toEqual({ ...event, status: 'synced' });
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run src/domain/outbox.test.ts`
Expected: FAIL — los objetos todavía incluyen `retries`/`nextAttemptAt` (`toEqual` los detecta de más).

- [ ] **Step 3: Simplificar la implementación**

Reemplazar `src/domain/outbox.ts` completo:

```typescript
// src/domain/outbox.ts
import type { CashSession } from './cash-session.ts';
import type { Customer } from './customer.ts';
import type { Sale } from './sale.ts';
import type { StockMovement } from './stock.ts';

export type OutboxEventPayload =
  | { type: 'sale'; sale: Sale }
  | { type: 'stock-movement'; movement: StockMovement }
  | { type: 'sale-void'; saleId: string; voidedAt: string; voidReason?: string }
  | { type: 'customer'; customer: Customer }
  | { type: 'account-hold-confirm'; holdId: string; saleId: string }
  | { type: 'account-hold-release'; holdId: string }
  | { type: 'cash-session'; session: CashSession };

/**
 * Evento inmutable de sincronización (ver "Patrón outbox" en CLAUDE.md). El
 * reintento/backoff ya no es por evento — es por LOTE de push
 * (`domain/push-lot.ts`, #87) — así que `OutboxEvent` solo necesita saber si
 * ya viajó (`status`) y cuándo se creó (orden de armado del lote,
 * `createdAt`). `id` es también el id que identifica al evento dentro del
 * lote que lo incluye — para 'sale', 'stock-movement' y 'customer' es el id
 * de la propia entidad (la entidad ES el evento a sincronizar); 'sale-void',
 * 'account-hold-confirm' y 'account-hold-release' son operaciones distintas
 * sobre un recurso ya enviado, así que cada una necesita su propio id nuevo.
 */
export type OutboxEvent = OutboxEventPayload & {
  id: string;
  status: 'pending' | 'synced';
  createdAt: string; // ISO 8601 — también el orden FIFO al armar un lote
};

export function buildOutboxEventForSale(sale: Sale, params: { now: string }): OutboxEvent {
  return { type: 'sale', sale, id: sale.id, status: 'pending', createdAt: params.now };
}

export function buildOutboxEventsForStockMovements(
  movements: StockMovement[],
  params: { now: string },
): OutboxEvent[] {
  return movements.map((movement) => ({
    type: 'stock-movement',
    movement,
    id: movement.id,
    status: 'pending',
    createdAt: params.now,
  }));
}

export function buildOutboxEventForVoid(params: {
  id: string;
  saleId: string;
  voidedAt: string;
  voidReason?: string;
  now: string;
}): OutboxEvent {
  return {
    type: 'sale-void',
    saleId: params.saleId,
    voidedAt: params.voidedAt,
    ...(params.voidReason !== undefined ? { voidReason: params.voidReason } : {}),
    id: params.id,
    status: 'pending',
    createdAt: params.now,
  };
}

export function buildOutboxEventForCustomer(customer: Customer, params: { now: string }): OutboxEvent {
  return { type: 'customer', customer, id: customer.id, status: 'pending', createdAt: params.now };
}

export function buildOutboxEventForHoldConfirm(params: {
  id: string;
  holdId: string;
  saleId: string;
  now: string;
}): OutboxEvent {
  return {
    type: 'account-hold-confirm',
    holdId: params.holdId,
    saleId: params.saleId,
    id: params.id,
    status: 'pending',
    createdAt: params.now,
  };
}

export function buildOutboxEventForHoldRelease(params: {
  id: string;
  holdId: string;
  now: string;
}): OutboxEvent {
  return {
    type: 'account-hold-release',
    holdId: params.holdId,
    id: params.id,
    status: 'pending',
    createdAt: params.now,
  };
}

export function buildOutboxEventForCashSession(
  session: CashSession,
  params: { now: string },
): OutboxEvent {
  return { type: 'cash-session', session, id: session.id, status: 'pending', createdAt: params.now };
}

/** Marca un evento como enviado con éxito (el lote que lo incluía recibió su ack). */
export function markSynced(event: OutboxEvent): OutboxEvent {
  return { ...event, status: 'synced' };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run src/domain/outbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck del resto del repo (va a fallar — esperado en esta tarea)**

Run: `pnpm typecheck`
Expected: FAIL en `sync/engine.ts` y `sync/engine.test.ts` (todavía importan `isDue`/`markFailed`/etc.) —
se arregla en la Task 7. No commitear todavía sin este chequeo roto documentado: seguir a la Task 3.

- [ ] **Step 6: Commit**

```bash
git add src/domain/outbox.ts src/domain/outbox.test.ts
git commit -m "refactor(sync): OutboxEvent sin retry por evento — el backoff pasa a domain/push-lot.ts"
```

---

### Task 3: `domain/result.ts` + `ui/errors.ts` — códigos de error nuevos

**Files:**
- Modify: `src/domain/result.ts`
- Modify: `src/ui/errors.ts`
- Modify: `src/ui/errors.test.ts` (si no existe, crear — ver Step 1)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: dos entradas nuevas en `ErrorMeta`: `'sync/pending-lot': undefined` (un pull se
  descartó porque algún lote de push que le interesaba seguía `pending`) y
  `'sync/push-issues': { issues: string[] }` (el backend reportó problemas en un lote ya resuelto —
  puramente informativo, nunca bloquea). Task 8 (`sync/engine.ts`, pull) y Task 9 (cadencias)
  construyen estos `Failure`/aviso. `describeError` los traduce.

- [ ] **Step 1: Test — agregar (o crear) los casos para los dos códigos nuevos**

Si `src/ui/errors.test.ts` no existe todavía, crearlo con exactamente este contenido (los demás
códigos ya tienen cobertura de tipos vía el `switch` exhaustivo; este archivo solo necesita cubrir
los dos casos nuevos para guiar el TDD de esta tarea):

```typescript
// src/ui/errors.test.ts
import { describe, expect, it } from 'vitest';
import { err } from '../domain/result.ts';
import { describeError } from './errors.ts';

describe('describeError — códigos de sync por lotes (#87)', () => {
  it('sync/pending-lot: explica que se esperó a que un envío anterior se confirme', () => {
    const message = describeError(err('sync/pending-lot', undefined));
    expect(message).toMatch(/envío anterior/i);
  });

  it('sync/push-issues: incluye el primer issue reportado por el backend', () => {
    const message = describeError(err('sync/push-issues', { issues: ['stock insuficiente en p1'] }));
    expect(message).toContain('stock insuficiente en p1');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run src/ui/errors.test.ts`
Expected: FAIL — `err('sync/pending-lot', ...)` no compila / `describeError` no tiene esos casos
todavía (si corre con `vitest run` sin typecheck previo, el fallo será en runtime por `exhaustiveCheck`
lanzando; si el proyecto tipa antes de correr, falla en la compilación — cualquiera de los dos es la
señal esperada).

- [ ] **Step 3: Agregar los códigos a `ErrorMeta`**

En `src/domain/result.ts`, agregar dentro de `ErrorMeta`, junto a los demás códigos de `sync/*`:

```typescript
  // sync/engine.ts (pull batch, #87): un lote de push que nos interesa sigue sin resolverse
  'sync/pending-lot': undefined;
  // sync/engine.ts: el backend reportó problemas en un lote ya resuelto — informativo, no bloquea
  'sync/push-issues': { issues: string[] };
```

(Ubicarlas junto al comentario existente `// sync/config.ts, sync/engine.ts, connectors/rest/rest-fetch-connector.ts`.)

- [ ] **Step 4: Traducir los códigos en `ui/errors.ts`**

En el `switch` de `describeError`, agregar (junto a los demás casos de `sync/*`):

```typescript
    case 'sync/pending-lot':
      return 'Se pausó la aplicación de datos: todavía se está confirmando un envío anterior. Se reintenta solo.';
    case 'sync/push-issues':
      return `El sistema externo reportó un problema con un envío ya confirmado: ${failure.meta.issues[0] ?? ''}`;
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `pnpm vitest run src/ui/errors.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck completo**

Run: `pnpm typecheck`
Expected: los errores de la Task 2 en `sync/engine.ts`/`sync/engine.test.ts` siguen ahí (se arreglan
en Task 7); no debería haber errores nuevos originados en `result.ts`/`errors.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/domain/result.ts src/ui/errors.ts src/ui/errors.test.ts
git commit -m "feat(sync): códigos de error sync/pending-lot y sync/push-issues"
```

---

### Task 4: `sync/push-lot.ts` — persistencia del lote en curso (localStorage)

**Files:**
- Create: `src/sync/push-lot.ts`
- Test: `src/sync/push-lot.test.ts`

**Interfaces:**
- Consumes: `PushLot` de `domain/push-lot.ts` (Task 1).
- Produces: `getCurrentPushLot(): PushLot | undefined`, `setCurrentPushLot(lot: PushLot): void`,
  `clearCurrentPushLot(): void`, `AwaitingLot = { id: string; sentAt: string }`,
  `getAwaitingLots(): AwaitingLot[]`, `addAwaitingLot(lot: AwaitingLot): void`,
  `resolveAwaitingLots(resolvedIds: Set<string>): void`, `clearPushLotState(): void`. Task 7 (push)
  y Task 8 (pull) consumen todo esto; Task 10 (`apply-connection.ts`/`demo-reset.ts`) consume
  `clearPushLotState`.

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// src/sync/push-lot.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { buildPushLot } from '../domain/push-lot.ts';
import {
  addAwaitingLot,
  clearCurrentPushLot,
  clearPushLotState,
  getAwaitingLots,
  getCurrentPushLot,
  resolveAwaitingLots,
  setCurrentPushLot,
} from './push-lot.ts';

beforeEach(() => {
  localStorage.clear();
});

describe('lote en curso', () => {
  it('undefined si nunca se guardó nada', () => {
    expect(getCurrentPushLot()).toBeUndefined();
  });

  it('guarda y devuelve el mismo lote', () => {
    const lot = buildPushLot(['e1', 'e2'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' });
    setCurrentPushLot(lot);
    expect(getCurrentPushLot()).toEqual(lot);
  });

  it('clearCurrentPushLot lo borra', () => {
    setCurrentPushLot(buildPushLot(['e1'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' }));
    clearCurrentPushLot();
    expect(getCurrentPushLot()).toBeUndefined();
  });
});

describe('lotes esperando resolución', () => {
  it('arranca vacío', () => {
    expect(getAwaitingLots()).toEqual([]);
  });

  it('addAwaitingLot acumula', () => {
    addAwaitingLot({ id: 'lot-1', sentAt: '2026-01-01T00:00:00.000Z' });
    addAwaitingLot({ id: 'lot-2', sentAt: '2026-01-01T00:01:00.000Z' });
    expect(getAwaitingLots().map((l) => l.id)).toEqual(['lot-1', 'lot-2']);
  });

  it('resolveAwaitingLots saca solo los ids resueltos', () => {
    addAwaitingLot({ id: 'lot-1', sentAt: '2026-01-01T00:00:00.000Z' });
    addAwaitingLot({ id: 'lot-2', sentAt: '2026-01-01T00:01:00.000Z' });

    resolveAwaitingLots(new Set(['lot-1']));

    expect(getAwaitingLots().map((l) => l.id)).toEqual(['lot-2']);
  });

  it('cap: conserva solo los últimos 20 lotes agregados', () => {
    for (let i = 0; i < 25; i += 1) {
      addAwaitingLot({ id: `lot-${String(i)}`, sentAt: '2026-01-01T00:00:00.000Z' });
    }
    const ids = getAwaitingLots().map((l) => l.id);
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe('lot-5');
    expect(ids.at(-1)).toBe('lot-24');
  });
});

describe('clearPushLotState', () => {
  it('borra el lote en curso y la lista de espera', () => {
    setCurrentPushLot(buildPushLot(['e1'], { id: 'lot-1', now: '2026-01-01T00:00:00.000Z' }));
    addAwaitingLot({ id: 'lot-2', sentAt: '2026-01-01T00:00:00.000Z' });

    clearPushLotState();

    expect(getCurrentPushLot()).toBeUndefined();
    expect(getAwaitingLots()).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `pnpm vitest run src/sync/push-lot.test.ts`
Expected: FAIL — `push-lot.ts` no existe todavía.

- [ ] **Step 3: Implementación**

```typescript
// src/sync/push-lot.ts
import type { PushLot } from '../domain/push-lot.ts';

/**
 * Persistencia del lote de push en curso y de los lotes ya enviados que
 * todavía no confirmaron `ok`/`issues` (#87) — estado operativo interno del
 * motor, mismo criterio best-effort que `sync/cursor.ts`: si `localStorage`
 * falla (modo privado, cuota llena) o se pierde, el peor caso es reenviar un
 * lote con un id nuevo — el backend "se arregla como puede" (ver spec), no
 * es un error de negocio que valga la pena modelar con Result.
 */
const CURRENT_LOT_KEY = 'offline-pos:sync:push-lot';
const AWAITING_LOTS_KEY = 'offline-pos:sync:push-lot-awaiting';

/** Tope defensivo: si el backend nunca resuelve un lote, no crece sin límite. */
const MAX_AWAITING_LOTS = 20;

export function getCurrentPushLot(): PushLot | undefined {
  try {
    const raw = localStorage.getItem(CURRENT_LOT_KEY);
    return raw === null ? undefined : (JSON.parse(raw) as PushLot);
  } catch {
    return undefined;
  }
}

export function setCurrentPushLot(lot: PushLot): void {
  try {
    localStorage.setItem(CURRENT_LOT_KEY, JSON.stringify(lot));
  } catch {
    /* best-effort, ver comentario de arriba */
  }
}

export function clearCurrentPushLot(): void {
  try {
    localStorage.removeItem(CURRENT_LOT_KEY);
  } catch {
    /* best-effort */
  }
}

export type AwaitingLot = { id: string; sentAt: string };

export function getAwaitingLots(): AwaitingLot[] {
  try {
    const raw = localStorage.getItem(AWAITING_LOTS_KEY);
    return raw === null ? [] : (JSON.parse(raw) as AwaitingLot[]);
  } catch {
    return [];
  }
}

function setAwaitingLots(lots: AwaitingLot[]): void {
  try {
    localStorage.setItem(AWAITING_LOTS_KEY, JSON.stringify(lots.slice(-MAX_AWAITING_LOTS)));
  } catch {
    /* best-effort */
  }
}

/** Se llama justo después de que un lote recibe su ack de push. */
export function addAwaitingLot(lot: AwaitingLot): void {
  setAwaitingLots([...getAwaitingLots(), lot]);
}

/** Saca de la lista los lotes ya resueltos (`ok` o `issues`) — los `pending` (o no informados) se conservan. */
export function resolveAwaitingLots(resolvedIds: Set<string>): void {
  setAwaitingLots(getAwaitingLots().filter((lot) => !resolvedIds.has(lot.id)));
}

/** Usado por `/DEMO_RESET` y al cambiar de conexión (`sync/apply-connection.ts`) — mismo momento que `clearSyncCursors`. */
export function clearPushLotState(): void {
  clearCurrentPushLot();
  setAwaitingLots([]);
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `pnpm vitest run src/sync/push-lot.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sync/push-lot.ts src/sync/push-lot.test.ts
git commit -m "feat(sync): persistencia del lote de push en curso y lotes esperando resolución"
```

---

### Task 5: `sync/connector.ts` — el puerto `Connector` pasa a `pushBatch`/`pullBatch`

**Files:**
- Modify: `src/sync/connector.ts`
- Test: no tiene test propio hoy (es solo tipos + dos schemas Zod ya cubiertos indirectamente) — esta
  tarea no agrega tests nuevos, los tipos se ejercitan en las tareas siguientes.

**Interfaces:**
- Consumes: `OutboxEventPayload` de `domain/outbox.ts` (Task 2).
- Produces: `OutboxBatchItem = OutboxEventPayload & { id: string }`, `BatchLotStatus`,
  `PullBatchParams`, `PullBatchResult`, `Connector = { pushBatch, pullBatch, requestAccountHold }`.
  Se **eliminan** del puerto: `pullProducts`, `pullStock`, `pullCustomers`, `pushSale`,
  `pushStockMovement`, `pushSaleVoid`, `pushCustomer`, `pushAccountHoldConfirm`,
  `releaseAccountHold`, `pushCashSession`. Tasks 6, 7, 8, 14, 15, 16 consumen estos nombres tal cual.

Esta tarea es un cambio de tipos puro — no hay ciclo rojo/verde de test propio, pero **deja el
repo sin typecheck limpio a propósito** hasta que las Tasks 6-9 y 14-16 actualicen a todos los
consumidores del puerto viejo. Se verifica al final de cada tarea siguiente, no acá.

- [ ] **Step 1: Reemplazar el puerto**

Reemplazar el contenido de `src/sync/connector.ts` completo:

```typescript
// src/sync/connector.ts
import { z } from 'zod';
import type { OutboxEventPayload } from '../domain/outbox.ts';
import type { Product } from '../domain/product.ts';
import type { Result } from '../domain/result.ts';
import { productSchema } from '../domain/product.ts';
import { stockItemSchema, type StockItem } from '../domain/stock.ts';
import type { Customer } from '../domain/customer.ts';

export type ConnectorPullResult<T> = { items: T[]; nextCursor?: string };

/**
 * Forma cruda de un cliente dentro de `pullBatch` (§6): un solo recurso con
 * los campos de cuenta corriente opcionales — vive acá, no en
 * `domain/customer.ts`, porque es vocabulario de red (la respuesta plana del
 * backend), no la forma que usa el dominio (que separa `Customer` de
 * `CustomerAccount`, ver `domain/customer.ts::splitConnectorCustomer`).
 */
export const connectorCustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  document: z.string().optional(),
  phone: z.string().optional(),
  creditLimit: z.number().optional(),
  margin: z.number().optional(),
  balance: z.number().optional(),
  updatedAt: z.string().optional(),
  // Capacidad declarada por el backend/conector para ESE cliente puntual (Etapa 3, #69).
  unrestricted: z.boolean().optional(),
});

export type ConnectorCustomer = z.infer<typeof connectorCustomerSchema>;

/** Respuesta de la reserva síncrona de crédito — única operación que sigue siendo un round-trip propio (§5, #87). */
export const accountHoldResultSchema = z.discriminatedUnion('approved', [
  z.object({ approved: z.literal(true), holdId: z.string() }),
  z.object({ approved: z.literal(false), reasonCode: z.string() }),
]);

export type AccountHoldResult = z.infer<typeof accountHoldResultSchema>;

/**
 * Un evento del outbox tal como viaja dentro de un lote de push: los mismos
 * campos de negocio que `OutboxEventPayload` (`domain/outbox.ts`) más el
 * `id` que lo identifica dentro del lote — sin `status`/`createdAt`, que son
 * bookkeeping local que al backend no le importa.
 */
export type OutboxBatchItem = OutboxEventPayload & { id: string };

/**
 * Estado de un lote de push, tal como lo informa `pullBatch` (#87). `pending`
 * es un valor propio, no la ausencia de `ok`/`issues`: mientras un lote está
 * `pending` no se sabe todavía si va a tener problemas.
 */
export type BatchLotStatus =
  | { status: 'pending' }
  | { status: 'ok' }
  | { status: 'issues'; issues: string[] };

export type PullBatchParams = {
  /** Cursor por recurso — ausente pide la foto completa de ese recurso (todo o nada, sin paginar). */
  cursors: { products?: string; customers?: string };
  /** idempotency_id de lotes de push que el POS mandó y todavía no confirmó `ok`/`issues`. */
  pendingLotIds: string[];
};

export type PullBatchResult = {
  products: ConnectorPullResult<Product>;
  customers: ConnectorPullResult<ConnectorCustomer>;
  /** Sin cursor — mismo criterio que hoy, siempre completo, es liviano. */
  stock: StockItem[];
  /** Solo trae entradas para los ids de `pendingLotIds` que el backend todavía reconoce. */
  lots: Record<string, BatchLotStatus>;
};

/**
 * Puerto hacia el sistema externo (§6 del doc de diseño, rediseñado por
 * #87 — "el backend nunca rechaza, casi todo es diferible"). Vive en
 * `sync/`, no en `domain/`: habla en términos de red (cursores,
 * idempotency_id, resultados HTTP-shaped) que no son vocabulario de dominio
 * puro. `connectors/` (implementaciones) importa este puerto; `domain/` no
 * sabe que existe.
 *
 * Dos operaciones batch (reemplazan los 10 endpoints por-recurso de antes de
 * #87) más `requestAccountHold`, la única que sigue siendo síncrona: decide
 * el flujo del cobro en el momento (§5), nunca pasa por el outbox.
 */
export type Connector = {
  /** Manda TODA la cola pendiente del outbox de una vez, con un solo idempotency_id para el lote entero. */
  pushBatch(items: OutboxBatchItem[], idempotencyId: string): Promise<Result<void>>;
  /** Pide productos/clientes/stock en una sola llamada, más el estado de los lotes de push que interesan. */
  pullBatch(params: PullBatchParams): Promise<Result<PullBatchResult>>;
  requestAccountHold(
    params: { customerId: string; amount: number },
    idempotencyKey: string,
  ): Promise<Result<AccountHoldResult>>;
};

// Re-exportados para que los conectores no importen `zod`/`domain/product.ts`/`domain/stock.ts` solo por esto.
export { productSchema, stockItemSchema };
export type { Customer };
```

**Nota para quien ejecute**: los `export { productSchema, stockItemSchema }` /
`export type { Customer }` finales son un atajo de conveniencia — si al escribir la Task 14/15
resulta más simple que cada conector importe esos tipos directo de `domain/product.ts` /
`domain/stock.ts` / `domain/customer.ts` (como ya hacía `rest-fetch-connector.ts` antes de esta
tarea), quitar el re-export de acá y usar el import directo — no es una interfaz que otras tareas
dependan de que exista en este archivo.

- [ ] **Step 2: Commit (typecheck roto a propósito, documentado)**

```bash
git add src/sync/connector.ts
git commit -m "refactor(sync): puerto Connector — pushBatch/pullBatch en vez de 10 métodos por recurso

El repo no tipa limpio hasta la Task 9 (fake-connector.ts, engine.ts y los
conectores reales todavía implementan/consumen el puerto viejo) — esperado,
ver plan Etapa 1."
```

---

### Task 6: `src/test/fake-connector.ts` — actualizar al puerto nuevo

**Files:**
- Modify: `src/test/fake-connector.ts`

**Interfaces:**
- Consumes: `Connector`, `PullBatchResult`, `OutboxBatchItem` de Task 5.
- Produces: `fakeConnector(overrides?: Partial<Connector>): Connector` — mismo nombre y forma de
  uso que antes (`fakeConnector({ pushBatch: vi.fn()... })`), consumida por Task 7, 8, 9 y por
  cualquier otro test existente que la importe.

No es TDD en el sentido estricto (es un fixture de test, no código de producción) — se actualiza
directo y se verifica compilando, no con un test propio.

- [ ] **Step 1: Reemplazar el fixture**

```typescript
// src/test/fake-connector.ts
import { ok } from '../domain/result.ts';
import type { AccountHoldResult, Connector, PullBatchResult } from '../sync/connector.ts';

/** `Connector` de mentira para tests: todo responde OK y vacío; cada test pisa lo que le importa. */
export function fakeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    pushBatch: () => Promise.resolve(ok(undefined)),
    pullBatch: () =>
      Promise.resolve(
        ok<PullBatchResult>({
          products: { items: [] },
          customers: { items: [] },
          stock: [],
          lots: {},
        }),
      ),
    requestAccountHold: () =>
      Promise.resolve(ok<AccountHoldResult>({ approved: true, holdId: 'hold-1' })),
    ...overrides,
  };
}
```

- [ ] **Step 2: Buscar otros usos de la forma vieja del fixture**

Run: `grep -rn "pullProducts\|pullStock\|pullCustomers\|pushSale\b\|pushStockMovement\|pushSaleVoid\|pushCustomer\b\|pushAccountHoldConfirm\|releaseAccountHold\|pushCashSession" src/ --include=*.ts --include=*.tsx -l`

Cualquier archivo que no sea `sync/engine.ts`/`sync/engine.test.ts` (Task 7-9, todavía no
migradas) ni `connectors/rest/*`/`connectors/google-sheets/*` (Task 14-15) que aparezca acá es una
señal de un consumidor del puerto viejo no contemplado en este plan — pausar y revisar antes de
seguir.

- [ ] **Step 3: Commit**

```bash
git add src/test/fake-connector.ts
git commit -m "test(sync): fake-connector.ts al puerto pushBatch/pullBatch"
```

---

### Task 7: `sync/engine.ts` — ciclo de push por lote

**Files:**
- Modify: `src/sync/engine.ts` (solo la parte de push — el pull se toca recién en Task 8; hasta
  entonces `syncOnce`/`syncFull`/`pullCatalog`/`pullCustomers` quedan **temporalmente rotos** de
  compilación, es esperado)
- Modify: `src/sync/engine.test.ts` (reemplazar únicamente los `describe` de push — dejar los de
  pull con un `.skip` temporal, ver Step 1)

**Interfaces:**
- Consumes: `PushLot`, `buildPushLot`, `markLotFailed`, `isLotDue`, `isPushStruggling` de
  `domain/push-lot.ts` (Task 1); `OutboxEvent`, `markSynced` de `domain/outbox.ts` (Task 2);
  `getCurrentPushLot`, `setCurrentPushLot`, `clearCurrentPushLot`, `addAwaitingLot` de
  `sync/push-lot.ts` (Task 4); `Connector`, `OutboxBatchItem` de `sync/connector.ts` (Task 5);
  `newId` de `storage/ids.ts`.
- Produces: `PushSummary = { attempted: number; failed: boolean }`,
  `pushPendingLot(connector: Connector, now: string, options?: { ignoreBackoff?: boolean }): Promise<PushSummary>`.
  Task 9 (cadencias) y Task 10 (`apply-connection.ts`) consumen `pushPendingLot` tal cual
  (`apply-connection.ts::flushPendingBeforeWipe` reemplaza su `pushPendingEvents(...)` de hoy por
  `pushPendingLot(connector, now, { ignoreBackoff: true })`).

- [ ] **Step 1: Test — reemplazar los `describe` de push, dejar los de pull sin tocar (van a fallar de compilación; se resuelven en Task 8)**

En `src/sync/engine.test.ts`, reemplazar los imports y los bloques `describe('syncOnce — push', ...)`,
`describe('pushOne por tipo de evento', ...)` y `describe('pushPendingEvents', ...)` por lo
siguiente (el resto del archivo —pull, `runSyncCycle`, `startSyncEngine`, cerrojo— se termina de
adaptar en las Tasks 8 y 9; hasta entonces el archivo no compila completo, es esperado en esta
tarea intermedia):

```typescript
// (imports nuevos a agregar en la cabecera del archivo, junto a los existentes)
import { getAwaitingLots, getCurrentPushLot, setCurrentPushLot } from './push-lot.ts';
import { buildPushLot } from '../domain/push-lot.ts';
import { fakeConnector } from '../test/fake-connector.ts';
import { pushPendingLot } from './engine.ts'; // agregar a la lista ya importada de './engine.ts'

// (reemplaza describe('syncOnce — push', ...) completo)
describe('pushPendingLot', () => {
  it('sin eventos pendientes no llama a pushBatch', async () => {
    const pushBatch = vi.fn();
    const summary = await pushPendingLot(fakeConnector({ pushBatch }), now);
    expect(summary).toEqual({ attempted: 0, failed: false });
    expect(pushBatch).not.toHaveBeenCalled();
  });

  it('manda todos los eventos pendientes en un solo lote, en orden por createdAt', async () => {
    await db.outbox.bulkAdd([
      { type: 'sale', sale: { ...sale, id: 'second' }, id: 'second', status: 'pending', createdAt: '2026-01-01T00:00:02.000Z' },
      { type: 'sale', sale: { ...sale, id: 'first' }, id: 'first', status: 'pending', createdAt: '2026-01-01T00:00:01.000Z' },
    ]);
    const pushBatch = vi.fn().mockResolvedValue(ok(undefined));

    const summary = await pushPendingLot(fakeConnector({ pushBatch }), now);

    expect(summary).toEqual({ attempted: 2, failed: false });
    expect(pushBatch).toHaveBeenCalledTimes(1);
    const [items] = pushBatch.mock.calls[0] as [unknown[], string];
    expect(items.map((item) => (item as { id: string }).id)).toEqual(['first', 'second']);
  });

  it('marca todos los eventos del lote como synced tras un ack exitoso, y limpia el lote en curso', async () => {
    await db.outbox.add({ type: 'sale', sale, id: 'sale-1', status: 'pending', createdAt: now });

    await pushPendingLot(fakeConnector({ pushBatch: () => Promise.resolve(ok(undefined)) }), now);

    expect((await db.outbox.get('sale-1'))?.status).toBe('synced');
    expect(getCurrentPushLot()).toBeUndefined();
  });

  it('tras el ack, agrega el lote a la lista de espera de resolución', async () => {
    await db.outbox.add({ type: 'sale', sale, id: 'sale-1', status: 'pending', createdAt: now });

    await pushPendingLot(fakeConnector({ pushBatch: () => Promise.resolve(ok(undefined)) }), now);

    expect(getAwaitingLots()).toHaveLength(1);
  });

  it('un fallo de red deja los eventos pending y guarda el lote con backoff, sin agregarlo a la espera', async () => {
    await db.outbox.add({ type: 'sale', sale, id: 'sale-1', status: 'pending', createdAt: now });
    const pushBatch = vi.fn().mockResolvedValue(err('sync/request-failed', { message: 'boom' }));

    const summary = await pushPendingLot(fakeConnector({ pushBatch }), now);

    expect(summary).toEqual({ attempted: 1, failed: true });
    expect((await db.outbox.get('sale-1'))?.status).toBe('pending');
    expect(getCurrentPushLot()?.retries).toBe(1);
    expect(getAwaitingLots()).toEqual([]);
  });

  it('respeta el backoff del lote: no reintenta antes de tiempo salvo ignoreBackoff', async () => {
    await db.outbox.add({ type: 'sale', sale, id: 'sale-1', status: 'pending', createdAt: now });
    setCurrentPushLot(
      markLotFailedForTest(buildPushLot(['sale-1'], { id: 'lot-1', now }), { now, error: 'x' }),
    );
    const pushBatch = vi.fn().mockResolvedValue(ok(undefined));

    const withoutFlag = await pushPendingLot(fakeConnector({ pushBatch }), now);
    expect(withoutFlag).toEqual({ attempted: 0, failed: false });
    expect(pushBatch).not.toHaveBeenCalled();

    const withFlag = await pushPendingLot(fakeConnector({ pushBatch }), now, { ignoreBackoff: true });
    expect(withFlag).toEqual({ attempted: 1, failed: false });
  });

  it('un reintento del mismo lote reusa el mismo idempotencyId y el mismo conjunto de eventos, aunque haya eventos nuevos en el outbox', async () => {
    await db.outbox.add({ type: 'sale', sale, id: 'sale-1', status: 'pending', createdAt: now });
    const pushBatch = vi.fn().mockResolvedValueOnce(err('sync/request-failed', { message: 'boom' }));
    await pushPendingLot(fakeConnector({ pushBatch }), now, { ignoreBackoff: true });
    const lotIdAfterFailure = getCurrentPushLot()?.id;

    // Llega un evento nuevo mientras el lote sigue en vuelo (todavía no se reintentó).
    await db.outbox.add({ type: 'sale', sale: { ...sale, id: 'sale-2' }, id: 'sale-2', status: 'pending', createdAt: now });
    const pushBatchRetry = vi.fn().mockResolvedValue(ok(undefined));

    await pushPendingLot(fakeConnector({ pushBatch: pushBatchRetry }), now, { ignoreBackoff: true });

    const [items, idempotencyId] = pushBatchRetry.mock.calls[0] as [unknown[], string];
    expect(idempotencyId).toBe(lotIdAfterFailure); // mismo id congelado, no uno nuevo
    expect(items.map((item) => (item as { id: string }).id)).toEqual(['sale-1']); // sale-2 queda para el próximo lote
  });
});

// pushOne por tipo de evento: cubierto ahora por toBatchItem — un test por variante, directo.
describe('toBatchItem', () => {
  it.each([
    [
      { type: 'sale' as const, sale, id: 'sale-1', status: 'pending' as const, createdAt: now },
      { type: 'sale', sale, id: 'sale-1' },
    ],
    [
      {
        type: 'stock-movement' as const,
        movement: { id: 'm1', productId: 'p1', delta: -1, reason: 'sale' as const, saleId: 'sale-1', createdAt: now },
        id: 'm1',
        status: 'pending' as const,
        createdAt: now,
      },
      {
        type: 'stock-movement',
        movement: { id: 'm1', productId: 'p1', delta: -1, reason: 'sale', saleId: 'sale-1', createdAt: now },
        id: 'm1',
      },
    ],
    [
      { type: 'sale-void' as const, saleId: 'sale-1', voidedAt: now, voidReason: 'error', id: 'void-1', status: 'pending' as const, createdAt: now },
      { type: 'sale-void', saleId: 'sale-1', voidedAt: now, voidReason: 'error', id: 'void-1' },
    ],
    [
      { type: 'customer' as const, customer: { id: 'c1', name: 'Juan Pérez', createdAt: now }, id: 'c1', status: 'pending' as const, createdAt: now },
      { type: 'customer', customer: { id: 'c1', name: 'Juan Pérez', createdAt: now }, id: 'c1' },
    ],
    [
      { type: 'account-hold-confirm' as const, holdId: 'hold-1', saleId: 'sale-1', id: 'confirm-1', status: 'pending' as const, createdAt: now },
      { type: 'account-hold-confirm', holdId: 'hold-1', saleId: 'sale-1', id: 'confirm-1' },
    ],
    [
      { type: 'account-hold-release' as const, holdId: 'hold-1', id: 'release-1', status: 'pending' as const, createdAt: now },
      { type: 'account-hold-release', holdId: 'hold-1', id: 'release-1' },
    ],
    [
      { type: 'cash-session' as const, session: { id: 'cs1', openedAt: now, openingAmount: 500, sales: ['s1'] }, id: 'cs1', status: 'pending' as const, createdAt: now },
      { type: 'cash-session', session: { id: 'cs1', openedAt: now, openingAmount: 500, sales: ['s1'] }, id: 'cs1' },
    ],
  ])('convierte %o a %o, sin status ni createdAt', (event, expected) => {
    expect(toBatchItem(event)).toEqual(expected);
  });
});
```

Agregar, al principio del archivo de test (fuera de cualquier `describe`), el helper que usa el
test de backoff (envuelve `markLotFailed` para no importarlo dos veces con nombres distintos):

```typescript
import { markLotFailed as markLotFailedForTest } from '../domain/push-lot.ts';
```

Y agregar `toBatchItem` a los imports de `'./engine.ts'` (se exporta en el Step 3, solo para test —
ver nota al final del Step 3).

- [ ] **Step 2: Correr los tests nuevos y verificar que fallan**

Run: `pnpm vitest run src/sync/engine.test.ts -t "pushPendingLot|toBatchItem"`
Expected: FAIL — `pushPendingLot`/`toBatchItem` no existen en `engine.ts` todavía.

- [ ] **Step 3: Implementación — reemplazar `pushOne`/`PushSummary`/`pushPendingEvents`/`pushOnce` en `engine.ts`**

En `src/sync/engine.ts`, reemplazar el bloque que va desde `function pushOne(...)` hasta el final
de `pushOnce` (todo lo que hoy está entre esas dos funciones, `PushSummary` incluido) por:

```typescript
import { buildPushLot, isLotDue, markLotFailed, type PushLot } from '../domain/push-lot.ts';
import { markSynced, type OutboxEvent } from '../domain/outbox.ts';
import { newId } from '../storage/ids.ts';
import type { Connector, OutboxBatchItem } from './connector.ts';
import {
  addAwaitingLot,
  clearCurrentPushLot,
  getCurrentPushLot,
  setCurrentPushLot,
} from './push-lot.ts';

/** Convierte un evento del outbox a su forma de red — sin `status`/`createdAt`, bookkeeping local. */
export function toBatchItem(event: OutboxEvent): OutboxBatchItem {
  switch (event.type) {
    case 'sale':
      return { type: 'sale', id: event.id, sale: event.sale };
    case 'stock-movement':
      return { type: 'stock-movement', id: event.id, movement: event.movement };
    case 'sale-void':
      return {
        type: 'sale-void',
        id: event.id,
        saleId: event.saleId,
        voidedAt: event.voidedAt,
        ...(event.voidReason !== undefined ? { voidReason: event.voidReason } : {}),
      };
    case 'customer':
      return { type: 'customer', id: event.id, customer: event.customer };
    case 'account-hold-confirm':
      return { type: 'account-hold-confirm', id: event.id, holdId: event.holdId, saleId: event.saleId };
    case 'account-hold-release':
      return { type: 'account-hold-release', id: event.id, holdId: event.holdId };
    case 'cash-session':
      return { type: 'cash-session', id: event.id, session: event.session };
    default: {
      const exhaustiveCheck: never = event;
      throw new Error(`Tipo de evento de outbox desconocido: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/**
 * Retoma el lote en curso (mismo id, mismo conjunto de eventos — nunca se
 * recalcula en un reintento) o arma uno nuevo con todo lo pendiente del
 * outbox, en orden `createdAt`. `undefined` si no hay nada que enviar.
 */
async function buildOrResumeLot(now: string): Promise<{ lot: PushLot; events: OutboxEvent[] } | undefined> {
  const existing = getCurrentPushLot();
  if (existing !== undefined) {
    const events = (await db.outbox.bulkGet(existing.eventIds)).filter(
      (event): event is OutboxEvent => event !== undefined && event.status === 'pending',
    );
    if (events.length > 0) {
      return { lot: existing, events };
    }
    // Ya no queda nada pendiente de ese lote (p.ej. lo limpió /DEMO_RESET) — se descarta.
    clearCurrentPushLot();
  }

  const pending = await db.outbox.where('status').equals('pending').sortBy('createdAt');
  if (pending.length === 0) {
    return undefined;
  }
  const lot = buildPushLot(pending.map((event) => event.id), { id: newId(), now });
  setCurrentPushLot(lot);
  return { lot, events: pending };
}

export type PushSummary = { attempted: number; failed: boolean };

/**
 * Un ciclo de **push**: manda todo el outbox pendiente en un solo lote
 * (#87) — reemplaza el `pushOnce`/`pushPendingEvents` por-evento de antes.
 * `ignoreBackoff` saltea la ventana de reintento del lote: lo usa el envío
 * final antes de borrar los datos al cambiar de conexión
 * (`sync/apply-connection.ts::flushPendingBeforeWipe`) y `/SINCRONIZAR`.
 */
export async function pushPendingLot(
  connector: Connector,
  now: string,
  options: { ignoreBackoff?: boolean } = {},
): Promise<PushSummary> {
  const resumed = await buildOrResumeLot(now);
  if (resumed === undefined) {
    return { attempted: 0, failed: false };
  }
  const { lot, events } = resumed;
  if (options.ignoreBackoff !== true && !isLotDue(lot, now)) {
    return { attempted: 0, failed: false };
  }

  const result = await connector.pushBatch(events.map(toBatchItem), lot.id);
  if (result.ok) {
    await db.outbox.bulkPut(events.map(markSynced));
    clearCurrentPushLot();
    addAwaitingLot({ id: lot.id, sentAt: now });
    return { attempted: events.length, failed: false };
  }

  setCurrentPushLot(markLotFailed(lot, { now, error: result.error }));
  return { attempted: events.length, failed: true };
}
```

**Nota**: no hace falta que `pushOnce` sobreviva como nombre — sus llamadores (`ui/keyboard/*`,
`requestPushSoon`) se actualizan en la Task 9. Dejar temporalmente el resto del archivo (`pullCatalog`,
`pullCustomers`, `syncOnce`, `syncFull`, `runSyncCycle`, `requestPushSoon`, `scheduleNextRetry`,
`startSyncEngine`) tal cual está — van a tener errores de compilación (llaman a `pushPendingEvents`/
`pushOnce`/al puerto viejo de pull) hasta las Tasks 8 y 9. Es el estado esperado al final de esta
tarea.

- [ ] **Step 4: Correr los tests nuevos y verificar que pasan**

Run: `pnpm vitest run src/sync/engine.test.ts -t "pushPendingLot|toBatchItem"`
Expected: PASS (8 tests de `pushPendingLot` + 7 de `toBatchItem`).

- [ ] **Step 5: Commit (el archivo completo sigue sin tipar limpio — esperado, se resuelve en Task 8/9)**

```bash
git add src/sync/engine.ts src/sync/engine.test.ts
git commit -m "feat(sync): ciclo de push por lote (pushPendingLot) — reemplaza pushOnce/pushPendingEvents

sync/engine.ts todavía no tipa limpio: pullCatalog/pullCustomers/syncOnce/
syncFull/runSyncCycle siguen contra el puerto viejo, se migran en las
próximas dos tareas de este plan."
```

---

### Task 8: `sync/engine.ts` + `sync/pull-snapshot.ts` — ciclo de pull, gateado por estado de lotes

**Files:**
- Modify: `src/sync/pull-snapshot.ts`
- Modify: `src/sync/engine.ts`
- Modify: `src/sync/engine.test.ts`
- Modify: `src/ui/state/sync.ts` (agrega `pushLotIssuesSignal`)

**Interfaces:**
- Consumes: `PullBatchResult`, `Connector` de `sync/connector.ts` (Task 5); `getAwaitingLots`,
  `resolveAwaitingLots` de `sync/push-lot.ts` (Task 4); `isPushStruggling`, `getCurrentPushLot` de
  Tasks 1/4/7; `'sync/pending-lot'`/`'sync/push-issues'` de `domain/result.ts` (Task 3).
- Produces: `toProbeSnapshot(result: PullBatchResult): ProbeSnapshot` y `pullEverything(connector):
  Promise<Result<ProbeSnapshot>>` (mismo nombre y forma que hoy, en `pull-snapshot.ts` — Task 10 los
  consume sin cambios en `connection.ts`); `runPullCycle(connector: Connector, now: string, options?:
  { full?: boolean }): Promise<Result<void>>` en `engine.ts`, reemplaza `syncOnce`/`syncFull`.
  `pushLotIssuesSignal: Signal<string[] | null>` + `setPushLotIssues(issues: string[] | null): void`
  en `ui/state/sync.ts`. Task 9 (cadencias) consume `runPullCycle` tal cual.

- [ ] **Step 1: Agregar el signal de avisos de lote (`ui/state/sync.ts`)**

Agregar al final de `src/ui/state/sync.ts`:

```typescript
/**
 * Issues que el backend reportó sobre un lote de push ya resuelto (#87) —
 * puramente informativo: el POS nunca se autobloquea por esto, solo se lo
 * muestra al humano (ver spec, "el backend nunca rechaza"). `null` = nada
 * que avisar. Se limpia solo cuando un pull posterior no trae issues nuevos.
 */
export const pushLotIssuesSignal = signal<string[] | null>(null);

export function setPushLotIssues(issues: string[] | null): void {
  pushLotIssuesSignal.value = issues;
}
```

- [ ] **Step 2: Test — reemplazar los `describe` de pull en `engine.test.ts`**

Reemplazar `describe('syncOnce — pull', ...)` y `describe('syncOnce — pull de clientes', ...)` por
lo siguiente (agregar `runPullCycle`, `resolveAwaitingLots`, `addAwaitingLot` a los imports de
`'./engine.ts'`/`'./push-lot.ts'` en la cabecera):

```typescript
describe('runPullCycle — delta', () => {
  const product: Product = {
    id: 'p1', sku: 'SKU-1', barcodes: [], name: 'Arroz 1kg', price: 100, taxRate: 0.21,
    category: 'almacen', tracksStock: true,
  };

  it('guarda los productos nuevos y avanza el cursor', async () => {
    const pullBatch = vi.fn().mockResolvedValue(
      ok({ products: { items: [product], nextCursor: 'cursor-2' }, customers: { items: [] }, stock: [], lots: {} }),
    );

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect((await db.products.get('p1'))?.name).toBe('Arroz 1kg');
    expect(getProductsCursor()).toBe('cursor-2');
  });

  it('manda el cursor guardado como parte de cursors en el próximo ciclo', async () => {
    const pullBatch = vi.fn().mockResolvedValue(
      ok({ products: { items: [product], nextCursor: 'cursor-2' }, customers: { items: [] }, stock: [], lots: {} }),
    );
    await runPullCycle(fakeConnector({ pullBatch }), now);

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(pullBatch).toHaveBeenLastCalledWith({ cursors: { products: 'cursor-2' }, pendingLotIds: [] });
  });

  it('actualiza el stock recibido', async () => {
    const stockItem: StockItem = { productId: 'p1', quantity: 7, updatedAt: now };
    const pullBatch = vi.fn().mockResolvedValue(
      ok({ products: { items: [] }, customers: { items: [] }, stock: [stockItem], lots: {} }),
    );

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect((await db.stock.get('p1'))?.quantity).toBe(7);
  });

  it('si el pull falla: pasa a sync-error, guarda el motivo y no marca la sync como exitosa', async () => {
    lastSyncedAtSignal.value = null;
    const failure = err('sync/request-failed', { status: 401, message: 'x' });
    const pullBatch = vi.fn().mockResolvedValue(failure);

    const report = await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(report.ok).toBe(false);
    expect(syncStatusSignal.value).toBe('sync-error');
    expect(lastSyncFailureSignal.value).toEqual(failure);
    expect(lastSyncedAtSignal.value).toBeNull();
  });

  it('guarda customer y customerAccount, y avanza el cursor de clientes', async () => {
    const rawCustomer = { id: 'c1', name: 'Juan Pérez', creditLimit: 1000, margin: 0, balance: 100 };
    const pullBatch = vi.fn().mockResolvedValue(
      ok({ products: { items: [] }, customers: { items: [rawCustomer], nextCursor: 'cur-c' }, stock: [], lots: {} }),
    );

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect((await db.customers.get('c1'))?.name).toBe('Juan Pérez');
    expect((await db.customerAccounts.get('c1'))?.balance).toBe(100);
    expect(getCustomersCursor()).toBe('cur-c');
  });

  it('un cliente sin datos de cuenta no crea fila en customerAccounts', async () => {
    const pullBatch = vi.fn().mockResolvedValue(
      ok({ products: { items: [] }, customers: { items: [{ id: 'c2', name: 'Sin cuenta' }] }, stock: [], lots: {} }),
    );

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(await db.customerAccounts.get('c2')).toBeUndefined();
  });

  it('tras un ciclo exitoso limpia el motivo del fallo y guarda lo que hay en la base local', async () => {
    await db.products.put({
      id: 'p1', sku: 'S1', barcodes: [], name: 'Arroz', price: 100, taxRate: 0.21, category: 'x', tracksStock: false,
    });
    await runPullCycle(
      fakeConnector({ pullBatch: () => Promise.resolve(err('sync/request-failed', { message: 'down' })) }),
      now,
    );
    expect(lastSyncFailureSignal.value).not.toBeNull();

    const report = await runPullCycle(fakeConnector(), now);

    expect(report.ok).toBe(true);
    expect(lastSyncFailureSignal.value).toBeNull();
    expect(localCatalogCountsSignal.value).toEqual({ products: 1, customers: 0 });
    expect(lastSyncedAtSignal.value).toBe(now);
  });
});

describe('runPullCycle — gateado por lotes de push pendientes', () => {
  it('si un lote que nos interesa sigue pending, no aplica el pull y no toca el catálogo local', async () => {
    addAwaitingLot({ id: 'lot-1', sentAt: now });
    await db.products.put({
      id: 'p1', sku: 'S1', barcodes: [], name: 'Viejo', price: 1, taxRate: 0, category: 'x', tracksStock: false,
    });
    const pullBatch = vi.fn().mockResolvedValue(
      ok({
        products: { items: [{ id: 'p1', sku: 'S1', barcodes: [], name: 'Nuevo', price: 999, taxRate: 0, category: 'x', tracksStock: false }] },
        customers: { items: [] },
        stock: [],
        lots: { 'lot-1': { status: 'pending' } },
      }),
    );

    const report = await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(report).toEqual({ ok: false, error: 'sync/pending-lot', meta: undefined });
    expect((await db.products.get('p1'))?.name).toBe('Viejo'); // no se aplicó nada
    expect(getAwaitingLots()).toEqual([{ id: 'lot-1', sentAt: now }]); // sigue esperando
  });

  it('si el backend no informa nada sobre un lote que esperamos, se trata como todavía pending', async () => {
    addAwaitingLot({ id: 'lot-1', sentAt: now });
    const pullBatch = vi.fn().mockResolvedValue(
      ok({ products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }),
    );

    const report = await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(report.ok).toBe(false);
    expect(getAwaitingLots()).toEqual([{ id: 'lot-1', sentAt: now }]);
  });

  it('un lote resuelto ok se saca de la lista de espera y el pull se aplica normalmente', async () => {
    addAwaitingLot({ id: 'lot-1', sentAt: now });
    const pullBatch = vi.fn().mockResolvedValue(
      ok({ products: { items: [] }, customers: { items: [] }, stock: [], lots: { 'lot-1': { status: 'ok' } } }),
    );

    const report = await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(report.ok).toBe(true);
    expect(getAwaitingLots()).toEqual([]);
  });

  it('un lote resuelto con issues se saca de la espera, el pull igual se aplica, y se avisa vía pushLotIssuesSignal', async () => {
    addAwaitingLot({ id: 'lot-1', sentAt: now });
    const pullBatch = vi.fn().mockResolvedValue(
      ok({
        products: { items: [] },
        customers: { items: [] },
        stock: [],
        lots: { 'lot-1': { status: 'issues', issues: ['stock insuficiente en p1'] } },
      }),
    );

    const report = await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(report.ok).toBe(true);
    expect(getAwaitingLots()).toEqual([]);
    expect(pushLotIssuesSignal.value).toEqual(['stock insuficiente en p1']);
  });

  it('sin lotes en espera, pullBatch se llama con pendingLotIds vacío y el pull se aplica directo', async () => {
    const pullBatch = vi.fn().mockResolvedValue(
      ok({ products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }),
    );

    await runPullCycle(fakeConnector({ pullBatch }), now);

    expect(pullBatch).toHaveBeenCalledWith({ cursors: {}, pendingLotIds: [] });
  });
});

describe('runPullCycle — foto completa y reconciliación de bajas', () => {
  function catalogProduct(id: string): Product {
    return { id, sku: `SKU-${id}`, barcodes: [], name: `Producto ${id}`, price: 100, taxRate: 0.21, category: 'x', tracksStock: false };
  }

  it('con full:true no manda cursores y reconcilia bajas', async () => {
    await db.products.bulkPut([catalogProduct('p1'), catalogProduct('p2')]);
    const pullBatch = vi.fn().mockResolvedValue(
      ok({ products: { items: [catalogProduct('p1')], nextCursor: 'cur-p' }, customers: { items: [], nextCursor: 'cur-c' }, stock: [], lots: {} }),
    );

    await runPullCycle(fakeConnector({ pullBatch }), now, { full: true });

    expect(pullBatch).toHaveBeenCalledWith({ cursors: {}, pendingLotIds: [] });
    expect(await db.products.toCollection().primaryKeys()).toEqual(['p1']);
    expect(getProductsCursor()).toBe('cur-p');
    expect(getCustomersCursor()).toBe('cur-c');
  });

  it('si una parte llega vacía habiendo datos locales, no se borra nada y avisa sync/empty-snapshot', async () => {
    await db.products.bulkPut([catalogProduct('p1')]);
    const pullBatch = vi.fn().mockResolvedValue(
      ok({ products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }),
    );

    const report = await runPullCycle(fakeConnector({ pullBatch }), now, { full: true });

    expect(report).toMatchObject({ ok: false, error: 'sync/empty-snapshot' });
    expect(await db.products.toCollection().primaryKeys()).toEqual(['p1']);
  });
});
```

- [ ] **Step 3: Correr los tests nuevos y verificar que fallan**

Run: `pnpm vitest run src/sync/engine.test.ts -t "runPullCycle"`
Expected: FAIL — `runPullCycle` no existe todavía.

- [ ] **Step 4: `sync/pull-snapshot.ts` — normalizar `PullBatchResult` a `ProbeSnapshot`**

Reemplazar el contenido de `src/sync/pull-snapshot.ts` completo:

```typescript
// src/sync/pull-snapshot.ts
import type { Product } from '../domain/product.ts';
import { err, ok, type Result } from '../domain/result.ts';
import type { StockItem } from '../domain/stock.ts';
import type { Connector, ConnectorCustomer, PullBatchResult } from './connector.ts';

/** Lo que trae un pull completo (la prueba de conexión y el refresco periódico): todo en memoria, nada tocó IndexedDB todavía. */
export type ProbeSnapshot = {
  products: Product[];
  stock: StockItem[];
  customers: ConnectorCustomer[];
  cursors: { products?: string; customers?: string };
};

/**
 * Carrera contra un tiempo máximo, sin cambiar el puerto `Connector`: si
 * vence, devuelve `sync/timeout` y el trabajo en vuelo se ignora (no se
 * cancela el `fetch`, solo se descarta su resultado).
 */
export function withTimeout<T>(promise: Promise<Result<T>>, ms: number): Promise<Result<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(err('sync/timeout', { seconds: Math.max(1, Math.round(ms / 1000)) }));
    }, ms);
    void promise.then((result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

/** Normaliza la respuesta de `pullBatch` (#87) a la forma que `storage/reconcile.ts` espera. */
export function toProbeSnapshot(result: PullBatchResult): ProbeSnapshot {
  return {
    products: result.products.items,
    stock: result.stock,
    customers: result.customers.items,
    cursors: {
      ...(result.products.nextCursor !== undefined ? { products: result.products.nextCursor } : {}),
      ...(result.customers.nextCursor !== undefined ? { customers: result.customers.nextCursor } : {}),
    },
  };
}

/**
 * Pull completo para la prueba de conexión (`sync/connection.ts::probeConnection`): sin cursores,
 * sin lotes de interés — un candidato nuevo nunca tiene lotes de push en vuelo contra él.
 */
export async function pullEverything(connector: Connector): Promise<Result<ProbeSnapshot>> {
  const result = await connector.pullBatch({ cursors: {}, pendingLotIds: [] });
  if (!result.ok) {
    return result;
  }
  return ok(toProbeSnapshot(result.value));
}
```

- [ ] **Step 5: `sync/engine.ts` — reemplazar `pullCatalog`/`pullCustomers`/`syncOnce`/`syncFull`/`finishCycle` por `runPullCycle`**

Reemplazar ese bloque completo (desde `async function pullCatalog` hasta el final de `syncFull`,
`SyncReport` y `finishCycle` incluidos) por:

```typescript
import { reconcileSnapshot } from '../storage/reconcile.ts';
import { isPushStruggling } from '../domain/push-lot.ts';
import { toProbeSnapshot } from './pull-snapshot.ts';
import { getAwaitingLots, resolveAwaitingLots } from './push-lot.ts';
import { setPushLotIssues } from '../ui/state/sync.ts'; // sumar a la lista ya importada de ese módulo

type PullOutcome = { applied: boolean; failure?: Failure; issues: string[] };

/**
 * Un ciclo de **pull**: un solo `pullBatch` (delta si `full` no está, foto
 * completa si sí), gateado por el estado de los lotes de push que el POS
 * todavía espera confirmar (#87) — si alguno sigue `pending`, no se aplica
 * nada de este pull (ver spec, "Regla de aplicación"). Reemplaza
 * `pullCatalog`/`pullCustomers`/`syncOnce`/`syncFull` de antes de #87.
 */
async function pullAndApply(
  connector: Connector,
  now: string,
  options: { full: boolean },
): Promise<PullOutcome> {
  const awaiting = getAwaitingLots();
  const cursors = options.full
    ? {}
    : {
        ...(getProductsCursor() !== undefined ? { products: getProductsCursor() } : {}),
        ...(getCustomersCursor() !== undefined ? { customers: getCustomersCursor() } : {}),
      };

  const pullResult = await connector.pullBatch({ cursors, pendingLotIds: awaiting.map((lot) => lot.id) });
  if (!pullResult.ok) {
    return { applied: false, failure: pullResult, issues: [] };
  }

  const resolved = new Set<string>();
  const issues: string[] = [];
  let stillPending = false;
  for (const lot of awaiting) {
    const status = pullResult.value.lots[lot.id];
    if (status === undefined || status.status === 'pending') {
      stillPending = true;
      continue;
    }
    resolved.add(lot.id);
    if (status.status === 'issues') {
      issues.push(...status.issues);
    }
  }
  resolveAwaitingLots(resolved);

  if (stillPending) {
    return { applied: false, failure: err('sync/pending-lot', undefined) as Failure, issues };
  }

  if (options.full) {
    const snapshot = toProbeSnapshot(pullResult.value);
    const applied = await reconcileSnapshot(snapshot, { now });
    if (!applied.ok) {
      return { applied: false, failure: applied, issues };
    }
    if (applied.value.skipped.length > 0) {
      return {
        applied: false,
        failure: err('sync/empty-snapshot', { tables: applied.value.skipped }) as Failure,
        issues,
      };
    }
    if (snapshot.cursors.products !== undefined) setProductsCursor(snapshot.cursors.products);
    if (snapshot.cursors.customers !== undefined) setCustomersCursor(snapshot.cursors.customers);
    setCatalogRepository(await loadCatalogRepository());
    setCustomerRepository(await loadCustomerRepository());
    setLastFullSyncAt(now);
    fullRefreshDoneThisSession = true;
    return { applied: true, issues };
  }

  if (pullResult.value.products.items.length > 0) {
    await db.products.bulkPut(pullResult.value.products.items);
    setCatalogRepository(await loadCatalogRepository());
  }
  if (pullResult.value.products.nextCursor !== undefined) {
    setProductsCursor(pullResult.value.products.nextCursor);
  }
  if (pullResult.value.stock.length > 0) {
    await db.stock.bulkPut(pullResult.value.stock);
  }
  if (pullResult.value.customers.items.length > 0) {
    const { customers, accounts } = splitConnectorCustomers(pullResult.value.customers.items, { now });
    await db.customers.bulkPut(customers);
    if (accounts.length > 0) {
      await db.customerAccounts.bulkPut(accounts);
    }
    setCustomerRepository(await loadCustomerRepository());
  }
  if (pullResult.value.customers.nextCursor !== undefined) {
    setCustomersCursor(pullResult.value.customers.nextCursor);
  }
  return { applied: true, issues };
}

/** Cola común de un ciclo de pull: conteos, aviso de issues y estado honesto (#53, adaptado a #87). */
async function finishPullCycle(now: string, outcome: PullOutcome): Promise<Result<void>> {
  setPendingOutboxCount(await db.outbox.where('status').equals('pending').count());
  setLocalCatalogCounts(await countLocalCatalog());
  setPushLotIssues(outcome.issues.length > 0 ? outcome.issues : null);

  if (outcome.failure !== undefined) {
    setLastSyncFailure(outcome.failure);
    setSyncStatus('sync-error');
    return outcome.failure;
  }
  setLastSyncFailure(null);

  if (isPushStruggling(getCurrentPushLot())) {
    setSyncStatus('sync-error');
    return ok(undefined);
  }
  setSyncStatus('online-idle');
  setLastSyncedAt(now);
  return ok(undefined);
}

export async function runPullCycle(
  connector: Connector,
  now: string,
  options: { full?: boolean } = {},
): Promise<Result<void>> {
  setSyncStatus('syncing');
  const outcome = await pullAndApply(connector, now, { full: options.full === true });
  return finishPullCycle(now, outcome);
}
```

Sacar de los imports de `engine.ts` lo que quedó sin uso (`isSyncStruggling`/`markFailed`/`isDue`
de `domain/outbox.ts` ya no existen — deberían haberse sacado en la Task 7 al tocar los imports; si
sigue alguno, sacarlo ahora) y agregar los nuevos (`reconcileSnapshot`, `isPushStruggling`,
`toProbeSnapshot`, `getAwaitingLots`, `resolveAwaitingLots`, `setPushLotIssues`, `Failure` si no
estaba ya importado de `../domain/result.ts`).

- [ ] **Step 6: Correr los tests nuevos y verificar que pasan**

Run: `pnpm vitest run src/sync/engine.test.ts -t "runPullCycle"`
Expected: PASS (18 tests).

- [ ] **Step 7: Commit (el archivo sigue sin tipar limpio del todo — `runSyncCycle`/`startSyncEngine` se migran en la Task 9)**

```bash
git add src/sync/pull-snapshot.ts src/sync/engine.ts src/sync/engine.test.ts src/ui/state/sync.ts
git commit -m "feat(sync): ciclo de pull por lote, gateado por estado de lotes de push pendientes (#87)"
```

---

### Task 9: `sync/engine.ts` — cadencias independientes, `/SINCRONIZAR`, foto completa cada 2 h

**Files:**
- Modify: `src/sync/full-refresh.ts` (solo la constante)
- Modify: `src/sync/full-refresh.test.ts` (solo los números)
- Modify: `src/sync/engine.ts` (el resto del archivo: `runSyncCycle`/`startSyncEngine`/
  `requestPushSoon`/`scheduleNextRetry`/`tryAcquireSyncLock`/`acquireSyncLockWaiting`)
- Modify: `src/sync/engine.test.ts` (últimos `describe` que faltan)
- Modify: `src/ui/keyboard/command-bar-controller.ts` (`/SINCRONIZAR`)
- Modify: `src/ui/keyboard/command-bar-controller.test.ts`
- Modify: `src/ui/keyboard/config-controller.ts` (línea que cierra `/CONFIG` tras aplicar)
- Modify: `src/ui/keyboard/config-controller.test.ts`
- Modify: `src/ui/screens/config-screen.test.tsx`

**Interfaces:**
- Consumes: `runPushCycle`... (se define acá mismo), `runPullCycle` de Task 8, `pushPendingLot` de
  Task 7, `isFullRefreshDue`/`connectorPullMode` existentes.
- Produces: `runPushCycle(options?: { ignoreBackoff?: boolean }): Promise<void>`,
  `runPullCycleNow(options?: { full?: boolean }): Promise<void>`, `syncNow(): Promise<void>`
  (reemplaza `runSyncCycle` — Task 10 y los archivos de `ui/` de esta tarea son los únicos
  consumidores fuera de `engine.ts`), `requestPushSoon`, `cancelScheduledPush`, `cancelScheduledPull`,
  `startSyncEngine`, `tryAcquireSyncLock`, `acquireSyncLockWaiting` (estas tres últimas, sin cambios
  de firma respecto de hoy). **Se elimina** `runSyncCycle`.

- [ ] **Step 1: `sync/full-refresh.ts` — intervalo a 2 horas**

En `src/sync/full-refresh.ts`, cambiar:

```typescript
export const FULL_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;
```

En `src/sync/full-refresh.test.ts`, actualizar los números de la última tanda de asserts (los
demás casos no dependen del valor exacto del intervalo):

```typescript
  it('el intervalo es de 2 horas', () => {
    expect(FULL_REFRESH_INTERVAL_MS).toBe(2 * 60 * 60 * 1000);
  });
  // ...
  it('delta: pasaron 2 horas o más toca; menos, no', () => {
    expect(isFullRefreshDue({ ...base, lastFullAt: minutesAgo(119) })).toBe(false);
    expect(isFullRefreshDue({ ...base, lastFullAt: minutesAgo(120) })).toBe(true);
    expect(isFullRefreshDue({ ...base, lastFullAt: minutesAgo(240) })).toBe(true);
  });
```

Run: `pnpm vitest run src/sync/full-refresh.test.ts` → Expected: PASS.

- [ ] **Step 2: Test — reemplazar `describe('runSyncCycle', ...)`, `describe('requestPushSoon y reintentos agendados', ...)` y `describe('startSyncEngine', ...)` en `engine.test.ts`**

Agregar a los imports de `'./engine.ts'`: `runPushCycle`, `runPullCycleNow`, `syncNow`,
`cancelScheduledPull`. Sacar `pushOnce`/`syncOnce`/`syncFull` si seguían importados (ya no existen).

```typescript
describe('runPushCycle', () => {
  it('sin red, marca offline y no llama a fetch', async () => {
    setOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runPushCycle();

    expect(syncStatusSignal.value).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con la sincronización pausada no corre ni llama a fetch', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setSyncPaused(true);

    try {
      await runPushCycle();
    } finally {
      setSyncPaused(false);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin config guardada, marca syncConfigured en false', async () => {
    await runPushCycle();
    expect(syncConfiguredSignal.value).toBe(false);
  });

  it('con config sin verifiedAt (sin probar) no corre ni llama a fetch', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runPushCycle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncConfiguredSignal.value).toBe(false);
  });

  it('con eventos pendientes, manda un solo POST batch', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    await db.outbox.add(pendingSaleEvent());
    const calls = stubRestFetch();

    await runPushCycle();

    expect(calls).toEqual(['POST /sync/push']);
  });

  it('no arranca un segundo push si el anterior sigue en curso', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    await db.outbox.add(pendingSaleEvent());
    let callCount = 0;
    let resolveFirst: (response: Response) => void = () => {
      throw new Error('no asignado');
    };
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<Response>((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({}) } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = runPushCycle();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await runPushCycle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirst({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({}) } as Response);
    await first;
  });
});

describe('runPullCycleNow', () => {
  it('con config guardada, arma el conector real y corre un pull', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({
        ok: true, status: 200, statusText: 'OK',
        json: () => Promise.resolve({ products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }),
      } as Response),
    ));

    await runPullCycleNow();

    expect(syncConfiguredSignal.value).toBe(true);
    expect(syncStatusSignal.value).toBe('online-idle');
  });

  it('la primera vez de la sesión es una foto completa: sin cursores en el body', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse((init?.body as string) ?? '{}'));
      return Promise.resolve({
        ok: true, status: 200, statusText: 'OK',
        json: () => Promise.resolve({ products: { items: [], nextCursor: 'cur-p' }, customers: { items: [], nextCursor: 'cur-c' }, stock: [], lots: {} }),
      } as Response);
    }));

    await runPullCycleNow();

    expect(bodies).toEqual([{ cursors: {}, pendingLotIds: [] }]);
  });

  it('si un delta resuelve un lote con issues, encadena una foto completa ya (cadencia de #87)', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    resetFullRefreshSession();
    // Fuerza que el primer pull de la sesión ya sea delta: se marca lastFullSyncAt reciente a mano.
    await runPullCycleNow({ full: true });
    addAwaitingLot({ id: 'lot-1', sentAt: now });
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as { cursors: Record<string, string> };
      bodies.push(body);
      const hasCursor = Object.keys(body.cursors).length > 0;
      return Promise.resolve({
        ok: true, status: 200, statusText: 'OK',
        json: () => Promise.resolve({
          products: { items: [] }, customers: { items: [] }, stock: [],
          lots: hasCursor ? { 'lot-1': { status: 'issues', issues: ['stock insuficiente'] } } : {},
        }),
      } as Response);
    }));

    await runPullCycleNow();

    expect(bodies).toHaveLength(2);
    expect(Object.keys((bodies[0] as { cursors: Record<string, string> }).cursors).length).toBeGreaterThan(0); // delta
    expect((bodies[1] as { cursors: Record<string, string> }).cursors).toEqual({}); // foto completa encadenada
  });
});

describe('syncNow (/SINCRONIZAR)', () => {
  it('fuerza el push del lote pendiente (ignorando backoff) y después un pull completo', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
    await db.outbox.add(pendingSaleEvent());
    const calls = stubRestFetch();

    await syncNow();

    expect(calls).toEqual(['POST /sync/push', 'POST /sync/pull']);
  });
});
```

Reemplazar `describe('requestPushSoon y reintentos agendados', ...)`: todos los `runSyncCycle({ pull: false })` pasan a `runPushCycle()`, y el resto de las aserciones no cambian de forma (agrupa a 2s, adelanta al más cercano, reintenta al vencer el backoff del **lote**). Reemplazar `describe('startSyncEngine', ...)`:

```typescript
describe('startSyncEngine', () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: now });
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    cancelScheduledPush();
    cancelScheduledPull();
    vi.useRealTimers();
  });

  it('al arrancar corre un push y un pull', async () => {
    const calls = stubRestFetch();
    stop = startSyncEngine();
    await settled();

    expect(calls).toContain('POST /sync/push');
    expect(calls).toContain('POST /sync/pull');
  });

  it('un evento nuevo en el outbox dispara un push a los ~2s, y agenda un pull ~2min después', async () => {
    const calls = stubRestFetch();
    stop = startSyncEngine();
    await settled();
    calls.length = 0;

    await db.outbox.add(pendingSaleEvent());
    await vi.advanceTimersByTimeAsync(2_100);
    await settled();
    expect(calls).toEqual(['POST /sync/push']);

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);
    await settled();
    expect(calls).toEqual(['POST /sync/push', 'POST /sync/pull']);
  });

  it('sin actividad, el push corre cada PUSH_INTERVAL_MS y el pull cada PULL_SAFETY_NET_INTERVAL_MS', async () => {
    const calls = stubRestFetch();
    stop = startSyncEngine();
    await settled();
    calls.length = 0;

    await vi.advanceTimersByTimeAsync(PUSH_INTERVAL_MS + 100);
    await settled();
    expect(calls).toContain('POST /sync/push');

    calls.length = 0;
    await vi.advanceTimersByTimeAsync(PULL_SAFETY_NET_INTERVAL_MS + 100);
    await settled();
    expect(calls).toContain('POST /sync/pull');
  });

  it('la función devuelta detiene los dos intervalos y los disparos agendados', async () => {
    const calls = stubRestFetch();
    stop = startSyncEngine();
    await settled();
    calls.length = 0;

    stop();
    stop = undefined;
    await db.outbox.add(pendingSaleEvent());
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);

    expect(calls).toEqual([]);
  });
});
```

Actualizar `stubRestFetch`/`stubBackend` (helpers al pie del archivo) para que registren
`POST /sync/push`/`POST /sync/pull` en vez de las rutas viejas — devolver bodies fieles a
`PullBatchResult`/ack de `pushBatch` (`{}` para push exitoso, `{ products: { items: [] },
customers: { items: [] }, stock: [], lots: {} }` para pull). Agregar `PUSH_INTERVAL_MS`,
`PULL_SAFETY_NET_INTERVAL_MS` a los imports de `'./engine.ts'`.

- [ ] **Step 3: Correr los tests nuevos y verificar que fallan**

Run: `pnpm vitest run src/sync/engine.test.ts`
Expected: FAIL — `runPushCycle`/`runPullCycleNow`/`syncNow`/`cancelScheduledPull` no existen todavía.

- [ ] **Step 4: Implementación — reemplazar el resto de `engine.ts`**

Reemplazar desde `let syncInProgress = false;` (el cerrojo se mantiene igual, sin cambios — Task 5
decisión 3) hasta el final del archivo por:

```typescript
let syncInProgress = false;

export function tryAcquireSyncLock(): (() => void) | undefined {
  if (syncInProgress) {
    return undefined;
  }
  syncInProgress = true;
  return () => {
    syncInProgress = false;
  };
}

export async function acquireSyncLockWaiting(waitMs: number): Promise<(() => void) | undefined> {
  const deadline = Date.now() + waitMs;
  let release = tryAcquireSyncLock();
  while (release === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    release = tryAcquireSyncLock();
  }
  return release;
}

/**
 * Preámbulo común a cualquier ciclo (push o pull, #87): toma el cerrojo
 * **solo mientras dura este request** (nunca durante todo el intervalo entre
 * ciclos — decisión de la Etapa 1), respeta `/CONFIG` abierto, chequea red y
 * config activa. `run` recibe el conector ya armado, la hora y la config —
 * así ni `pushPendingLot` ni `runPullCycle` necesitan saber de dónde salió.
 */
async function withConnectorCycle(
  run: (connector: Connector, now: string, config: SyncConfig) => Promise<void>,
): Promise<void> {
  if (syncPausedSignal.value) {
    return;
  }
  const release = tryAcquireSyncLock();
  if (release === undefined) {
    return;
  }
  try {
    if (!navigator.onLine) {
      setSyncStatus('offline');
      return;
    }
    const configResult = loadSyncConfig();
    if (!configResult.ok || configResult.value.verifiedAt === undefined) {
      setSyncConfigured(false);
      return;
    }
    setSyncConfigured(true);
    const connector = createConnector(configResult.value);
    await run(connector, new Date().toISOString(), configResult.value);
  } finally {
    release();
  }
}

/** Ciclo de **push**: reemplaza el `pull:false` de `runSyncCycle` de antes de #87. */
export async function runPushCycle(options: { ignoreBackoff?: boolean } = {}): Promise<void> {
  await withConnectorCycle(async (connector, now) => {
    const summary = await pushPendingLot(connector, now, options);
    setPendingOutboxCount(await db.outbox.where('status').equals('pending').count());
    setSyncStatus(
      lastSyncFailureSignal.value !== null || isPushStruggling(getCurrentPushLot())
        ? 'sync-error'
        : 'online-idle',
    );
    if (summary.attempted > 0 && !summary.failed) {
      schedulePullSoon(PULL_DELAY_AFTER_PUSH_MS);
    }
    await scheduleNextPushRetry();
  });
}

/**
 * Ciclo de **pull**: decide foto completa vs. delta y corre `runPullCycle` (Task 8). Si un delta
 * resuelve un lote con `issues`, encadena una foto completa ya mismo, sin esperar a la cadencia de
 * 2h — mismo criterio de la tabla de cadencias del spec ("pull completo ... o si un pull delta
 * avisa issues graves en algún lote"): acá se trata cualquier `issues` como grave, ya que
 * `BatchLotStatus` no distingue severidad — más conservador, nunca se autobloquea, solo adelanta la
 * reconciliación completa. Corre dentro de la misma toma de cerrojo (`withConnectorCycle`), sin un
 * segundo `pullAndApply` gateado por lotes: la foto completa ya resolvió lo que había pendiente en
 * el primer intento (`resolveAwaitingLots` ya sacó ese lote de la lista).
 */
export async function runPullCycleNow(options: { full?: boolean } = {}): Promise<void> {
  await withConnectorCycle(async (connector, now, config) => {
    const full =
      options.full === true ||
      isFullRefreshDue({
        mode: connectorPullMode(config.type),
        lastFullAt: getLastFullSyncAt(),
        now,
        doneThisSession: fullRefreshDoneThisSession,
      });
    await runPullCycle(connector, now, { full });
    if (!full && pushLotIssuesSignal.value !== null) {
      await runPullCycle(connector, now, { full: true });
    }
  });
}

/** `/SINCRONIZAR` (RF-12, bajo demanda): fuerza el push ya (ignora backoff) y un pull completo ya. */
export async function syncNow(): Promise<void> {
  await runPushCycle({ ignoreBackoff: true });
  await runPullCycleNow({ full: true });
}

/** Ciclo completo al arrancar/red de seguridad de push (10-15 min — #87 separa esto del pull). */
export const PUSH_INTERVAL_MS = 12 * 60 * 1000;
/** Red de seguridad de pull, independiente de que haya habido push (#87: cadencias propias). */
export const PULL_SAFETY_NET_INTERVAL_MS = 15 * 60 * 1000;
/** "Un rato después" de un push exitoso, antes de pedir el delta correspondiente (#87). */
export const PULL_DELAY_AFTER_PUSH_MS = 2 * 60 * 1000;
/** Agrupa pedidos de push seguidos (varios eventos del outbox casi juntos). */
export const PUSH_DEBOUNCE_MS = 2_000;
const MIN_RETRY_TIMER_MS = 1_000;
const MAX_RETRY_TIMER_MS = 5 * 60 * 1000;

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pushDueAt = 0;

/** Agenda un push. Si ya hay uno agendado más cerca, lo conserva; si el nuevo es más cercano, lo adelanta. */
export function requestPushSoon(delayMs: number = PUSH_DEBOUNCE_MS): void {
  const dueAt = Date.now() + delayMs;
  if (pushTimer !== undefined) {
    if (pushDueAt <= dueAt) {
      return;
    }
    clearTimeout(pushTimer);
  }
  pushDueAt = dueAt;
  pushTimer = setTimeout(() => {
    pushTimer = undefined;
    void runPushCycle();
  }, delayMs);
}

export function cancelScheduledPush(): void {
  if (pushTimer !== undefined) {
    clearTimeout(pushTimer);
    pushTimer = undefined;
  }
}

let pullTimer: ReturnType<typeof setTimeout> | undefined;
let pullDueAt = 0;

function schedulePullSoon(delayMs: number): void {
  const dueAt = Date.now() + delayMs;
  if (pullTimer !== undefined) {
    if (pullDueAt <= dueAt) {
      return;
    }
    clearTimeout(pullTimer);
  }
  pullDueAt = dueAt;
  pullTimer = setTimeout(() => {
    pullTimer = undefined;
    void runPullCycleNow();
  }, delayMs);
}

export function cancelScheduledPull(): void {
  if (pullTimer !== undefined) {
    clearTimeout(pullTimer);
    pullTimer = undefined;
  }
}

/** Agenda un push para cuando venza el backoff del lote en curso, si hay uno fallido. */
async function scheduleNextPushRetry(): Promise<void> {
  const lot = getCurrentPushLot();
  if (lot === undefined) {
    return;
  }
  const delay = Math.min(
    Math.max(new Date(lot.nextAttemptAt).getTime() - Date.now(), MIN_RETRY_TIMER_MS),
    MAX_RETRY_TIMER_MS,
  );
  requestPushSoon(delay);
}

/**
 * Motor de sync mientras la pestaña está abierta (Fase 2; Background Sync de
 * Service Worker sigue siendo Fase 7). Push y pull corren en dos cadencias
 * independientes (#87): push al arrancar + cada `PUSH_INTERVAL_MS` + por
 * cada evento nuevo del outbox (debounced) + al vencer su backoff; pull al
 * arrancar + cada `PULL_SAFETY_NET_INTERVAL_MS` + un rato después de cada
 * push exitoso. El evento `online` dispara los dos. Devuelve la función que
 * lo detiene (tests).
 */
export function startSyncEngine(): () => void {
  resetFullRefreshSession();
  void runPushCycle();
  void runPullCycleNow();
  const pushInterval = setInterval(() => void runPushCycle(), PUSH_INTERVAL_MS);
  const pullInterval = setInterval(() => void runPullCycleNow(), PULL_SAFETY_NET_INTERVAL_MS);
  const onOnline = (): void => {
    void runPushCycle();
    void runPullCycleNow();
  };
  window.addEventListener('online', onOnline);
  const onOutboxEvent = (): void => {
    requestPushSoon();
  };
  db.outbox.hook('creating', onOutboxEvent);

  return () => {
    clearInterval(pushInterval);
    clearInterval(pullInterval);
    window.removeEventListener('online', onOnline);
    db.outbox.hook('creating').unsubscribe(onOutboxEvent);
    cancelScheduledPush();
    cancelScheduledPull();
  };
}
```

Agregar a los imports de la cabecera de `engine.ts`: `type SyncConfig` de `./config.ts` y
`pushLotIssuesSignal` a la lista ya importada de `../ui/state/sync.ts` (la Task 8 ya importaba
`setPushLotIssues` de ahí).

- [ ] **Step 5: Actualizar los call sites de `/SINCRONIZAR` y del cierre de `/CONFIG`**

En `src/ui/keyboard/command-bar-controller.ts`, la línea `void runSyncCycle({ full: true });` del
`case 'SINCRONIZAR':` pasa a `void syncNow();` (y el import correspondiente de `'../../sync/engine.ts'`
cambia de `runSyncCycle` a `syncNow`).

En `src/ui/keyboard/config-controller.ts`, la línea `void runSyncCycle();` al final de
`applyAndFinish` pasa a:

```typescript
  void runPushCycle();
  void runPullCycleNow();
```

(mismo comportamiento que tenía — resume el motor normal tras cerrar `/CONFIG`; el import cambia
de `runSyncCycle` a `runPushCycle, runPullCycleNow`).

- [ ] **Step 6: Actualizar los mocks en los tests que dependían de `runSyncCycle`**

En `src/ui/keyboard/command-bar-controller.test.ts`, el `vi.mock('../../sync/engine.ts', ...)`
pasa de `{ runSyncCycle: vi.fn(() => Promise.resolve()) }` a `{ syncNow: vi.fn(() =>
Promise.resolve()) }`, y la aserción de `describe('/SINCRONIZAR', ...)` pasa de
`expect(runSyncCycle).toHaveBeenCalledWith({ full: true })` a `expect(syncNow).toHaveBeenCalled()`
(sin argumentos que verificar — `syncNow` no los tiene).

En `src/ui/keyboard/config-controller.test.ts` y `src/ui/screens/config-screen.test.tsx`, el mock
de `runSyncCycle: vi.fn(() => Promise.resolve())` pasa a `{ runPushCycle: vi.fn(() =>
Promise.resolve()), runPullCycleNow: vi.fn(() => Promise.resolve()) }`.

- [ ] **Step 7: Correr toda la suite de Vitest y verificar que pasa completa**

Run: `pnpm vitest run`
Expected: PASS — esta es la primera vez en el plan que se corre la suite completa sin fallos
esperados; si algo más quedó atado a `runSyncCycle`/`pushOnce`/`syncOnce`/`syncFull` en algún
archivo no listado acá, aparece ahora.

- [ ] **Step 8: Typecheck completo**

Run: `pnpm typecheck`
Expected: PASS en todo lo que no sea `connectors/rest/*`, `connectors/google-sheets/*` ni
`sync/connection.ts`/`sync/apply-connection.ts`/`storage/demo-reset.ts` (Tasks 10, 14, 15 — esos
siguen contra el puerto viejo hasta esas tareas).

- [ ] **Step 9: Commit**

```bash
git add src/sync/full-refresh.ts src/sync/full-refresh.test.ts src/sync/engine.ts src/sync/engine.test.ts \
  src/ui/keyboard/command-bar-controller.ts src/ui/keyboard/command-bar-controller.test.ts \
  src/ui/keyboard/config-controller.ts src/ui/keyboard/config-controller.test.ts \
  src/ui/screens/config-screen.test.tsx
git commit -m "feat(sync): cadencias independientes de push/pull, /SINCRONIZAR fuerza las dos ya (#87)"
```

---

### Task 10: `sync/apply-connection.ts` + `storage/demo-reset.ts` — limpiar estado de lotes al cambiar de origen

**Files:**
- Modify: `src/sync/apply-connection.ts`
- Modify: `src/sync/apply-connection.test.ts`
- Modify: `src/storage/demo-reset.ts`
- Modify: `src/storage/demo-reset.test.ts` (si asertaba sobre `clearSyncCursors` puntualmente —
  revisar; si no, no hace falta tocarlo)

**Interfaces:**
- Consumes: `pushPendingLot` de Task 7, `clearPushLotState` de Task 4.
- Produces: nada nuevo — ajusta comportamiento existente.

`sync/connection.ts` **no se toca**: ya delega en `pullEverything`/`withTimeout` de
`sync/pull-snapshot.ts` (actualizados en la Task 8), y no conoce el puerto `Connector` en detalle.

- [ ] **Step 1: Test — `flushPendingBeforeWipe` habla con `pushBatch`, no con `pushSale`**

En `src/sync/apply-connection.test.ts`, reemplazar el primer test de
`describe('flushPendingBeforeWipe', ...)`:

```typescript
  it('empuja los pendientes al conector actual ignorando el backoff del lote', async () => {
    await db.outbox.put(buildOutboxEventForSale(makeSale('s1'), { now }));
    const pushBatch = vi.fn().mockResolvedValue(ok(undefined));

    await flushPendingBeforeWipe(oldConfig, { connector: fakeConnector({ pushBatch }) });

    expect(pushBatch).toHaveBeenCalledTimes(1);
    await expect(db.outbox.get(makeSale('s1').id)).resolves.toMatchObject({ status: 'synced' });
  });
```

Los otros dos tests de ese `describe` (cuelgue del conector, cerrojo ya tomado) usan
`pushSale: () => new Promise<never>(...)` / `pushSale: vi.fn()...` — cambiar esos dos `pushSale` por
`pushBatch` (misma forma, mismo comportamiento esperado).

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run src/sync/apply-connection.test.ts -t "flushPendingBeforeWipe"`
Expected: FAIL — `flushPendingBeforeWipe` sigue llamando a `pushPendingEvents` (puerto viejo).

- [ ] **Step 3: Implementación — `flushPendingBeforeWipe` usa `pushPendingLot`**

En `src/sync/apply-connection.ts`, cambiar el import `pushPendingEvents` de `'./engine.ts'` por
`pushPendingLot`, y dentro de la función:

```typescript
    const connector = options.connector ?? createConnector(current);
    await withTimeout(
      pushPendingLot(connector, new Date().toISOString(), { ignoreBackoff: true }).then(() => ok(undefined)),
      timeoutMs,
    );
```

Y en `applyConnection`, agregar `clearPushLotState()` junto al `clearSyncCursors()` existente
(import de `./push-lot.ts`):

```typescript
    clearSyncCursors();
    clearPushLotState();
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run src/sync/apply-connection.test.ts`
Expected: PASS.

- [ ] **Step 5: `storage/demo-reset.ts` — limpiar también el estado de lotes**

En `src/storage/demo-reset.ts`, agregar el import de `clearPushLotState` desde `'../sync/push-lot.ts'`
y llamarlo junto a `clearSyncCursors()`:

```typescript
  clearSyncCursors();
  clearPushLotState();
```

Run: `pnpm vitest run src/storage/demo-reset.test.ts`
Expected: PASS sin cambios de aserciones (nada testeaba el estado de lotes todavía — este paso no
tiene un ciclo rojo/verde propio, es una línea de limpieza consistente con el mismo momento en que
ya se limpian los cursores).

- [ ] **Step 6: Commit**

```bash
git add src/sync/apply-connection.ts src/sync/apply-connection.test.ts src/storage/demo-reset.ts
git commit -m "fix(sync): limpiar el estado de lotes de push al cambiar de conexión y en /DEMO_RESET"
```

---

### Task 11: `docs/connector-api.openapi.yaml` — reescritura completa al contrato batch

**Files:**
- Modify: `docs/connector-api.openapi.yaml` (reescritura completa, no un parche — mismo criterio
  que ya documentaba la versión vieja para sus propios agregados)

**Interfaces:**
- Consumes: las formas exactas de `OutboxBatchItem`/`PullBatchParams`/`PullBatchResult`/
  `BatchLotStatus` de Task 5 (el YAML las documenta, no las importa).
- Produces: el documento que Task 12 (demo-backend) y Task 14 (rest connector) implementan al pie
  de la letra.

No es TDD (es documentación) — se verifica leyéndolo contra lo ya implementado en las Tasks 1-10 y
ajustando si algo no calza, no con un test automatizado.

- [ ] **Step 1: Reemplazar el documento completo**

```yaml
openapi: 3.1.0
info:
  title: offline-pos Connector API
  version: '2.0.0'
  description: |
    Contrato que cualquier sistema externo (ERP, e-commerce, facturación,
    inventario) debe implementar para conectarse al POS — ver §6 del doc de
    diseño (`pos-web-diseno-arquitectura.md`), la sección "Connector API" de
    `CLAUDE.md` y el spec de rediseño
    (`docs/superpowers/specs/2026-09-22-sync-por-lotes-design.md`, issue #87).

    **v2 reemplaza por completo la v1** (10 endpoints por recurso/evento) por
    dos operaciones batch más dos excepciones síncronas. Principio central:
    **el backend nunca valida ni rechaza el contenido de lo que el POS
    manda** — solo registra y audita. Puede dejar de aceptar lotes de una
    terminal por motivos propios (cuota, contrato), pero eso nunca lo hace
    devolviendo un error de negocio a un push: se resuelve puertas adentro
    o se informa como `issues` en un pull posterior, nunca como un
    "rechazo" síncrono.

    Cada operación está marcada con una extensión `x-pos-status`:
      - `implemented-etapa-1`: el POS ya la consume (rediseño de sync, Etapa 1, #87).
      - `documented-not-implemented`: parte del contrato, sin consumidor todavía.

    Autenticación: Bearer token, configurado por terminal (ver `/CONFIG` en
    la app) — desacoplada del contrato en sí, cada integración define cómo
    emite ese token.
servers:
  - url: https://api.example.com
    description: Placeholder — cada instalación configura su propia base URL vía /CONFIG.
security:
  - bearerAuth: []

paths:
  /sync/push:
    post:
      operationId: pushBatch
      summary: Envía toda la cola pendiente del outbox en un solo lote
      x-pos-status: implemented-etapa-1
      description: |
        Un solo `idempotency_id` para el lote entero (no uno por evento) —
        reintentar el mismo lote (mismo id, mismo conjunto de eventos) nunca
        debe duplicar su efecto. La respuesta es un ack de **recepción**, no
        de procesamiento: el backend puede seguir procesando el lote después
        de responder 200. El estado real de procesamiento (`ok`/`issues`) se
        consulta después, vía `/sync/pull` (ver `PullBatchResponse.lots`).

        El backend nunca devuelve un error de negocio acá — solo errores de
        transporte reales (auth, payload no parseable). Cualquier
        inconsistencia de negocio (stock, cuenta corriente) se resuelve del
        lado del backend y se informa como `issues`, nunca como un 4xx.
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PushBatchRequest'
      responses:
        '200':
          description: Lote recibido (o ya recibido antes, si el idempotency_id se repite).

  /sync/pull:
    post:
      operationId: pullBatch
      summary: Trae productos, stock y clientes en una sola llamada, más el estado de lotes de push
      x-pos-status: implemented-etapa-1
      description: |
        Un `POST` (no `GET`) porque los parámetros son estructurados
        (cursores por recurso, lista de ids de lotes) — no una query string
        plana.

        Cada recurso trae su propio cursor `since` opcional en el request:
        **ausente pide la foto completa de ese recurso**, que tiene que ser
        el conjunto entero, no paginado ni truncado (el POS la usa para
        darse cuenta de las bajas — un delta nunca las informa). `stock`
        nunca tiene cursor: siempre viaja completo, es liviano.

        `lots` en la respuesta solo trae estado para los ids de
        `pendingLotIds` que el backend todavía reconoce — un id ausente en
        la respuesta se trata, del lado del POS, igual que `pending` (más
        conservador: nunca aplicar datos si no se puede confirmar que un
        lote de interés ya se resolvió).

        **Regla de aplicación (la más importante de este endpoint)**: si
        algún lote de `pendingLotIds` sigue `pending` (o no viene informado),
        el POS descarta el resto de esta respuesta entera — ni el delta ni
        la foto completa se aplican — y reintenta más tarde.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PullBatchRequest'
      responses:
        '200':
          description: Datos pedidos, más el estado de los lotes de interés.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PullBatchResponse'

  /account-holds:
    post:
      operationId: postAccountHold
      summary: Bloqueo síncrono de crédito antes de cerrar una venta a cuenta corriente
      x-pos-status: implemented-etapa-1
      description: |
        Única operación del contrato pensada para llamarse de forma síncrona
        durante el cobro (§5 del doc de diseño) — nunca pasa por el outbox ni
        por `/sync/push`. Sin cambios respecto de la v1 del contrato.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AccountHoldRequest'
      responses:
        '200':
          description: Resultado del bloqueo (aprobado o rechazado).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AccountHoldResponse'

  /account-balance/{customerId}:
    get:
      operationId: getAccountBalance
      summary: Consulta síncrona del saldo cacheado de un cliente (futura cobranza de cuenta corriente)
      x-pos-status: documented-not-implemented
      description: |
        Todavía no implementada del lado del POS (backlog #51/#59) — se deja
        documentada para que agregar cobranza de cuenta corriente más
        adelante sea sumar un consumidor a un endpoint ya definido, no
        rediseñar el contrato. Síncrona por el mismo motivo que
        `/account-holds`: la pantalla de cobranza necesita el saldo ya para
        decidir cuánto ofrecer cobrar.
      parameters:
        - name: customerId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Saldo actual cacheado del backend para ese cliente.
          content:
            application/json:
              schema:
                type: object
                required: [balance]
                properties:
                  balance: { type: number }

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: Token configurado por terminal (ver `/CONFIG`) — opcional si el backend no lo requiere.

  parameters:
    IdempotencyKey:
      name: Idempotency-Key
      in: header
      required: true
      schema:
        type: string
      description: ULID del lote (o de la operación síncrona) — repetir el mismo valor nunca debe duplicar el efecto.

  schemas:
    Product:
      type: object
      required: [id, sku, barcodes, name, price, taxRate, category, tracksStock]
      properties:
        id: { type: string }
        sku: { type: string }
        barcodes: { type: array, items: { type: string } }
        name: { type: string }
        price: { type: number, minimum: 0 }
        taxRate: { type: number, minimum: 0, maximum: 1 }
        category: { type: string }
        tracksStock: { type: boolean }

    StockItem:
      type: object
      required: [productId, quantity, updatedAt]
      properties:
        productId: { type: string }
        quantity: { type: number }
        updatedAt: { type: string, format: date-time }

    Customer:
      type: object
      required: [id, name]
      properties:
        id: { type: string }
        name: { type: string }
        document: { type: string }
        phone: { type: string }
        creditLimit: { type: number, description: Cuenta corriente, opcional — ver §6 del doc de diseño. }
        margin: { type: number }
        balance: { type: number }
        updatedAt: { type: string, format: date-time }
        unrestricted:
          type: boolean
          description: |
            Fiado sin bloqueo de crédito para este cliente (Etapa 3, #69) —
            aprueba sin evaluar creditLimit/margin/balance, que pueden omitirse.

    Discount:
      type: object
      required: [type, value]
      properties:
        type: { type: string, enum: [amount, percentage] }
        value: { type: number }

    SaleLine:
      oneOf:
        - $ref: '#/components/schemas/ProductSaleLine'
        - $ref: '#/components/schemas/FreeformSaleLine'

    ProductSaleLine:
      type: object
      required: [kind, productId, qty, unitPrice]
      properties:
        kind: { type: string, enum: [product] }
        productId: { type: string }
        qty: { type: number }
        unitPrice: { type: number }
        discount: { $ref: '#/components/schemas/Discount' }

    FreeformSaleLine:
      type: object
      required: [kind, description, qty, unitPrice]
      properties:
        kind: { type: string, enum: [freeform] }
        description: { type: string }
        qty: { type: number }
        unitPrice: { type: number }
        discount: { $ref: '#/components/schemas/Discount' }

    Payment:
      type: object
      required: [method, amount]
      properties:
        method: { type: string, enum: [cash, debit, credit, transfer, qr, account] }
        amount: { type: number }
        reference: { type: string, description: Para method=account con red, el holdId del bloqueo aprobado (§5). }

    Sale:
      type: object
      required: [id, lines, payments, total, status, createdAt]
      properties:
        id: { type: string }
        lines: { type: array, items: { $ref: '#/components/schemas/SaleLine' } }
        payments: { type: array, items: { $ref: '#/components/schemas/Payment' } }
        total: { type: number }
        status: { type: string, enum: [open, closed, voided] }
        createdAt: { type: string, format: date-time }
        syncedAt: { type: string, format: date-time }
        voidedAt: { type: string, format: date-time }
        voidReason: { type: string }
        customerId: { type: string }

    StockMovement:
      type: object
      required: [id, productId, delta, reason, createdAt]
      properties:
        id: { type: string }
        productId: { type: string }
        delta: { type: number }
        reason: { type: string, enum: [sale, sale-void] }
        saleId: { type: string }
        createdAt: { type: string, format: date-time }

    CashSession:
      type: object
      required: [id, openedAt, openingAmount, sales]
      properties:
        id: { type: string }
        openedAt: { type: string, format: date-time }
        closedAt: { type: string, format: date-time }
        openingAmount: { type: number }
        closingAmount: { type: number }
        sales: { type: array, items: { type: string } }

    OutboxBatchItem:
      description: |
        Un evento del outbox tal como viaja dentro de un lote de push —
        discriminado por `type`. Los 7 tipos son exactamente los mismos que
        ya existían por separado en la v1 del contrato; acá viajan todos
        juntos en `PushBatchRequest.events`.
      oneOf:
        - $ref: '#/components/schemas/SaleEvent'
        - $ref: '#/components/schemas/StockMovementEvent'
        - $ref: '#/components/schemas/SaleVoidEvent'
        - $ref: '#/components/schemas/CustomerEvent'
        - $ref: '#/components/schemas/AccountHoldConfirmEvent'
        - $ref: '#/components/schemas/AccountHoldReleaseEvent'
        - $ref: '#/components/schemas/CashSessionEvent'

    SaleEvent:
      type: object
      required: [type, id, sale]
      properties:
        type: { type: string, enum: [sale] }
        id: { type: string }
        sale: { $ref: '#/components/schemas/Sale' }

    StockMovementEvent:
      type: object
      required: [type, id, movement]
      properties:
        type: { type: string, enum: [stock-movement] }
        id: { type: string }
        movement: { $ref: '#/components/schemas/StockMovement' }

    SaleVoidEvent:
      type: object
      required: [type, id, saleId, voidedAt]
      properties:
        type: { type: string, enum: [sale-void] }
        id: { type: string }
        saleId: { type: string }
        voidedAt: { type: string, format: date-time }
        voidReason: { type: string }

    CustomerEvent:
      type: object
      required: [type, id, customer]
      properties:
        type: { type: string, enum: [customer] }
        id: { type: string }
        customer: { $ref: '#/components/schemas/Customer' }

    AccountHoldConfirmEvent:
      type: object
      required: [type, id, holdId, saleId]
      properties:
        type: { type: string, enum: [account-hold-confirm] }
        id: { type: string }
        holdId: { type: string }
        saleId: { type: string }

    AccountHoldReleaseEvent:
      type: object
      required: [type, id, holdId]
      properties:
        type: { type: string, enum: [account-hold-release] }
        id: { type: string }
        holdId: { type: string }

    CashSessionEvent:
      type: object
      required: [type, id, session]
      properties:
        type: { type: string, enum: [cash-session] }
        id: { type: string }
        session: { $ref: '#/components/schemas/CashSession' }

    PushBatchRequest:
      type: object
      required: [events]
      properties:
        events:
          type: array
          items: { $ref: '#/components/schemas/OutboxBatchItem' }

    PullBatchRequest:
      type: object
      required: [cursors, pendingLotIds]
      properties:
        cursors:
          type: object
          description: Cursor por recurso; ausente pide la foto completa de ese recurso.
          properties:
            products: { type: string }
            customers: { type: string }
        pendingLotIds:
          type: array
          items: { type: string }
          description: idempotency_id de lotes de push que el POS mandó y todavía no confirmó ok/issues.

    ProductsPullResult:
      type: object
      required: [items]
      properties:
        items: { type: array, items: { $ref: '#/components/schemas/Product' } }
        nextCursor: { type: string, description: Pasar como cursors.products en el próximo pull. }

    CustomersPullResult:
      type: object
      required: [items]
      properties:
        items: { type: array, items: { $ref: '#/components/schemas/Customer' } }
        nextCursor: { type: string, description: Pasar como cursors.customers en el próximo pull. }

    BatchLotStatus:
      description: |
        `pending` es un valor propio, no la ausencia de ok/issues: mientras
        un lote está pending no se sabe todavía si va a tener problemas.
      oneOf:
        - type: object
          required: [status]
          properties: { status: { type: string, enum: [pending] } }
        - type: object
          required: [status]
          properties: { status: { type: string, enum: [ok] } }
        - type: object
          required: [status, issues]
          properties:
            status: { type: string, enum: [issues] }
            issues: { type: array, items: { type: string } }

    PullBatchResponse:
      type: object
      required: [products, customers, stock, lots]
      properties:
        products: { $ref: '#/components/schemas/ProductsPullResult' }
        customers: { $ref: '#/components/schemas/CustomersPullResult' }
        stock: { type: array, items: { $ref: '#/components/schemas/StockItem' } }
        lots:
          type: object
          additionalProperties: { $ref: '#/components/schemas/BatchLotStatus' }
          description: Una entrada por cada id de pendingLotIds que el backend todavía reconoce.

    AccountHoldRequest:
      type: object
      required: [customerId, amount]
      properties:
        customerId: { type: string }
        amount: { type: number }

    AccountHoldResponse:
      oneOf:
        - type: object
          required: [approved, holdId]
          properties:
            approved: { type: boolean, enum: [true] }
            holdId: { type: string }
        - type: object
          required: [approved, reasonCode]
          properties:
            approved: { type: boolean, enum: [false] }
            reasonCode: { type: string }
```

- [ ] **Step 2: Commit**

```bash
git add docs/connector-api.openapi.yaml
git commit -m "docs: contrato v2 — pushBatch/pullBatch reemplazan los 10 endpoints por recurso (#87)"
```

---

### Task 12: `demo-backend` — endpoints `/sync/push` y `/sync/pull`

**Files:**
- Modify: `demo-backend/src/db.ts` (tabla `push_lots`)
- Create: `demo-backend/src/routes/sync.ts`
- Modify: `demo-backend/src/routes/account-holds.ts` (deja solo `POST /account-holds`)
- Modify: `demo-backend/src/server.ts`
- Delete: `demo-backend/src/routes/products.ts`, `demo-backend/src/routes/stock.ts`,
  `demo-backend/src/routes/customers.ts`, `demo-backend/src/routes/events.ts`

**Interfaces:**
- Consumes: nada de `src/` (demo-backend es un proyecto Node aparte, sin imports cruzados).
- Produces: `syncRoutes: RouteDef[]` (exportado de `routes/sync.ts`), consumido por Task 13 (sus
  tests) y por `server.ts`.

Esta tarea no sigue rojo→verde clásico por endpoint nuevo (no hay tests todavía — llegan en la
Task 13, que si se ejecuta con `subagent-driven-development` puede fusionarse con esta). Se
verifica con la suite completa de `demo-backend` al final de la Task 13.

- [ ] **Step 1: Agregar la tabla `push_lots`**

En `demo-backend/src/db.ts`, agregar a `SCHEMA` (junto a las demás tablas):

```sql
CREATE TABLE IF NOT EXISTS push_lots (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  issues TEXT,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 2: `demo-backend/src/routes/sync.ts` — nuevo**

```typescript
// demo-backend/src/routes/sync.ts
import type { DatabaseSync } from 'node:sqlite';
import { readJsonBody, sendJson } from '../http-helpers.ts';
import { withIdempotency } from '../idempotency.ts';
import type { RouteDef } from '../router.ts';

type OutboxBatchItem =
  | { type: 'sale'; id: string; sale: unknown }
  | { type: 'stock-movement'; id: string; movement: unknown }
  | { type: 'sale-void'; id: string; saleId: string; voidedAt: string; voidReason?: string }
  | { type: 'customer'; id: string; customer: { id: string } & Record<string, unknown> }
  | { type: 'account-hold-confirm'; id: string; holdId: string; saleId: string }
  | { type: 'account-hold-release'; id: string; holdId: string }
  | { type: 'cash-session'; id: string; session: unknown };

type CustomerAccountPayload = {
  id: string;
  name: string;
  creditLimit?: number;
  margin?: number;
  balance?: number;
};

function getCustomerPayload(db: DatabaseSync, customerId: string): CustomerAccountPayload | undefined {
  const row = db.prepare('SELECT payload FROM customers WHERE id = ?').get(customerId) as
    | { payload: string }
    | undefined;
  return row === undefined ? undefined : (JSON.parse(row.payload) as CustomerAccountPayload);
}

/**
 * Aplica un evento del lote de push (#87) — el backend nunca rechaza por
 * contenido, así que esto nunca devuelve un error de negocio, solo escribe.
 * Upsert por id en cada tabla: con idempotencia ahora por LOTE en vez de por
 * evento, un mismo evento en dos lotes distintos pisa en vez de chocar (el
 * backend "se arregla como puede", ver spec).
 */
function applyBatchEvent(db: DatabaseSync, event: OutboxBatchItem, now: string): void {
  switch (event.type) {
    case 'sale':
      db.prepare(
        'INSERT INTO sales (id, payload, created_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
      ).run(event.id, JSON.stringify(event.sale), now);
      return;
    case 'stock-movement':
      db.prepare(
        'INSERT INTO stock_movements (id, payload, created_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
      ).run(event.id, JSON.stringify(event.movement), now);
      return;
    case 'sale-void':
      db.prepare(
        'INSERT INTO sale_voids (id, sale_id, payload, created_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
      ).run(event.id, event.saleId, JSON.stringify(event), now);
      return;
    case 'customer':
      db.prepare(
        'INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
      ).run(event.customer.id, JSON.stringify(event.customer), 'pos', now);
      return;
    case 'account-hold-confirm': {
      const hold = db
        .prepare('SELECT customer_id, amount, status FROM account_holds WHERE id = ?')
        .get(event.holdId) as { customer_id: string; amount: number; status: string } | undefined;
      if (hold !== undefined && hold.status === 'pending') {
        const customer = getCustomerPayload(db, hold.customer_id);
        if (customer !== undefined && customer.balance !== undefined) {
          db.prepare('UPDATE customers SET payload = ?, updated_at = ? WHERE id = ?').run(
            JSON.stringify({ ...customer, balance: customer.balance + hold.amount }),
            now,
            hold.customer_id,
          );
        }
        db.prepare("UPDATE account_holds SET status = 'confirmed', confirmed_at = ? WHERE id = ?").run(
          now,
          event.holdId,
        );
      }
      return;
    }
    case 'account-hold-release':
      db.prepare(
        "UPDATE account_holds SET status = 'released', released_at = ? WHERE id = ? AND status = 'pending'",
      ).run(now, event.holdId);
      return;
    case 'cash-session':
      db.prepare(
        'INSERT INTO cash_sessions (id, payload, created_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
      ).run(event.id, JSON.stringify(event.session), now);
      return;
    default: {
      const exhaustiveCheck: never = event;
      throw new Error(`Tipo de evento de outbox desconocido: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

type ResourceRow = { payload: string; updated_at: string };

function pullResource(
  db: DatabaseSync,
  table: 'products' | 'customers',
  since: string | undefined,
): { items: unknown[]; nextCursor?: string } {
  const rows = (
    since === undefined
      ? db.prepare(`SELECT payload, updated_at FROM ${table} ORDER BY updated_at ASC`).all()
      : db
          .prepare(`SELECT payload, updated_at FROM ${table} WHERE updated_at > ? ORDER BY updated_at ASC`)
          .all(since)
  ) as ResourceRow[];
  const last = rows.at(-1);
  return {
    items: rows.map((row) => JSON.parse(row.payload) as unknown),
    ...(last !== undefined ? { nextCursor: last.updated_at } : {}),
  };
}

export const syncRoutes: RouteDef[] = [
  {
    method: 'POST',
    pattern: /^\/sync\/push$/,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string') {
        sendJson(res, 400, { error: 'Falta el header Idempotency-Key' });
        return;
      }
      const body = (await readJsonBody(req)) as { events: OutboxBatchItem[] };
      const result = await withIdempotency(ctx.db, idempotencyKey, () => {
        const now = new Date().toISOString();
        for (const event of body.events) {
          applyBatchEvent(ctx.db, event, now);
        }
        // Este backend de demo resuelve cada lote al toque — un backend real puede dejarlo
        // `pending` acá y actualizarlo más tarde de forma asíncrona (ver spec, #87).
        ctx.db
          .prepare(
            'INSERT INTO push_lots (id, status, issues, created_at) VALUES (?, ?, ?, ?) ' +
              'ON CONFLICT(id) DO NOTHING',
          )
          .run(idempotencyKey, 'ok', null, now);
        return { status: 200, body: {} };
      });
      sendJson(res, result.status, result.body);
    },
  },
  {
    method: 'POST',
    pattern: /^\/sync\/pull$/,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const body = (await readJsonBody(req)) as {
        cursors: { products?: string; customers?: string };
        pendingLotIds: string[];
      };

      const products = pullResource(ctx.db, 'products', body.cursors.products);
      const customers = pullResource(ctx.db, 'customers', body.cursors.customers);
      const stockRows = ctx.db.prepare('SELECT * FROM stock').all() as {
        product_id: string;
        quantity: number;
        updated_at: string;
      }[];

      const lots: Record<string, { status: string; issues?: string[] }> = {};
      for (const lotId of body.pendingLotIds) {
        const row = ctx.db.prepare('SELECT status, issues FROM push_lots WHERE id = ?').get(lotId) as
          | { status: string; issues: string | null }
          | undefined;
        if (row !== undefined) {
          lots[lotId] =
            row.issues !== null
              ? { status: row.status, issues: JSON.parse(row.issues) as string[] }
              : { status: row.status };
        }
      }

      sendJson(res, 200, {
        products,
        customers,
        stock: stockRows.map((row) => ({
          productId: row.product_id,
          quantity: row.quantity,
          updatedAt: row.updated_at,
        })),
        lots,
      });
    },
  },
];
```

- [ ] **Step 3: `demo-backend/src/routes/account-holds.ts` — sacar `confirm`/`release` (ahora viajan en el lote)**

Borrar los dos últimos elementos del array `accountHoldRoutes` (los de `pattern:
/^\/account-holds\/(?<holdId>[^/]+)\/confirm$/` y `pattern: /^\/account-holds\/(?<holdId>[^/]+)$/`
con `method: 'DELETE'`), junto con las funciones `logAttempt`/`getCustomer` si quedan sin otro uso
(revisar — `logAttempt('request', ...)` en el primer route sigue usándose, no se saca; `getCustomer`
puede quedar sin uso si nada más la llama, en cuyo caso se saca junto con `StoredHold` si tampoco se
usa más). El primer elemento (`POST /account-holds`, la reserva síncrona) queda intacto.

- [ ] **Step 4: Borrar los archivos de rutas viejos y actualizar `server.ts`**

```bash
rm demo-backend/src/routes/products.ts demo-backend/src/routes/stock.ts \
   demo-backend/src/routes/customers.ts demo-backend/src/routes/events.ts
```

En `demo-backend/src/server.ts`, reemplazar los imports y `registerRoutes` de esos cuatro módulos
por uno solo:

```typescript
import { syncRoutes } from './routes/sync.ts';
// ...
registerRoutes(syncRoutes);
```

(dejar `accountHoldRoutes`, `demoResetRoute`, `panelRoutes` como están).

- [ ] **Step 5: Typecheck de `demo-backend`**

Run: `cd demo-backend && pnpm typecheck` (o el script equivalente del `package.json` de
`demo-backend`)
Expected: PASS. Los tests todavía referencian los archivos borrados — se arregla en la Task 13, no
correr `pnpm test` todavía acá.

- [ ] **Step 6: Commit**

```bash
git add demo-backend/src
git commit -m "feat(demo-backend): endpoints /sync/push y /sync/pull, reemplazan los 10 de la v1 (#87)"
```

---

### Task 13: `demo-backend` — tests de `/sync/push` y `/sync/pull`

**Files:**
- Create: `demo-backend/test/routes/sync.test.ts`
- Modify: `demo-backend/test/routes/account-holds.test.ts` (deja solo `POST /account-holds`)
- Delete: `demo-backend/test/routes/products.test.ts`, `demo-backend/test/routes/stock.test.ts`,
  `demo-backend/test/routes/customers.test.ts`, `demo-backend/test/routes/events.test.ts`

**Interfaces:**
- Consumes: `syncRoutes` de Task 12.
- Produces: cobertura de test — nada que otras tareas consuman.

- [ ] **Step 1: Recortar `account-holds.test.ts` a solo `POST /account-holds`**

Borrar los `describe` de `POST /account-holds/{holdId}/confirm` y `DELETE /account-holds/{holdId}`
completos (esos casos se re-testean vía `/sync/push` en el Step 2) — dejar solo el primer
`describe('POST /account-holds', ...)` con sus 5 tests, sin cambios.

- [ ] **Step 2: `demo-backend/test/routes/sync.test.ts` — nuevo**

```typescript
// demo-backend/test/routes/sync.test.ts
import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { accountHoldRoutes } from '../../src/routes/account-holds.ts';
import { syncRoutes } from '../../src/routes/sync.ts';

beforeAll(() => {
  registerRoutes(syncRoutes);
  registerRoutes(accountHoldRoutes);
});

let server: Server;
let baseUrl: string;
let db: ReturnType<typeof openDb>;

beforeEach(async () => {
  db = openDb(':memory:');
  server = createApp(db);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No se pudo obtener el puerto del servidor de test');
  }
  baseUrl = `http://localhost:${String(address.port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

async function push(idempotencyKey: string, events: unknown[]): Promise<Response> {
  return fetch(`${baseUrl}/sync/push`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer demo-token',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ events }),
  });
}

async function pull(body: { cursors: Record<string, string>; pendingLotIds: string[] }): Promise<Response> {
  return fetch(`${baseUrl}/sync/pull`, {
    method: 'POST',
    headers: { Authorization: 'Bearer demo-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /sync/push', () => {
  it('siempre responde 200, nunca simula rechazo de negocio', async () => {
    const response = await push('lot-1', [{ type: 'sale', id: 'sale-1', sale: { id: 'sale-1', total: 1200 } }]);
    expect(response.status).toBe(200);
  });

  it('exige Idempotency-Key', async () => {
    const response = await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    });
    expect(response.status).toBe(400);
  });

  it('aplica los 7 tipos de evento en un solo lote', async () => {
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'cust-01', JSON.stringify({ id: 'cust-01', name: 'Ana', creditLimit: 1000, margin: 0, balance: 0 }), 'seed', '2026-01-01T00:00:00.000Z',
    );
    const holdResponse = await fetch(`${baseUrl}/account-holds`, {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token', 'Content-Type': 'application/json', 'Idempotency-Key': 'hold-req' },
      body: JSON.stringify({ customerId: 'cust-01', amount: 300 }),
    });
    const { holdId } = (await holdResponse.json()) as { holdId: string };

    const response = await push('lot-full', [
      { type: 'sale', id: 'sale-1', sale: { id: 'sale-1', total: 300 } },
      { type: 'stock-movement', id: 'mov-1', movement: { id: 'mov-1', productId: 'p1', delta: -1 } },
      { type: 'sale-void', id: 'void-1', saleId: 'sale-1', voidedAt: '2026-01-01T00:00:00.000Z' },
      { type: 'customer', id: 'cust-02', customer: { id: 'cust-02', name: 'Beto' } },
      { type: 'account-hold-confirm', id: 'confirm-1', holdId, saleId: 'sale-1' },
      { type: 'cash-session', id: 'cs-1', session: { id: 'cs-1', sales: ['sale-1'] } },
    ]);

    expect(response.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) c FROM sales').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) c FROM stock_movements').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) c FROM sale_voids').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) c FROM cash_sessions').get()).toEqual({ c: 1 });
    const customer = JSON.parse(
      (db.prepare('SELECT payload FROM customers WHERE id = ?').get('cust-01') as { payload: string }).payload,
    ) as { balance: number };
    expect(customer.balance).toBe(300); // confirmado por el lote
    const hold = db.prepare('SELECT status FROM account_holds WHERE id = ?').get(holdId) as { status: string };
    expect(hold.status).toBe('confirmed');
  });

  it('account-hold-release libera el hold sin tocar el balance', async () => {
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'cust-01', JSON.stringify({ id: 'cust-01', name: 'Ana', creditLimit: 1000, margin: 0, balance: 0 }), 'seed', '2026-01-01T00:00:00.000Z',
    );
    const holdResponse = await fetch(`${baseUrl}/account-holds`, {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token', 'Content-Type': 'application/json', 'Idempotency-Key': 'hold-req-2' },
      body: JSON.stringify({ customerId: 'cust-01', amount: 300 }),
    });
    const { holdId } = (await holdResponse.json()) as { holdId: string };

    await push('lot-release', [{ type: 'account-hold-release', id: 'release-1', holdId }]);

    const hold = db.prepare('SELECT status FROM account_holds WHERE id = ?').get(holdId) as { status: string };
    expect(hold.status).toBe('released');
  });

  it('idempotencia por lote: reenviar el mismo idempotency_id no vuelve a insertar', async () => {
    await push('lot-dup', [{ type: 'sale', id: 'sale-9', sale: { id: 'sale-9', total: 100 } }]);
    const second = await push('lot-dup', [{ type: 'sale', id: 'sale-9', sale: { id: 'sale-9', total: 999 } }]);

    expect(second.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) c FROM sales').get()).toEqual({ c: 1 });
  });

  it('registra el lote en push_lots como ok', async () => {
    await push('lot-tracked', [{ type: 'sale', id: 'sale-tracked', sale: { id: 'sale-tracked', total: 1 } }]);

    const lot = db.prepare('SELECT status FROM push_lots WHERE id = ?').get('lot-tracked') as { status: string };
    expect(lot.status).toBe('ok');
  });
});

describe('POST /sync/pull', () => {
  beforeEach(() => {
    db.prepare('INSERT INTO products (id, payload, updated_at) VALUES (?, ?, ?)').run(
      'p1', JSON.stringify({ id: 'p1', sku: 'S1', barcodes: [], name: 'Arroz', price: 100, taxRate: 0, category: 'x', tracksStock: true }), '2026-01-01T00:00:01.000Z',
    );
    db.prepare('INSERT INTO stock (product_id, quantity, updated_at) VALUES (?, ?, ?)').run('p1', 5, '2026-01-01T00:00:00.000Z');
  });

  it('sin cursores trae la foto completa de productos/clientes y siempre el stock entero', async () => {
    const response = await pull({ cursors: {}, pendingLotIds: [] });
    const body = (await response.json()) as { products: { items: unknown[] }; stock: unknown[] };

    expect(body.products.items).toHaveLength(1);
    expect(body.stock).toEqual([{ productId: 'p1', quantity: 5, updatedAt: '2026-01-01T00:00:00.000Z' }]);
  });

  it('con cursor trae solo lo actualizado después, y devuelve nextCursor', async () => {
    const response = await pull({ cursors: { products: '2026-01-01T00:00:01.000Z' }, pendingLotIds: [] });
    const body = (await response.json()) as { products: { items: unknown[]; nextCursor?: string } };

    expect(body.products.items).toEqual([]);
    expect(body.products.nextCursor).toBeUndefined();
  });

  it('informa el estado de los lotes de push pedidos, y omite los que no reconoce', async () => {
    await push('lot-known', [{ type: 'sale', id: 'sale-1', sale: { id: 'sale-1', total: 1 } }]);

    const response = await pull({ cursors: {}, pendingLotIds: ['lot-known', 'lot-desconocido'] });
    const body = (await response.json()) as { lots: Record<string, { status: string }> };

    expect(body.lots).toEqual({ 'lot-known': { status: 'ok' } });
    expect(body.lots['lot-desconocido']).toBeUndefined();
  });
});
```

- [ ] **Step 3: Borrar los archivos de test viejos**

```bash
rm demo-backend/test/routes/products.test.ts demo-backend/test/routes/stock.test.ts \
   demo-backend/test/routes/customers.test.ts demo-backend/test/routes/events.test.ts
```

- [ ] **Step 4: Correr toda la suite de `demo-backend` y verificar que pasa**

Run: `cd demo-backend && pnpm test`
Expected: PASS.

- [ ] **Step 5: Typecheck de `demo-backend`**

Run: `cd demo-backend && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo-backend/test
git commit -m "test(demo-backend): cobertura de /sync/push y /sync/pull, recorta account-holds.test.ts"
```

---

### Task 14: `connectors/rest/rest-fetch-connector.ts` — implementación de referencia sobre el contrato batch

**Files:**
- Modify: `src/connectors/rest/rest-fetch-connector.ts`
- Modify: `src/connectors/rest/rest-fetch-connector.test.ts`

**Interfaces:**
- Consumes: `Connector`, `OutboxBatchItem`, `PullBatchParams`, `PullBatchResult`,
  `connectorCustomerSchema`, `accountHoldResultSchema` de `sync/connector.ts` (Task 5).
- Produces: `createRestFetchConnector(config: RestConnectionConfig): Connector` — misma firma que
  hoy, consumida por `sync/connector-registry.ts` sin cambios.

- [ ] **Step 1: Test — reemplazar todo lo que no sea `describe('requestAccountHold', ...)`**

En `src/connectors/rest/rest-fetch-connector.test.ts`, el `describe('requestAccountHold', ...)`
(líneas 189-226 de hoy) **no cambia** — sigue pegándole a `/account-holds`, sin tocar. Reemplazar
todo el resto (`pushSale`, `pushSaleVoid`, `pullProducts`, `pullCustomers`, `pushCustomer`,
`pushAccountHoldConfirm`, `releaseAccountHold`, `pushCashSession`, `pullStock`) por:

```typescript
describe('pushBatch', () => {
  it('hace POST a /sync/push con Idempotency-Key = idempotencyId y todos los items en el body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createRestFetchConnector(config);
    const items = [
      { type: 'sale' as const, id: 'sale-1', sale },
      { type: 'customer' as const, id: 'c1', customer },
    ];

    const result = await connector.pushBatch(items, 'lot-1');

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/sync/push');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Idempotency-Key': 'lot-1', Authorization: 'Bearer secret-key' });
    expect(init.body).toBe(JSON.stringify({ events: items }));
  });

  it('devuelve sync/request-failed con el status si el servidor responde error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 })));
    const connector = createRestFetchConnector(config);

    const result = await connector.pushBatch([{ type: 'sale', id: 'sale-1', sale }], 'lot-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/request-failed');
      expect(result.meta).toMatchObject({ status: 500 });
    }
  });

  it('devuelve sync/request-failed si fetch rechaza (sin red)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const connector = createRestFetchConnector(config);

    const result = await connector.pushBatch([{ type: 'sale', id: 'sale-1', sale }], 'lot-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.meta).toMatchObject({ message: 'network down' });
    }
  });
});

describe('pullBatch', () => {
  it('hace POST a /sync/pull con cursors y pendingLotIds en el body, y parsea la respuesta', async () => {
    const stockItem = { productId: 'p1', quantity: 5, updatedAt: '2026-01-01T00:00:00.000Z' };
    const rawCustomer = { id: 'c1', name: 'Juan Pérez', creditLimit: 1000, margin: 0, balance: 0 };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        products: { items: [product], nextCursor: 'cur-p' },
        customers: { items: [rawCustomer], nextCursor: 'cur-c' },
        stock: [stockItem],
        lots: { 'lot-1': { status: 'ok' } },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const connector = createRestFetchConnector(config);

    const result = await connector.pullBatch({ cursors: { products: 'cur-viejo' }, pendingLotIds: ['lot-1'] });

    expect(result).toEqual({
      ok: true,
      value: {
        products: { items: [product], nextCursor: 'cur-p' },
        customers: { items: [rawCustomer], nextCursor: 'cur-c' },
        stock: [stockItem],
        lots: { 'lot-1': { status: 'ok' } },
      },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/sync/pull');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      cursors: { products: 'cur-viejo' },
      pendingLotIds: ['lot-1'],
    });
  });

  it('propaga un lote con status issues tal cual', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          products: { items: [] }, customers: { items: [] }, stock: [],
          lots: { 'lot-1': { status: 'issues', issues: ['stock insuficiente'] } },
        }),
      ),
    );
    const connector = createRestFetchConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: ['lot-1'] });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ lots: { 'lot-1': { status: 'issues', issues: ['stock insuficiente'] } } }),
    });
  });

  it('devuelve sync/invalid-payload si la respuesta no matchea el schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ products: { items: [{ id: 'p1' }] } })));
    const connector = createRestFetchConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `pnpm vitest run src/connectors/rest/rest-fetch-connector.test.ts`
Expected: FAIL — `pushBatch`/`pullBatch` no existen en la implementación todavía.

- [ ] **Step 3: Implementación**

Reemplazar `src/connectors/rest/rest-fetch-connector.ts` completo:

```typescript
// src/connectors/rest/rest-fetch-connector.ts
import { z } from 'zod';
import { productSchema } from '../../domain/product.ts';
import { err, ok, type Result } from '../../domain/result.ts';
import { stockItemSchema } from '../../domain/stock.ts';
import { toZodIssues } from '../../domain/zod-issues.ts';
import {
  accountHoldResultSchema,
  connectorCustomerSchema,
  type AccountHoldResult,
  type Connector,
  type OutboxBatchItem,
  type PullBatchParams,
  type PullBatchResult,
} from '../../sync/connector.ts';
import type { RestConnectionConfig } from './config.ts';

const batchLotStatusSchema = z.union([
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('ok') }),
  z.object({ status: z.literal('issues'), issues: z.array(z.string()) }),
]);

const pullBatchResponseSchema = z.object({
  products: z.object({ items: z.array(productSchema), nextCursor: z.string().optional() }),
  customers: z.object({ items: z.array(connectorCustomerSchema), nextCursor: z.string().optional() }),
  stock: z.array(stockItemSchema),
  lots: z.record(z.string(), batchLotStatusSchema),
});

function buildHeaders(config: RestConnectionConfig, idempotencyKey?: string): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey !== undefined) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  if (idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return headers;
}

/**
 * Implementación de referencia del puerto `Connector` sobre `fetch` (ver
 * `docs/connector-api.openapi.yaml`, contrato v2 — #87). El *request*
 * (nuestro propio dato ya tipado) nunca se valida con Zod; la *respuesta* de
 * un pull sí es externa → se valida.
 */
export function createRestFetchConnector(config: RestConnectionConfig): Connector {
  async function postJson(
    path: string,
    idempotencyKey: string | undefined,
    body: unknown,
  ): Promise<Result<unknown>> {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: buildHeaders(config, idempotencyKey),
        body: JSON.stringify(body),
      });
    } catch (error) {
      return err('sync/request-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (!response.ok) {
      return err('sync/request-failed', { status: response.status, message: response.statusText });
    }
    try {
      return ok(await response.json());
    } catch {
      return err('sync/invalid-payload', {
        issues: [{ path: '', message: 'La respuesta no es JSON válido' }],
      });
    }
  }

  return {
    async pushBatch(items: OutboxBatchItem[], idempotencyId: string): Promise<Result<void>> {
      const result = await postJson('/sync/push', idempotencyId, { events: items });
      if (!result.ok) {
        return result;
      }
      return ok(undefined);
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
      return ok(parsed.data);
    },

    async requestAccountHold(params, idempotencyKey: string): Promise<Result<AccountHoldResult>> {
      const jsonResult = await postJson('/account-holds', idempotencyKey, params);
      if (!jsonResult.ok) {
        return jsonResult;
      }
      const parsed = accountHoldResultSchema.safeParse(jsonResult.value);
      if (!parsed.success) {
        return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
      }
      return ok(parsed.data);
    },
  };
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `pnpm vitest run src/connectors/rest/rest-fetch-connector.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS en todo lo que no sea `connectors/google-sheets/*` (Task 15, todavía contra el
puerto viejo).

- [ ] **Step 6: Commit**

```bash
git add src/connectors/rest/rest-fetch-connector.ts src/connectors/rest/rest-fetch-connector.test.ts
git commit -m "feat(connectors): rest-fetch-connector sobre pushBatch/pullBatch (#87)"
```

---

### Task 15: `connectors/google-sheets/google-sheets-connector.ts` — adaptador al puerto nuevo (sin tocar `bridge.gs`)

**Files:**
- Modify: `src/connectors/google-sheets/google-sheets-connector.ts`
- Modify: `src/connectors/google-sheets/google-sheets-connector.test.ts`

**Interfaces:**
- Consumes: `Connector`, `OutboxBatchItem`, `PullBatchParams`, `PullBatchResult`, `BatchLotStatus`
  de `sync/connector.ts` (Task 5). **No** consume nada nuevo de `bridge.gs` — sigue llamando
  exactamente las mismas acciones que ya existen ahí (`pullProducts`, `pullCustomers`, `pushSale`,
  `pushSaleVoid`, `pushCustomer`, `pushAccountHoldConfirm`, `pushCashSession`).
- Produces: `createGoogleSheetsConnector(config): Connector` — misma firma, consumida por
  `sync/connector-registry.ts` sin cambios.

**Contexto para quien ejecute**: esto es a propósito un adaptador mecánico, no una reescritura real
— la decisión confirmada con el usuario (ver cabecera de este plan, punto 4) es que
`connectors/google-sheets/bridge.gs` recibe su batch real recién en la Etapa 2. Acá el conector seguí
haciendo un round-trip por evento contra el puente (como ya hacía), pero puertas afuera cumple el
puerto `pushBatch`/`pullBatch` nuevo: llama a los mismos endpoints de siempre, uno por ítem, en
orden, y devuelve error apenas el primero falla (los ítems restantes del lote quedan pendientes para
el próximo intento — inocuo, cada ítem sigue viajando con SU PROPIO id como `idempotencyKey` al
puente, igual que antes, así que reintentar un ítem que ya se aplicó no lo duplica). El pull ya no
tenía cursor real (`pullProducts`/`pullCustomers` siempre completos, "planilla de un
micro-comercio, es chica") — eso no cambia; `lots` se informa siempre `ok` para cualquier id pedido,
porque para cuando `pushBatch` devolvió éxito, cada ítem ya se escribió de verdad en la planilla (no
hay un estado "pending" real que modelar en este adaptador).

- [ ] **Step 1: Test — reemplazar `describe('pushes', ...)` y `describe('operaciones locales (sin red)', ...)`, agregar `pullBatch`**

En `src/connectors/google-sheets/google-sheets-connector.test.ts`, los `describe('pullProducts',
...)` y `describe('pullCustomers', ...)` de hoy se **fusionan** en un solo `describe('pullBatch',
...)`; `describe('pushes', ...)` pasa a `describe('pushBatch', ...)`; `describe('operaciones locales
(sin red)', ...)` se acota a lo que sigue siendo no-op (`requestAccountHold`, y ahora también
`stock-movement`/`account-hold-release` **dentro** de `pushBatch`, no como métodos propios).
Reemplazar esos tres bloques por:

```typescript
describe('pullBatch', () => {
  it('llama a pullProducts y pullCustomers, fuerza tracksStock:false y unrestricted:true', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { action: string };
      if (body.action === 'pullProducts') {
        return Promise.resolve(bridgeOk({
          items: [{ id: 'p1', sku: 'SKU-1', barcodes: ['111'], name: 'Arroz 1kg', price: 100, taxRate: 0.21, category: 'almacen', tracksStock: true }],
        }));
      }
      return Promise.resolve(bridgeOk({ items: [{ id: 'c1', name: 'Ana', phone: '1155' }] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: [] });

    expect(result).toEqual({
      ok: true,
      value: {
        products: { items: [{ id: 'p1', sku: 'SKU-1', barcodes: ['111'], name: 'Arroz 1kg', price: 100, taxRate: 0.21, category: 'almacen', tracksStock: false }] },
        customers: { items: [{ id: 'c1', name: 'Ana', phone: '1155', unrestricted: true }] },
        stock: [],
        lots: {},
      },
    });
    expect(sentEnvelope(fetchMock, 0)).toEqual({ action: 'pullProducts', payload: {} });
    expect(sentEnvelope(fetchMock, 1)).toEqual({ action: 'pullCustomers', payload: {} });
  });

  it('informa ok para cada pendingLotId pedido, sin llamar a ningún endpoint de estado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bridgeOk({ items: [] })));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: ['lot-1', 'lot-2'] });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ lots: { 'lot-1': { status: 'ok' }, 'lot-2': { status: 'ok' } } }),
    });
  });

  it('devuelve sync/invalid-payload si un producto no cumple el schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bridgeOk({ items: [{ id: 'p1' }] })));
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/invalid-payload');
    }
  });

  it('propaga el error del puente y corta sin llamar a pullCustomers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeError('Planilla ocupada'));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pullBatch({ cursors: {}, pendingLotIds: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('sync/remote-error');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('pushBatch', () => {
  it('manda cada ítem al puente con su propia idempotencyKey, en orden', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushBatch(
      [
        { type: 'sale', id: 'sale-1', sale },
        { type: 'customer', id: 'c1', customer },
      ],
      'lot-1', // el lot id no se usa contra el puente — cada ítem sigue con el suyo propio
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(sentEnvelope(fetchMock, 0)).toEqual({ action: 'pushSale', payload: { sale }, idempotencyKey: 'sale-1' });
    expect(sentEnvelope(fetchMock, 1)).toEqual({ action: 'pushCustomer', payload: { customer }, idempotencyKey: 'c1' });
  });

  it('sale-void, account-hold-confirm y cash-session mandan la misma forma que antes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);
    const voidParams = { saleId: 'sale-1', voidedAt: '2026-01-02T00:00:00.000Z', voidReason: 'error de precio' };

    await connector.pushBatch(
      [
        { type: 'sale-void', id: 'void-1', ...voidParams },
        { type: 'account-hold-confirm', id: 'confirm-1', holdId: 'hold-1', saleId: 'sale-1' },
        { type: 'cash-session', id: 'cs-1', session: cashSession },
      ],
      'lot-2',
    );

    expect(sentEnvelope(fetchMock, 0)).toEqual({ action: 'pushSaleVoid', payload: voidParams, idempotencyKey: 'void-1' });
    expect(sentEnvelope(fetchMock, 1)).toEqual({
      action: 'pushAccountHoldConfirm', payload: { holdId: 'hold-1', saleId: 'sale-1' }, idempotencyKey: 'confirm-1',
    });
    expect(sentEnvelope(fetchMock, 2)).toEqual({ action: 'pushCashSession', payload: { session: cashSession }, idempotencyKey: 'cs-1' });
  });

  it('stock-movement y account-hold-release son no-ops: no llaman al puente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeOk({}));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushBatch(
      [
        { type: 'stock-movement', id: 'm1', movement: { id: 'm1', productId: 'p1', delta: -1, reason: 'sale', createdAt: '2026-01-01T00:00:00.000Z' } },
        { type: 'account-hold-release', id: 'release-1', holdId: 'hold-1' },
      ],
      'lot-3',
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('corta en el primer error del puente, sin mandar los ítems siguientes', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(bridgeError('Venta no encontrada'));
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const result = await connector.pushBatch(
      [
        { type: 'sale', id: 'sale-1', sale },
        { type: 'customer', id: 'c1', customer },
      ],
      'lot-4',
    );

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('requestAccountHold (sin red)', () => {
  it('aprueba siempre con un holdId nuevo y no llama a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const connector = createGoogleSheetsConnector(config);

    const first = await connector.requestAccountHold({ customerId: 'c1', amount: 500 }, 'k1');
    const second = await connector.requestAccountHold({ customerId: 'c1', amount: 500 }, 'k2');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.approved).toBe(true);
      expect(second.value.approved).toBe(true);
      if (first.value.approved && second.value.approved) {
        expect(first.value.holdId).not.toBe(second.value.holdId);
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `pnpm vitest run src/connectors/google-sheets/google-sheets-connector.test.ts`
Expected: FAIL — `pushBatch`/`pullBatch` no existen en la implementación todavía.

- [ ] **Step 3: Implementación**

Reemplazar `src/connectors/google-sheets/google-sheets-connector.ts` completo:

```typescript
// src/connectors/google-sheets/google-sheets-connector.ts
import { z } from 'zod';
import { productSchema } from '../../domain/product.ts';
import { ok, type Result } from '../../domain/result.ts';
import { newId } from '../../storage/ids.ts';
import {
  connectorCustomerSchema,
  type AccountHoldResult,
  type BatchLotStatus,
  type Connector,
  type OutboxBatchItem,
  type PullBatchParams,
  type PullBatchResult,
} from '../../sync/connector.ts';
import { callBridge } from './bridge-client.ts';
import type { GoogleSheetsConfig } from './config.ts';

/** Producto tal como lo manda el puente: sin `tracksStock`, que fija este conector. */
const bridgeProductSchema = productSchema.omit({ tracksStock: true });

const productsDataSchema = z.object({ items: z.array(bridgeProductSchema) });
const customersDataSchema = z.object({ items: z.array(connectorCustomerSchema) });
const emptyDataSchema = z.object({});

/**
 * Implementación del puerto `Connector` contra un Apps Script Web App (ver
 * `README.md` de esta carpeta y el spec de la Etapa 1, #67) — adaptada al
 * contrato batch (#87) de forma **mecánica**: `bridge.gs` sigue exponiendo
 * las mismas acciones de siempre, una por evento; este conector solo cambia
 * su cara hacia `sync/engine.ts`, no su forma de hablar con el puente. La
 * Etapa 2 le da a `bridge.gs` un batch real puertas adentro — ver CLAUDE.md,
 * "Connector API".
 *
 * `stock-movement`/`account-hold-release` siguen siendo no-ops (nunca hubo
 * llamada real al puente para esto, ver la implementación anterior a #87):
 * el fiado contra Sheets es sin bloqueo real que liberar, y
 * `pullProducts` ya fija `tracksStock: false` así que un movimiento de
 * stock nunca se genera para estos productos en la práctica.
 */
export function createGoogleSheetsConnector(config: GoogleSheetsConfig): Connector {
  async function pushOne(item: OutboxBatchItem): Promise<Result<void>> {
    switch (item.type) {
      case 'sale':
        return callBridge(config, { action: 'pushSale', payload: { sale: item.sale }, idempotencyKey: item.id }, emptyDataSchema)
          .then((r) => (r.ok ? ok(undefined) : r));
      case 'sale-void': {
        const payload = {
          saleId: item.saleId,
          voidedAt: item.voidedAt,
          ...(item.voidReason !== undefined ? { voidReason: item.voidReason } : {}),
        };
        return callBridge(config, { action: 'pushSaleVoid', payload, idempotencyKey: item.id }, emptyDataSchema)
          .then((r) => (r.ok ? ok(undefined) : r));
      }
      case 'customer':
        return callBridge(config, { action: 'pushCustomer', payload: { customer: item.customer }, idempotencyKey: item.id }, emptyDataSchema)
          .then((r) => (r.ok ? ok(undefined) : r));
      case 'account-hold-confirm':
        return callBridge(
          config,
          { action: 'pushAccountHoldConfirm', payload: { holdId: item.holdId, saleId: item.saleId }, idempotencyKey: item.id },
          emptyDataSchema,
        ).then((r) => (r.ok ? ok(undefined) : r));
      case 'cash-session':
        return callBridge(config, { action: 'pushCashSession', payload: { session: item.session }, idempotencyKey: item.id }, emptyDataSchema)
          .then((r) => (r.ok ? ok(undefined) : r));
      case 'stock-movement':
      case 'account-hold-release':
        return Promise.resolve(ok(undefined));
      default: {
        const exhaustiveCheck: never = item;
        throw new Error(`Tipo de evento de outbox desconocido: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  return {
    async pushBatch(items: OutboxBatchItem[]): Promise<Result<void>> {
      for (const item of items) {
        const result = await pushOne(item);
        if (!result.ok) {
          return result;
        }
      }
      return ok(undefined);
    },

    async pullBatch(params: PullBatchParams): Promise<Result<PullBatchResult>> {
      const productsResult = await callBridge(config, { action: 'pullProducts', payload: {} }, productsDataSchema);
      if (!productsResult.ok) {
        return productsResult;
      }
      const customersResult = await callBridge(config, { action: 'pullCustomers', payload: {} }, customersDataSchema);
      if (!customersResult.ok) {
        return customersResult;
      }

      const lots: Record<string, BatchLotStatus> = {};
      for (const id of params.pendingLotIds) {
        lots[id] = { status: 'ok' };
      }

      return ok({
        products: { items: productsResult.value.items.map((item) => ({ ...item, tracksStock: false })) },
        customers: { items: customersResult.value.items.map((item) => ({ ...item, unrestricted: true })) },
        stock: [],
        lots,
      });
    },

    requestAccountHold(): Promise<Result<AccountHoldResult>> {
      return Promise.resolve(ok({ approved: true, holdId: newId() }));
    },
  };
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `pnpm vitest run src/connectors/google-sheets/google-sheets-connector.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck y suite completa de Vitest**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS completo — esta es la primera vez en el plan que TODO (motor, ambos conectores,
demo-backend aparte) tipa y testea limpio a la vez.

- [ ] **Step 6: Commit**

```bash
git add src/connectors/google-sheets/google-sheets-connector.ts src/connectors/google-sheets/google-sheets-connector.test.ts
git commit -m "feat(connectors): google-sheets-connector — adaptador mecánico a pushBatch/pullBatch

bridge.gs no cambia en esta etapa (Etapa 2 le da batch real puertas adentro,
ver CLAUDE.md 'Connector API' y el plan de la Etapa 1)."
```

---

### Task 16: e2e — actualizar los mocks de red al contrato batch

**Files:**
- Modify: `e2e/connection-lifecycle.spec.ts`

**Interfaces:**
- Consumes: nada de `src/` (Playwright corre contra el build real).
- Produces: nada — solo hace que los mocks de red sigan siendo fieles al contrato después de las
  Tasks 11-15.

`e2e/minibackend-sync.spec.ts` (usa el minibackend real, no un mock) y el resto de los specs de
`e2e/` **no se tocan**: no referencian ninguna ruta HTTP vieja (confirmado con
`grep -rn "/products\|/customers\|/stock\|/sales\|/account-holds\|/cash-sessions" e2e/`, único
otro hit es `/_demo/api/sales` del panel de demo-backend, que no forma parte del contrato del
`Connector` y no cambia).

No hay ciclo rojo/verde propio acá (son mocks de test, no producción) — se verifica corriendo la
suite e2e completa al final.

- [ ] **Step 1: Actualizar `routeRestBackend` al contrato batch**

En `e2e/connection-lifecycle.spec.ts`, reemplazar la función `routeRestBackend` completa:

```typescript
/** Backend REST simulado en http://backend.test: OPTIONS + /sync/push y /sync/pull vacíos. */
async function routeRestBackend(page: Page): Promise<void> {
  await page.route('http://backend.test/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/sync/pull'
        ? { products: { items: [] }, customers: { items: [] }, stock: [], lots: {} }
        : {};
    await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
  });
}
```

(`routeSheetsBridge` no cambia — `bridge.gs` sigue con las mismas acciones de siempre.)

- [ ] **Step 2: Antes de correr e2e — verificar que los puertos 4000 y 4173 estén libres**

Run (bash):

```bash
lsof -i :4000 -i :4173 || echo "libres"
```

Si algo aparece corriendo en esos puertos, avisar y esperar a que se libere (o pedir confirmación
antes de matarlo) — `demo-backend` usa 4000, `pnpm preview` usa 4173, y los tests e2e asumen que
ambos están disponibles para ellos.

- [ ] **Step 3: Build real y suite e2e completa**

Run: `pnpm build && pnpm test:e2e`
Expected: PASS completo, incluido `minibackend-sync.spec.ts` (requiere `demo-backend` corriendo —
revisar `e2e/README`/`package.json` de si hace falta levantarlo aparte con `pnpm --filter
demo-backend dev` antes, o si `pnpm test:e2e` ya lo orquesta; seguir lo que ya hacía la suite antes
de este plan, esto no cambia).

- [ ] **Step 4: Commit**

```bash
git add e2e/connection-lifecycle.spec.ts
git commit -m "test(e2e): mocks de red al contrato batch (/sync/push, /sync/pull)"
```

---

### Task 17: CLAUDE.md, issue #13, y cierre de la Etapa 1 (PR a main)

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** ninguna — tarea de documentación y de flujo de git/GitHub, cierra la etapa.

- [ ] **Step 1: `CLAUDE.md` — reescribir "Patrón outbox (offline-first)"**

Reemplazar el título y el primer bloque de esa sección (desde "## Patrón outbox (offline-first) —
implementado en Fase 2..." hasta el párrafo que termina en "...el sistema externo manda.") por:

```markdown
## Patrón outbox (offline-first) — implementado en Fase 2, rediseñado a lotes en la Etapa 1 de #87

Toda mutación relevante (`closeSaleAndPersist`, `voidSaleAndPersist`) escribe **primero** en la
tabla local `outbox` (`domain/outbox.ts::OutboxEvent`, unión discriminada por `type` — nunca
`payload: unknown`), en la misma transacción Dexie que el registro de negocio. La venta/anulación
ya está cerrada y operativa localmente sin importar el resultado del sync.

**Push: un solo lote, un solo ack (#87)**. `sync/engine.ts::pushPendingLot` manda **toda** la cola
`pending` del outbox de una vez, con un `idempotency_id` (ULID) generado al armar el lote y
**congelado** junto con el conjunto exacto de eventos incluidos: un reintento del mismo lote (fallo
de red) reenvía siempre el mismo id y los mismos eventos, nunca recalcula agregando lo que haya
entrado al outbox mientras tanto — eso evita duplicar un lote que sí llegó pero cuyo ack se perdió.
El backend nunca rechaza el contenido de un lote (ver "Connector API" más abajo); el ack confirma
solo que lo recibió, no que ya terminó de procesarlo. `domain/push-lot.ts` tiene el backoff
exponencial (mismo esquema que antes, ahora por lote en vez de por evento);
`sync/push-lot.ts` lo persiste en `localStorage` (mismo criterio best-effort que
`sync/cursor.ts`) junto con la lista de lotes ya enviados que todavía no confirmaron `ok`/`issues`.

**Pull: un solo lote, gateado por el estado de los lotes de push (#87)**.
`sync/engine.ts::runPullCycle` pide productos/clientes (con cursor `since` opcional por recurso, o
sin él para pedir la foto completa de ese recurso) y stock (siempre completo) en una sola llamada,
más el estado (`pending`/`ok`/`issues`) de los lotes de push que el POS todavía espera confirmar.
**Si alguno de esos lotes sigue `pending` (o el backend no lo informa), el pull entero se descarta**
— ni el delta ni la foto completa se aplican — porque aplicar sin saber si el último push ya se
procesó podría reconciliar contra un estado que ese push todavía no reflejó. Un lote que se resuelve
con `issues` no bloquea nada (el POS nunca se autobloquea) — solo se muestra al humano vía
`pushLotIssuesSignal` (`ui/state/sync.ts`, `ui/errors.ts::sync/push-issues`).

**Cadencias independientes (#87)**: push cada `PUSH_INTERVAL_MS` (10-15 min) + al arrancar + por
cada evento nuevo del outbox (debounced 2 s) + al vencer el backoff del lote fallido; pull cada
`PULL_SAFETY_NET_INTERVAL_MS` (15 min) + al arrancar + un rato (`PULL_DELAY_AFTER_PUSH_MS`, 2 min)
después de cada push exitoso — a propósito **no combinados** en un solo roundtrip (responsabilidades
distintas, cadencias distintas). `/SINCRONIZAR` (`sync/engine.ts::syncNow`) fuerza las dos ya: push
ignorando su backoff, después un pull completo ignorando la cadencia de 2 h.
`tryAcquireSyncLock`/`acquireSyncLockWaiting` (sin cambios) siguen siendo el único cerrojo — cada
request individual (un push, un pull) lo toma y lo suelta alrededor de sí mismo, nunca durante todo
el intervalo entre ciclos.

**Foto completa y bajas**: sin cambios de fondo respecto de antes de #87 — un pull sin cursor de un
recurso es la fuente de verdad de ese recurso (`storage/reconcile.ts::reconcileSnapshot`, todo o
nada, nunca toca ventas/turnos/movimientos/outbox/venta en curso), cada conector declara su
`pullMode` (`connector-registry.ts`), la foto completa de un conector `delta` se repite cada 2 h
(`sync/full-refresh.ts::FULL_REFRESH_INTERVAL_MS`, antes 1 h) además de al arrancar y a pedido.

Cuenta corriente (Fase 3) sigue siendo el único flujo con red síncrona fuera de este mecanismo:
`requestAccountHold` (§5) no pasa por el outbox ni por `/sync/push`. Su confirmación
(`account-hold-confirm`) y su liberación best-effort (`account-hold-release`) sí viajan como
cualquier otro evento **dentro** del lote de push desde #87 — antes de esta etapa,
`account-hold-release` se trataba aparte como "best-effort"; con push por lote deja de necesitar ese
trato especial, es un evento más.

**Distinto de la venta en curso**: `outbox` es para eventos ya cerrados que necesitan viajar a un
backend — la venta en curso, mientras se está armando, vive en su propia tabla (`draftCart`, ver
"Patrones establecidos"), con un criterio totalmente distinto: sobrevivir a un refresh/crash de esta
terminal, nunca viajar a ningún lado.
```

- [ ] **Step 2: `CLAUDE.md` — reescribir "Connector API"**

Reemplazar el primer párrafo de "## Connector API" (el que dice "El POS no tiene lógica de ningún
backend particular... `x-pos-status` marcando en qué fase se implementó.") por:

```markdown
El POS no tiene lógica de ningún backend particular, solo del contrato (REST/JSON versionado,
documentado en `docs/connector-api.openapi.yaml`). **Desde la Etapa 1 del rediseño de sync (#87,
"el backend nunca rechaza") el contrato pasó de 10 endpoints por recurso/evento a dos operaciones
batch** (`POST /sync/push`, `POST /sync/pull`) más dos excepciones síncronas: la reserva de crédito
existente (`POST /account-holds`, sin cambios) y una futura consulta de saldo
(`GET /account-balance/{customerId}`, documentada pero `x-pos-status: documented-not-implemented`
— backlog #51/#59). `sync/connector.ts::Connector` tiene, en consecuencia, solo tres métodos:
`pushBatch`, `pullBatch` y `requestAccountHold`. Principio central del contrato: **el backend nunca
evalúa el contenido de lo que el POS manda** — no hay forma de que una venta, un cliente, un
movimiento de stock o un cierre de caja sea "rechazado" de forma síncrona; el backend registra todo
y audita, y cualquier inconsistencia se resuelve de su lado o a mano. Esto cierra el punto que
`CLAUDE.md` tenía anotado como backlog (issue #13): "que el Connector API no debería poder
'rechazar' una venta ya cerrada de forma síncrona". El backend sí puede, por motivos propios (cuota,
contrato), dejar de aceptar lotes de una terminal — el POS nunca hace cumplir eso por su cuenta, solo
se lo muestra al humano vía la barra de estado (ver "Patrón outbox" más arriba).
```

Y, en el párrafo que sigue (el que arranca "`POST /sales/{saleId}/void` es un recurso que §6..."),
agregar al final, antes del párrafo de `POST /cash-sessions`:

```markdown
Los tres gaps de la v1 (`/sales/{saleId}/void`, `POST /customers`, `POST
/account-holds/{holdId}/confirm`) y `account-hold-release` viajan hoy como eventos del lote de
`/sync/push` (`OutboxBatchItem`, unión discriminada por `type` en `sync/connector.ts`) — ya no son
endpoints HTTP propios.
```

- [ ] **Step 3: `CLAUDE.md` — agregar a "Estado del proyecto"**

Al final de la sección "Estado del proyecto" (después del párrafo de "Conectores plugin (epic #66,
...)" y antes de "**Issues marcados `backlog`**..."), agregar:

```markdown
- Rediseño de sincronización por lotes (issue #87, spec
  `docs/superpowers/specs/2026-09-22-sync-por-lotes-design.md`, sesión de brainstorming 2026-09-22):
  "el backend vende... y el backend es responsable de aceptar cualquier cosa" — el contrato pasa de
  10 endpoints por recurso/evento a dos operaciones batch (`pushBatch`/`pullBatch`) con cadencias
  propias, gateadas entre sí (un pull nunca aplica datos mientras un lote de push que le interesa
  siga sin resolverse). Dividido en dos etapas como el epic #66: **Etapa 1** (este commit) —
  contrato nuevo, motor de sync, `demo-backend` y `connectors/rest/` de punta a punta;
  `connectors/google-sheets/` recibe un adaptador mecánico (mismos endpoints de `bridge.gs` de
  siempre, sin tocar el puente). **Etapa 2** (pendiente) — batch real en `bridge.gs`, resolviendo el
  lock del script puertas adentro en vez de exponerlo como error al POS. Reemplaza la cadencia que
  se acababa de construir en los PR #83/#84 horas antes de esta sesión de brainstorming. Cierra
  parcialmente el issue #13 (ver "Connector API" más arriba) — la mitad de esa issue sobre
  notificación asíncrona de discrepancias de negocio (ej. descuadre de stock) sigue sin diseñarse,
  se re-scopeó ahí mismo.
```

- [ ] **Step 4: Commit de CLAUDE.md**

```bash
git add CLAUDE.md
git commit -m "docs: actualizar CLAUDE.md — sincronización por lotes, Etapa 1 (#87)"
```

- [ ] **Step 5: Push y PR a `main`**

```bash
git push -u origin HEAD
gh pr create --base main --title "Sincronización por lotes — Etapa 1: núcleo + REST de referencia (#87)" --body "$(cat <<'EOF'
## Resumen

Etapa 1 del rediseño de sync (issue #87, spec en
`docs/superpowers/specs/2026-09-22-sync-por-lotes-design.md`): el backend nunca rechaza ni valida
nada, push y pull pasan a ser dos operaciones batch con cadencias propias, y un pull nunca aplica
datos mientras un lote de push que le interesa siga sin resolverse.

- `sync/connector.ts`: el puerto pasa de 10 métodos por recurso/evento a `pushBatch`/`pullBatch` + `requestAccountHold` (sin cambios).
- `domain/push-lot.ts` (nuevo) + `sync/push-lot.ts`: backoff y persistencia del lote de push a nivel de lote (antes era por evento).
- `sync/engine.ts`: cadencias independientes — push cada 10-15 min, pull cada 15 min + un rato después de cada push exitoso, foto completa cada 2h/al configurar/a pedido. `/SINCRONIZAR` fuerza las dos ya.
- `demo-backend/` y `connectors/rest/`: implementación de referencia del contrato nuevo de punta a punta (`/sync/push`, `/sync/pull`).
- `connectors/google-sheets/`: adaptador mecánico al puerto nuevo — `bridge.gs` no cambia todavía (Etapa 2).
- `docs/connector-api.openapi.yaml`: reescritura completa a la v2 del contrato.
- Cierra parcialmente el issue #13 (ver comentario en la issue).

## Test plan

- [ ] `pnpm typecheck` sin errores
- [ ] `pnpm vitest run` (unit + integración) en verde
- [ ] `cd demo-backend && pnpm test` en verde
- [ ] `pnpm build && pnpm test:e2e` en verde (puertos 4000/4173 libres antes de correr)
EOF
)"
```

- [ ] **Step 6: Comentar el issue #13 (resuelto parcialmente por esta etapa)**

```bash
gh issue comment 13 --body "$(cat <<'EOF'
La Etapa 1 del rediseño de sync (#87) resuelve la mitad central de esta issue: el backend nunca
puede rechazar una venta (ni ningún otro evento) de forma síncrona — `/sync/push` solo registra,
nunca valida contenido. Ver `docs/connector-api.openapi.yaml` v2 y CLAUDE.md, sección "Connector
API".

Queda abierta la otra mitad, sin diseñar todavía: la notificación **asíncrona** de una discrepancia
de negocio real (ej. un descuadre de stock detectado del lado del backend después de aceptar la
venta) — eso sigue siendo backlog, a diseñar junto con #12 como ya decía esta issue.
EOF
)"
```

- [ ] **Step 7: Notificar que la Etapa 1 está lista para review**

Avisar al usuario: PR abierto, esperando su revisión antes de arrancar la Etapa 2 (Google Sheets
batch real en `bridge.gs`) — no continuar con la Etapa 2 sin que este PR se mergee primero (mismo
criterio que el epic #66: cada etapa es su propio PR revisado antes de la siguiente).

---
