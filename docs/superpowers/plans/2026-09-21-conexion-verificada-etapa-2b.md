# Conexión verificada — Etapa 2b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una conexión (conector + config) solo pueda activarse después de probarla, que cambiar de origen limpie lo local con una advertencia clara, que la app no opere sin una conexión activa, y que el estado de sync diga la verdad.

**Architecture:** `SyncConfig` suma `verifiedAt`; un módulo puro deriva el estado de la conexión (`unconfigured`/`unverified`/`active`) y `App` bloquea todo salvo `/CONFIG` hasta que esté `active`. Confirmar en `/CONFIG` recorre probar (pull completo en memoria) → planear (origen = endpoint) → confirmar (si se pierden datos del usuario) → aplicar (una transacción Dexie, config guardada al final). `syncOnce` devuelve un reporte y el estado de sync deja de tragar fallos de pull.

**Tech Stack:** TypeScript estricto, Zod 4, Preact + `@preact/signals`, Dexie (con `fake-indexeddb` en tests), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-conexion-verificada-y-comandos-por-conector-design.md` — Parte 1. Issue: #76 (cierra #53), parte del epic #66. La Parte 2 del spec (comandos por conector, #77) tiene su propio plan.

## Desvíos menores respecto del spec

- El código de apply/flush vive en `src/sync/apply-connection.ts` (no todo en `sync/connection.ts`): `connection.ts` queda con probar + origen + planear (puro), y `apply-connection.ts` con el envío final y la aplicación transaccional.
- Los errores del puente de Sheets (`{ ok: false, error }`) pasan a un `ErrorCode` propio `'sync/remote-error'`: sin eso, "Secreto compartido inválido" se mostraría como "No se pudo conectar con el servidor", que es falso.
- El estado de sync guarda el `Failure` crudo (`lastSyncFailureSignal`), no un string: `sync/` nunca importa `ui/errors.ts`; la barra lo traduce con `describeError`.

## Global Constraints

- `any` prohibido; `unknown` solo en la firma de algo externo validado con Zod en la línea siguiente. Nada de `unknown` propagado al dominio.
- Toda función de negocio devuelve `Result<T>`, **nunca lanza**. `try/catch` solo en adaptadores (`localStorage`, `fetch`, Dexie, `new URL`).
- Todo `ErrorCode` nuevo entra en `ErrorMeta` (`src/domain/result.ts`) **y** en el `switch` exhaustivo de `src/ui/errors.ts`.
- Imports con extensión `.ts`/`.tsx`; `verbatimModuleSyntax`; `exactOptionalPropertyTypes` (nunca `undefined` explícito en una prop opcional — spread condicional).
- `sync/` no importa `@preact/signals` directo: llama a los setters de `ui/state/sync.ts` (patrón existente).
- Foco imperativo: nunca el atributo `autoFocus`; `useLayoutEffect` (no `useSignalEffect`, que corre diferido y dejó una ventana de carrera en la Etapa 2).
- La validación del formulario ocurre solo al confirmar (Ctrl+Enter).
- Cada pantalla mantiene `height: 'var(--app-height)'` en su raíz.
- Textos de usuario y comentarios en español, mismo estilo del repo.
- **Cada commit deja `pnpm test`, `pnpm typecheck` y `pnpm lint` en verde**; los e2e se corren en los tasks que los tocan y en el final.
- `pnpm format:check` falla en todo el repo por CRLF (`core.autocrlf`); verificar archivos tocados con `pnpm prettier --check --end-of-line auto <archivos>`, y **no** reformatear archivos que ya venían sin formatear (comparar contra `origin/main` con `git show origin/main:<ruta>`).
- No tocar procesos ajenos: antes de correr e2e, verificar que los puertos 4000 y 4173 estén libres (`netstat -ano | grep -E "[:.]4000 |[:.]4173 "`); Playwright levanta sus propios servidores.
- Commits terminan con: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Rama de trabajo: `claude/conexion-verificada-2b` (ya creada, parte de la Etapa 2). PR contra `main` recién al final, **después** de que la Etapa 2 (#75) esté mergeada o, si no lo está, con base en esa rama.

## Cómo retomar tras una compactación de contexto

El estado real está en `git log` (un commit por task, con el número de task en el mensaje) y en los checkboxes de este plan. Antes de seguir: `git status`, `git log --oneline -15`, correr `pnpm test; pnpm typecheck; pnpm lint` y continuar desde el primer task sin commit.

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/domain/result.ts`, `src/ui/errors.ts` (+ test) | modificar | Códigos `sync/timeout`, `sync/remote-error`, `connection/apply-failed`; traducción de errores de red. |
| `src/connectors/google-sheets/bridge-client.ts` (+ tests) | modificar | Errores del puente → `sync/remote-error`. |
| `src/sync/config.ts` (+ test) | modificar | `verifiedAt` en `SyncConfig`. |
| `src/sync/connection-state.ts` (+ test) | crear | `connectionState(configResult)`. |
| `src/ui/state/sync.ts` | modificar | Señales `connectionState`, `lastSyncFailure`, `localCatalogCounts`. |
| `src/storage/local-data.ts` (+ test) | crear | `summarizeLocalData`, `hasUserData`, `clearAllTables`, `countLocalCatalog`. |
| `src/storage/demo-reset.ts` | modificar | Usa `clearAllTables`. |
| `src/domain/customer.ts` (+ test) | modificar | `splitConnectorCustomers` (versión en lote, compartida). |
| `src/sync/engine.ts` (+ test) | modificar | `SyncReport`, estado honesto (#53), cerrojo exportado, `pushPendingEvents`, gating por `active`. |
| `src/ui/components/StatusBar.tsx` (+ test) | modificar | Motivo del error y conteos locales. |
| `src/sync/connection.ts` (+ test) | crear | `probeConnection`, `withTimeout`, `originKey`, `planConnectionChange`. |
| `src/sync/apply-connection.ts` (+ test) | crear | `flushPendingBeforeWipe`, `applyConnection`. |
| `src/connectors/config-field.ts` y `connectors/*/config.ts` | modificar | `placeholder` por campo. |
| `src/ui/state/sync-config.ts`, `src/ui/keyboard/config-controller.ts`, `src/ui/screens/config-screen.tsx` (+ tests) | reescribir | Formulario con fases, sin defaults, modo requerido. |
| `src/ui/app.tsx`, `src/ui/bootstrap.ts` (+ tests) | modificar | Bloqueo de arranque. |
| `e2e/fixtures.ts` + specs | crear/modificar | Config activa sembrada; specs nuevos del ciclo de vida. |
| `CLAUDE.md` | modificar | Documentación. |

---

### Task 1: Errores de red legibles y códigos nuevos

**Files:**
- Modify: `src/domain/result.ts`, `src/ui/errors.ts`, `src/ui/errors.test.ts`
- Modify: `src/connectors/google-sheets/bridge-client.ts`, `src/connectors/google-sheets/bridge-client.test.ts`, `src/connectors/google-sheets/google-sheets-connector.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `ErrorCode`s `'sync/timeout': { seconds: number }`, `'sync/remote-error': { message: string }`, `'connection/apply-failed': { message: string }`; `describeError` con los mensajes de la tabla de abajo.

| Origen | Mensaje |
|---|---|
| `sync/request-failed` sin `status` | `No se pudo conectar con el servidor (<message>). ¿Está en línea y corriendo?` |
| `sync/request-failed` 401/403 | `El servidor rechazó las credenciales (<status>).` |
| `sync/request-failed` 404 | `El servidor no encontró el recurso (404). ¿La URL es correcta?` |
| `sync/request-failed` otro status | `El servidor respondió con un error (<status>).` |
| `sync/timeout` | `El servidor no respondió en <seconds> segundos.` |
| `sync/remote-error` | `El sistema externo respondió con un error: <message>` |
| `connection/apply-failed` | `No se pudo aplicar la conexión (<message>).` |
| `demo/backend-reset-failed` | `No se pudo reiniciar el minibackend de demo (<message>). ¿Está corriendo?` |

- [ ] **Step 1: Tests que fallan en `src/ui/errors.test.ts`**

Agregar dentro del `describe('describeError', …)`:

```ts
  it('sync/request-failed sin status es un problema de conectividad', () => {
    const message = describeError({
      ok: false,
      error: 'sync/request-failed',
      meta: { message: 'Failed to fetch' },
    });

    expect(message).toBe(
      'No se pudo conectar con el servidor (Failed to fetch). ¿Está en línea y corriendo?',
    );
  });

  it.each([401, 403])('sync/request-failed con %i: rechazó las credenciales', (status) => {
    const message = describeError({
      ok: false,
      error: 'sync/request-failed',
      meta: { status, message: 'x' },
    });

    expect(message).toBe(`El servidor rechazó las credenciales (${String(status)}).`);
  });

  it('sync/request-failed con 404 sugiere revisar la URL', () => {
    const message = describeError({
      ok: false,
      error: 'sync/request-failed',
      meta: { status: 404, message: 'x' },
    });

    expect(message).toBe('El servidor no encontró el recurso (404). ¿La URL es correcta?');
  });

  it('sync/request-failed con otro status', () => {
    const message = describeError({
      ok: false,
      error: 'sync/request-failed',
      meta: { status: 500, message: 'x' },
    });

    expect(message).toBe('El servidor respondió con un error (500).');
  });

  it('sync/timeout', () => {
    expect(describeError({ ok: false, error: 'sync/timeout', meta: { seconds: 20 } })).toBe(
      'El servidor no respondió en 20 segundos.',
    );
  });

  it('sync/remote-error', () => {
    expect(
      describeError({
        ok: false,
        error: 'sync/remote-error',
        meta: { message: 'Secreto compartido inválido' },
      }),
    ).toBe('El sistema externo respondió con un error: Secreto compartido inválido');
  });

  it('connection/apply-failed', () => {
    expect(
      describeError({ ok: false, error: 'connection/apply-failed', meta: { message: 'boom' } }),
    ).toBe('No se pudo aplicar la conexión (boom).');
  });

  it('demo/backend-reset-failed sugiere revisar que el backend esté corriendo', () => {
    expect(
      describeError({
        ok: false,
        error: 'demo/backend-reset-failed',
        meta: { message: 'Failed to fetch' },
      }),
    ).toBe('No se pudo reiniciar el minibackend de demo (Failed to fetch). ¿Está corriendo?');
  });
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm vitest run src/ui/errors.test.ts`
Expected: FAIL (mensajes distintos y códigos inexistentes).

- [ ] **Step 3: Implementación**

En `src/domain/result.ts`, dentro de `ErrorMeta`, junto a los códigos `sync/…`:

```ts
  'sync/timeout': { seconds: number };
  'sync/remote-error': { message: string };
  // sync/apply-connection.ts
  'connection/apply-failed': { message: string };
```

En `src/ui/errors.ts`, reemplazar el `case 'sync/request-failed'` y agregar los nuevos antes del `default`:

```ts
    case 'sync/request-failed': {
      const { status, message } = failure.meta;
      if (status === undefined) {
        return `No se pudo conectar con el servidor (${message}). ¿Está en línea y corriendo?`;
      }
      if (status === 401 || status === 403) {
        return `El servidor rechazó las credenciales (${String(status)}).`;
      }
      if (status === 404) {
        return 'El servidor no encontró el recurso (404). ¿La URL es correcta?';
      }
      return `El servidor respondió con un error (${String(status)}).`;
    }
    case 'sync/timeout':
      return `El servidor no respondió en ${String(failure.meta.seconds)} segundos.`;
    case 'sync/remote-error':
      return `El sistema externo respondió con un error: ${failure.meta.message}`;
    case 'connection/apply-failed':
      return `No se pudo aplicar la conexión (${failure.meta.message}).`;
```

y cambiar el `case 'demo/backend-reset-failed'` a:

```ts
    case 'demo/backend-reset-failed':
      return `No se pudo reiniciar el minibackend de demo (${failure.meta.message}). ¿Está corriendo?`;
```

- [ ] **Step 4: Errores del puente de Sheets → `sync/remote-error`**

En `src/connectors/google-sheets/bridge-client.ts`, la línea `return err('sync/request-failed', { message: envelope.data.error });` pasa a:

```ts
    return err('sync/remote-error', { message: envelope.data.error });
```

Actualizar tests: en `bridge-client.test.ts`, el test `'mapea { ok: false, error } del puente a sync/request-failed con el mensaje'` pasa a llamarse `'mapea { ok: false, error } del puente a sync/remote-error con el mensaje'` y espera `expect(result.error).toBe('sync/remote-error');`. En `google-sheets-connector.test.ts`, los dos tests que verifican el error del puente (`'propaga el error del puente'` en `pullProducts` y `'un push propaga el error del puente como sync/request-failed'`) esperan ahora `'sync/remote-error'` (el `meta` sigue siendo `{ message: … }`); renombrar el segundo a `'… como sync/remote-error'`. Los tests de red caída y de HTTP no ok siguen esperando `sync/request-failed`.

- [ ] **Step 5: Verificar y commitear**

Run: `pnpm test; pnpm typecheck; pnpm lint`
Expected: todo verde (el `switch` exhaustivo de `errors.ts` obliga a que no falte ningún código).

```bash
git add -A src
git commit -m "feat: errores de red legibles y códigos sync/timeout, sync/remote-error, connection/apply-failed (#76)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `verifiedAt`, estado de la conexión y señales de sync

**Files:**
- Modify: `src/sync/config.ts`, `src/sync/config.test.ts`, `src/ui/state/sync.ts`
- Create: `src/sync/connection-state.ts`, `src/sync/connection-state.test.ts`

**Interfaces:**
- Consumes: `SyncConfig`, `Result` (`domain/result.ts`).
- Produces:
  - `SyncConfig` con `verifiedAt?: string` (fecha ISO de la última prueba exitosa).
  - `type ConnectionState = 'unconfigured' | 'unverified' | 'active'` y `connectionState(config: Result<SyncConfig>): ConnectionState`.
  - En `ui/state/sync.ts`: `connectionStateSignal` + `setConnectionState(state)`; `lastSyncFailureSignal: Signal<Failure | null>` + `setLastSyncFailure(failure)`; `type LocalCatalogCounts = { products: number; customers: number }`, `localCatalogCountsSignal: Signal<LocalCatalogCounts | null>` + `setLocalCatalogCounts(counts)`.

- [ ] **Step 1: Tests que fallan**

`src/sync/connection-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { err, ok } from '../domain/result.ts';
import { connectionState } from './connection-state.ts';

describe('connectionState', () => {
  it('sin config guardada: unconfigured', () => {
    expect(connectionState(err('sync/config-missing', undefined))).toBe('unconfigured');
  });

  it('config inválida: unconfigured', () => {
    expect(connectionState(err('sync/config-invalid', { issues: [] }))).toBe('unconfigured');
  });

  it('config sin verifiedAt (incluye las guardadas antes de la Etapa 2b): unverified', () => {
    expect(connectionState(ok({ type: 'rest', baseUrl: 'https://api.example.com' }))).toBe(
      'unverified',
    );
  });

  it('config con verifiedAt: active', () => {
    expect(
      connectionState(
        ok({
          type: 'rest',
          baseUrl: 'https://api.example.com',
          verifiedAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
    ).toBe('active');
  });
});
```

Agregar a `src/sync/config.test.ts`, dentro del primer `describe`:

```ts
  it('guarda y relee verifiedAt', () => {
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: {
        type: 'rest',
        baseUrl: 'https://api.example.com',
        verifiedAt: '2026-01-01T00:00:00.000Z',
      },
    });
  });
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm vitest run src/sync/connection-state.test.ts src/sync/config.test.ts`
Expected: FAIL (módulo inexistente; `verifiedAt` se descarta al parsear).

- [ ] **Step 3: Implementación**

En `src/sync/config.ts`, en `syncConfigSchema`, cambiar el objeto de `locale` para sumar `verifiedAt`, con su comentario:

```ts
export const syncConfigSchema = z.preprocess(
  withLegacyType,
  connectorConfigSchema.and(
    z.object({
      locale: z.string().optional(),
      // Fecha ISO de la última prueba de conexión exitosa (Etapa 2b, #76). La
      // escribe únicamente `sync/apply-connection.ts::applyConnection`; una
      // config sin este campo (incluidas las guardadas antes de 2b) es
      // "sin probar" y la app pide probarla antes de operar.
      verifiedAt: z.string().optional(),
    }),
  ),
);
```

`src/sync/connection-state.ts`:

```ts
import type { Result } from '../domain/result.ts';
import type { SyncConfig } from './config.ts';

/**
 * Estado de la conexión de esta terminal (Etapa 2b, #76):
 * - `unconfigured`: no hay config guardada (o está inválida).
 * - `unverified`: hay config pero sin una prueba exitosa registrada.
 * - `active`: hay config con `verifiedAt` — la app puede operar.
 * Depende solo de lo guardado, nunca de la conectividad: una terminal `active`
 * opera offline como siempre.
 */
export type ConnectionState = 'unconfigured' | 'unverified' | 'active';

export function connectionState(config: Result<SyncConfig>): ConnectionState {
  if (!config.ok) {
    return 'unconfigured';
  }
  return config.value.verifiedAt !== undefined ? 'active' : 'unverified';
}
```

En `src/ui/state/sync.ts`, agregar los imports arriba y las señales al final:

```ts
import type { Failure } from '../../domain/result.ts';
import type { ConnectionState } from '../../sync/connection-state.ts';
```

```ts
/** Estado de la conexión (Etapa 2b): `App` bloquea todo salvo `/CONFIG` mientras no sea `active`. */
export const connectionStateSignal = signal<ConnectionState>('unconfigured');

export function setConnectionState(state: ConnectionState): void {
  connectionStateSignal.value = state;
}

/**
 * Motivo del último fallo de sync (un pull que falló), tal cual — la barra de
 * estado lo traduce con `describeError`: `sync/` no importa `ui/errors.ts`.
 */
export const lastSyncFailureSignal = signal<Failure | null>(null);

export function setLastSyncFailure(failure: Failure | null): void {
  lastSyncFailureSignal.value = failure;
}

/** Lo que hay en la base local (contado, no lo que trajo el último pull — un delta trae solo cambios). */
export type LocalCatalogCounts = { products: number; customers: number };

export const localCatalogCountsSignal = signal<LocalCatalogCounts | null>(null);

export function setLocalCatalogCounts(counts: LocalCatalogCounts | null): void {
  localCatalogCountsSignal.value = counts;
}
```

- [ ] **Step 4: Verificar y commitear**

Run: `pnpm test; pnpm typecheck; pnpm lint`
Expected: verde.

```bash
git add -A src
git commit -m "feat: verifiedAt, estado de la conexión y señales de sync (#76)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Datos locales — resumen, limpieza y `demoReset`

**Files:**
- Create: `src/storage/local-data.ts`, `src/storage/local-data.test.ts`
- Modify: `src/storage/demo-reset.ts`

**Interfaces:**
- Consumes: `db` (`storage/db.ts`).
- Produces:
  - `type LocalDataSummary = { products: number; customers: number; sales: number; cashSessions: number; pendingOutbox: number; pendingSales: number; draftCartLines: number }`
  - `hasUserData(summary): boolean` — `sales`, `cashSessions`, `pendingOutbox` o `draftCartLines` > 0 (un catálogo o clientes solos no son "datos del usuario").
  - `summarizeLocalData(): Promise<LocalDataSummary>`, `countLocalCatalog(): Promise<{ products: number; customers: number }>`
  - `clearAllTables(): Promise<void[]>` — limpia **todas** las tablas (`db.tables`, así una tabla futura queda incluida sola); tiene que llamarse dentro de una transacción Dexie.

- [ ] **Step 1: Test que falla**

`src/storage/local-data.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildOutboxEventForSale, markSynced } from '../domain/outbox.ts';
import type { Sale } from '../domain/sale.ts';
import { db } from './db.ts';
import {
  clearAllTables,
  countLocalCatalog,
  hasUserData,
  summarizeLocalData,
  type LocalDataSummary,
} from './local-data.ts';

const now = '2026-01-01T00:00:00.000Z';

const product = {
  id: 'p1',
  sku: 'S1',
  barcodes: [],
  name: 'Arroz',
  price: 100,
  taxRate: 0.21,
  category: 'x',
  tracksStock: false,
};

function makeSale(id: string): Sale {
  return { id, lines: [], payments: [], total: 0, status: 'closed', createdAt: now };
}

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

async function seedEverything(): Promise<void> {
  await db.products.put(product);
  await db.customers.put({ id: 'c1', name: 'Ana', createdAt: now });
  await db.sales.bulkPut([makeSale('s1'), makeSale('s2')]);
  await db.cashSessions.put({ id: 'cs1', openedAt: now, openingAmount: 0, sales: [] });
  await db.outbox.put(buildOutboxEventForSale(makeSale('s1'), { now }));
  await db.outbox.put(markSynced(buildOutboxEventForSale(makeSale('s2'), { now })));
  await db.draftCart.put({
    id: 'current',
    cart: {
      lines: [
        { kind: 'freeform', description: 'a', qty: 1, unitPrice: 1 },
        { kind: 'freeform', description: 'b', qty: 1, unitPrice: 2 },
      ],
    },
  });
}

describe('summarizeLocalData', () => {
  it('terminal vacía: todo en cero y sin datos del usuario', async () => {
    const summary = await summarizeLocalData();

    expect(summary).toEqual({
      products: 0,
      customers: 0,
      sales: 0,
      cashSessions: 0,
      pendingOutbox: 0,
      pendingSales: 0,
      draftCartLines: 0,
    });
    expect(hasUserData(summary)).toBe(false);
  });

  it('cuenta lo que hay, distinguiendo pendientes de sincronizados', async () => {
    await seedEverything();

    expect(await summarizeLocalData()).toEqual({
      products: 1,
      customers: 1,
      sales: 2,
      cashSessions: 1,
      pendingOutbox: 1,
      pendingSales: 1,
      draftCartLines: 2,
    });
  });
});

describe('hasUserData', () => {
  const empty: LocalDataSummary = {
    products: 10,
    customers: 10,
    sales: 0,
    cashSessions: 0,
    pendingOutbox: 0,
    pendingSales: 0,
    draftCartLines: 0,
  };

  it('un catálogo y clientes solos no son datos del usuario', () => {
    expect(hasUserData(empty)).toBe(false);
  });

  it.each(['sales', 'cashSessions', 'pendingOutbox', 'draftCartLines'] as const)(
    '%s > 0 sí lo son',
    (field) => {
      expect(hasUserData({ ...empty, [field]: 1 })).toBe(true);
    },
  );
});

describe('countLocalCatalog', () => {
  it('cuenta productos y clientes', async () => {
    await seedEverything();

    expect(await countLocalCatalog()).toEqual({ products: 1, customers: 1 });
  });
});

describe('clearAllTables', () => {
  it('deja vacías todas las tablas de la base', async () => {
    await seedEverything();

    await db.transaction('rw', db.tables, clearAllTables);

    for (const table of db.tables) {
      await expect(table.count()).resolves.toBe(0);
    }
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run src/storage/local-data.test.ts`
Expected: FAIL (módulo inexistente). Si `buildOutboxEventForSale`/`markSynced` no aceptan esos argumentos, ajustar el sembrado a las firmas reales de `domain/outbox.ts` (`buildOutboxEventForSale(sale, { now })`, `markSynced(event)`).

- [ ] **Step 3: Implementación**

`src/storage/local-data.ts`:

```ts
import { db } from './db.ts';

/**
 * Lo que hay en la base local de esta terminal — lo que se perdería al cambiar
 * de conexión (Etapa 2b, #76). `pendingOutbox`/`pendingSales` son eventos que
 * todavía no llegaron al backend actual.
 */
export type LocalDataSummary = {
  products: number;
  customers: number;
  sales: number;
  cashSessions: number;
  pendingOutbox: number;
  pendingSales: number;
  draftCartLines: number;
};

/**
 * "Datos del usuario": lo que se generó en esta terminal y no se puede
 * reconstruir con un pull. Un catálogo o clientes solos se reemplazan sin
 * preguntar; esto sí exige confirmación antes de borrarse.
 */
export function hasUserData(summary: LocalDataSummary): boolean {
  return (
    summary.sales > 0 ||
    summary.cashSessions > 0 ||
    summary.pendingOutbox > 0 ||
    summary.draftCartLines > 0
  );
}

export async function countLocalCatalog(): Promise<{ products: number; customers: number }> {
  const [products, customers] = await Promise.all([db.products.count(), db.customers.count()]);
  return { products, customers };
}

export async function summarizeLocalData(): Promise<LocalDataSummary> {
  const [catalog, sales, cashSessions, pending, draft] = await Promise.all([
    countLocalCatalog(),
    db.sales.count(),
    db.cashSessions.count(),
    db.outbox.where('status').equals('pending').toArray(),
    db.draftCart.get('current'),
  ]);
  return {
    ...catalog,
    sales,
    cashSessions,
    pendingOutbox: pending.length,
    pendingSales: pending.filter((event) => event.type === 'sale').length,
    draftCartLines: draft?.cart.lines.length ?? 0,
  };
}

/**
 * Limpia **todas** las tablas — `db.tables`, no una lista escrita a mano, así
 * una tabla futura queda incluida sin acordarse. Tiene que correr dentro de
 * `db.transaction('rw', db.tables, …)`; lo usan `demoReset` y
 * `sync/apply-connection.ts`.
 */
export function clearAllTables(): Promise<void[]> {
  return Promise.all(db.tables.map((table) => table.clear()));
}
```

En `src/storage/demo-reset.ts`, agregar `import { clearAllTables } from './local-data.ts';` y reemplazar todo el `await db.transaction('rw', [ … ], async () => { await Promise.all([ … ]); });` (dentro del `try`) por:

```ts
    await db.transaction('rw', db.tables, clearAllTables);
```

(el `try/catch` que devuelve `demo/reset-failed` queda igual).

- [ ] **Step 4: Verificar y commitear**

Run: `pnpm vitest run src/storage/local-data.test.ts src/storage/demo-reset.test.ts; pnpm test; pnpm typecheck; pnpm lint`
Expected: verde (los tests de `demoReset` son la red de seguridad del refactor).

```bash
git add -A src
git commit -m "feat: resumen y limpieza de datos locales, demoReset usa clearAllTables (#76)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Estado de sync honesto (#53), cerrojo exportado y bloqueo por conexión activa

**Files:**
- Modify: `src/domain/customer.ts`, `src/domain/customer.test.ts`
- Modify: `src/sync/engine.ts`, `src/sync/engine.test.ts`

**Interfaces:**
- Consumes: `countLocalCatalog` (Task 3); `setLastSyncFailure`, `setLocalCatalogCounts` (Task 2); `SyncConfig.verifiedAt` (Task 2).
- Produces:
  - `splitConnectorCustomers(raws, { now }): { customers: Customer[]; accounts: CustomerAccount[] }` (`domain/customer.ts`).
  - `type PushSummary = { attempted: number; failed: number }`, `type SyncReport = { push: PushSummary; pulls: { products: Result<void>; stock: Result<void>; customers: Result<void> } }`.
  - `syncOnce(connector, now): Promise<SyncReport>`.
  - `pushPendingEvents(connector, now, options?: { ignoreBackoff?: boolean }): Promise<PushSummary>`.
  - `tryAcquireSyncLock(): (() => void) | undefined` y `acquireSyncLockWaiting(waitMs: number): Promise<(() => void) | undefined>` (el valor es la función que libera el cerrojo).
  - `runSyncCycle` no corre con una config sin `verifiedAt`.

- [ ] **Step 1: `splitConnectorCustomers` (test primero)**

Agregar a `src/domain/customer.test.ts` (importando `splitConnectorCustomers` junto a lo que ya se importa de `./customer.ts`):

```ts
describe('splitConnectorCustomers', () => {
  it('separa cada fila en Customer y, si trae los tres campos de crédito, CustomerAccount', () => {
    const { customers, accounts } = splitConnectorCustomers(
      [
        { id: 'c1', name: 'Ana' },
        { id: 'c2', name: 'Beto', creditLimit: 100, margin: 10, balance: 5 },
      ],
      { now: '2026-01-01T00:00:00.000Z' },
    );

    expect(customers.map((customer) => customer.id)).toEqual(['c1', 'c2']);
    expect(accounts.map((account) => account.customerId)).toEqual(['c2']);
  });
});
```

Run: `pnpm vitest run src/domain/customer.test.ts` → FAIL. Luego, en `src/domain/customer.ts`, debajo de `splitConnectorCustomer`:

```ts
/**
 * Versión en lote de `splitConnectorCustomer`: la usan el pull del motor de
 * sync y la aplicación de una conexión nueva (`sync/apply-connection.ts`), así
 * la transformación vive en un solo lugar.
 */
export function splitConnectorCustomers(
  raws: Parameters<typeof splitConnectorCustomer>[0][],
  params: { now: string },
): { customers: Customer[]; accounts: CustomerAccount[] } {
  const customers: Customer[] = [];
  const accounts: CustomerAccount[] = [];
  for (const raw of raws) {
    const split = splitConnectorCustomer(raw, params);
    customers.push(split.customer);
    if (split.account !== undefined) {
      accounts.push(split.account);
    }
  }
  return { customers, accounts };
}
```

Run: `pnpm vitest run src/domain/customer.test.ts` → PASS.

- [ ] **Step 2: Tests del motor (fallan)**

En `src/sync/engine.test.ts`:

a) Imports nuevos: `lastSyncFailureSignal`, `lastSyncedAtSignal`, `localCatalogCountsSignal` desde `'../ui/state/sync.ts'`; `pushPendingEvents`, `tryAcquireSyncLock`, `acquireSyncLockWaiting` desde `'./engine.ts'`.

b) Sembrar `verifiedAt` en las configs de los tests de `runSyncCycle` que esperan que el ciclo corra:

```bash
sed -i "s#saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });#saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', verifiedAt: '2026-01-01T00:00:00.000Z' });#; s#saveSyncConfig({ type: 'google-sheets', webAppUrl });#saveSyncConfig({ type: 'google-sheets', webAppUrl, verifiedAt: '2026-01-01T00:00:00.000Z' });#" src/sync/engine.test.ts
```

c) Reemplazar el test `'no rompe el ciclo si el pull falla'` por:

```ts
  it('si un pull falla: no rompe el ciclo, pasa a sync-error, guarda el motivo y no marca la sync como exitosa', async () => {
    lastSyncedAtSignal.value = null;
    const failure = err('sync/request-failed', { status: 401, message: 'x' });
    const pullProducts = vi.fn<Connector['pullProducts']>().mockResolvedValue(failure);

    const report = await syncOnce(fakeConnector({ pullProducts }), now);

    expect(report.pulls.products.ok).toBe(false);
    expect(syncStatusSignal.value).toBe('sync-error');
    expect(lastSyncFailureSignal.value).toEqual(failure);
    expect(lastSyncedAtSignal.value).toBeNull();
  });

  it.each([
    ['stock', { pullStock: () => Promise.resolve(err('sync/request-failed', { message: 'down' })) }],
    [
      'clientes',
      { pullCustomers: () => Promise.resolve(err('sync/request-failed', { message: 'down' })) },
    ],
  ] as const)('un pull de %s fallido también es sync-error', async (_name, overrides) => {
    await syncOnce(fakeConnector(overrides), now);

    expect(syncStatusSignal.value).toBe('sync-error');
    expect(lastSyncFailureSignal.value).not.toBeNull();
  });

  it('tras un ciclo exitoso limpia el motivo del fallo y guarda lo que hay en la base local', async () => {
    await db.products.put({
      id: 'p1',
      sku: 'S1',
      barcodes: [],
      name: 'Arroz',
      price: 100,
      taxRate: 0.21,
      category: 'x',
      tracksStock: false,
    });
    await syncOnce(
      fakeConnector({
        pullProducts: () => Promise.resolve(err('sync/request-failed', { message: 'down' })),
      }),
      now,
    );
    expect(lastSyncFailureSignal.value).not.toBeNull();

    const report = await syncOnce(fakeConnector(), now);

    expect(report.pulls.products.ok).toBe(true);
    expect(lastSyncFailureSignal.value).toBeNull();
    expect(localCatalogCountsSignal.value).toEqual({ products: 1, customers: 0 });
    expect(lastSyncedAtSignal.value).toBe(now);
  });
```

d) En `describe('runSyncCycle', …)`:

```ts
  it('con una config sin verifiedAt (sin probar) no corre el ciclo ni llama a fetch', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runSyncCycle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncConfiguredSignal.value).toBe(false);
  });
```

e) Al final del archivo:

```ts
describe('pushPendingEvents', () => {
  it('con ignoreBackoff empuja también los eventos cuyo nextAttemptAt todavía no llegó', async () => {
    await db.outbox.add({
      type: 'sale',
      sale,
      id: 'sale-1',
      status: 'pending',
      retries: 1,
      createdAt: now,
      nextAttemptAt: '2026-01-01T01:00:00.000Z', // futuro
    });
    const pushSale = vi.fn().mockResolvedValue(ok(undefined));

    const withoutFlag = await pushPendingEvents(fakeConnector({ pushSale }), now);
    expect(withoutFlag).toEqual({ attempted: 0, failed: 0 });

    const withFlag = await pushPendingEvents(fakeConnector({ pushSale }), now, {
      ignoreBackoff: true,
    });
    expect(withFlag).toEqual({ attempted: 1, failed: 0 });
    expect(pushSale).toHaveBeenCalledTimes(1);
  });

  it('cuenta los fallos', async () => {
    await db.outbox.add({
      type: 'sale',
      sale,
      id: 'sale-1',
      status: 'pending',
      retries: 0,
      createdAt: now,
      nextAttemptAt: now,
    });

    const summary = await pushPendingEvents(
      fakeConnector({
        pushSale: () => Promise.resolve(err('sync/request-failed', { message: 'x' })),
      }),
      now,
    );

    expect(summary).toEqual({ attempted: 1, failed: 1 });
  });
});

describe('cerrojo de sync', () => {
  it('tryAcquireSyncLock devuelve undefined si ya está tomado y se puede volver a tomar tras liberar', () => {
    const release = tryAcquireSyncLock();
    expect(release).not.toBeUndefined();
    expect(tryAcquireSyncLock()).toBeUndefined();

    release?.();

    const again = tryAcquireSyncLock();
    expect(again).not.toBeUndefined();
    again?.();
  });

  it('acquireSyncLockWaiting espera a que se libere', async () => {
    const release = tryAcquireSyncLock();
    setTimeout(() => release?.(), 30);

    const acquired = await acquireSyncLockWaiting(1000);

    expect(acquired).not.toBeUndefined();
    acquired?.();
  });

  it('acquireSyncLockWaiting devuelve undefined si vence la espera', async () => {
    const release = tryAcquireSyncLock();

    const acquired = await acquireSyncLockWaiting(60);

    expect(acquired).toBeUndefined();
    release?.();
  });
});
```

Run: `pnpm vitest run src/sync/engine.test.ts` → FAIL (símbolos inexistentes y comportamientos nuevos).

- [ ] **Step 3: Implementación en `src/sync/engine.ts`**

Imports: cambiar `import { splitConnectorCustomer } from '../domain/customer.ts';` por `import { splitConnectorCustomers } from '../domain/customer.ts';`; `import type { Result } from '../domain/result.ts';` por `import { ok, type Failure, type Result } from '../domain/result.ts';`; agregar `import { countLocalCatalog } from '../storage/local-data.ts';`; y sumar `setLastSyncFailure`, `setLocalCatalogCounts` al import de `'../ui/state/sync.ts'`.

Reemplazar todo desde `async function pushPending` hasta el cierre de `runSyncCycle` (justo antes de `const SYNC_INTERVAL_MS`) por:

```ts
export type PushSummary = { attempted: number; failed: number };

/**
 * Empuja el outbox pendiente en orden. `ignoreBackoff` saltea la ventana de
 * reintento (`isDue`): lo usa el envío final antes de borrar los datos al
 * cambiar de conexión (`sync/apply-connection.ts::flushPendingBeforeWipe`);
 * `now` sigue siendo la hora real, así un fallo calcula bien su próximo intento.
 */
export async function pushPendingEvents(
  connector: Connector,
  now: string,
  options: { ignoreBackoff?: boolean } = {},
): Promise<PushSummary> {
  const pending = await db.outbox.where('status').equals('pending').sortBy('createdAt');
  let attempted = 0;
  let failed = 0;

  for (const event of pending) {
    if (options.ignoreBackoff !== true && !isDue(event, now)) {
      continue;
    }
    attempted += 1;
    const result = await pushOne(connector, event);
    if (!result.ok) {
      failed += 1;
    }
    await db.outbox.put(
      result.ok ? markSynced(event) : markFailed(event, { now, error: result.error }),
    );
  }
  return { attempted, failed };
}

async function pullCatalog(
  connector: Connector,
): Promise<{ products: Result<void>; stock: Result<void> }> {
  const since = getProductsCursor();
  const productsResult = await connector.pullProducts(since !== undefined ? { since } : {});
  let products: Result<void>;
  if (productsResult.ok) {
    if (productsResult.value.items.length > 0) {
      await db.products.bulkPut(productsResult.value.items);
    }
    if (productsResult.value.nextCursor !== undefined) {
      setProductsCursor(productsResult.value.nextCursor);
    }
    // El catálogo pudo haber cambiado — Fase 1 lo indexaba una sola vez
    // asumiéndolo estático, acá se reconstruye a propósito.
    setCatalogRepository(await loadCatalogRepository());
    products = ok(undefined);
  } else {
    products = productsResult;
  }

  const stockResult = await connector.pullStock();
  let stock: Result<void>;
  if (stockResult.ok) {
    if (stockResult.value.length > 0) {
      await db.stock.bulkPut(stockResult.value);
    }
    stock = ok(undefined);
  } else {
    stock = stockResult;
  }
  return { products, stock };
}

/**
 * Pull de clientes por delta, mismo criterio que `pullCatalog`: cada fila
 * cruda se separa en `Customer`/`CustomerAccount` (`splitConnectorCustomers`)
 * antes de guardarse, así las dos tablas quedan siempre consistentes entre
 * sí incluso si un cliente todavía no tiene cuenta corriente.
 */
async function pullCustomers(connector: Connector): Promise<Result<void>> {
  const since = getCustomersCursor();
  const result = await connector.pullCustomers(since !== undefined ? { since } : {});
  if (!result.ok) {
    return result;
  }

  if (result.value.items.length > 0) {
    const { customers, accounts } = splitConnectorCustomers(result.value.items, {
      now: new Date().toISOString(),
    });
    await db.customers.bulkPut(customers);
    if (accounts.length > 0) {
      await db.customerAccounts.bulkPut(accounts);
    }
    setCustomerRepository(await loadCustomerRepository());
  }
  if (result.value.nextCursor !== undefined) {
    setCustomersCursor(result.value.nextCursor);
  }
  return ok(undefined);
}

export type SyncReport = {
  push: PushSummary;
  pulls: { products: Result<void>; stock: Result<void>; customers: Result<void> };
};

/**
 * Un ciclo de sync: push del outbox pendiente + pull de catálogo. Nunca
 * bloquea la UI — el caller (`runSyncCycle`) lo dispara en background.
 * No conoce config ni arma el `Connector`: eso es responsabilidad del
 * caller, así esta función se testea directo contra un `Connector` fake.
 *
 * Estado honesto (#53): un pull que falla ya no se traga en silencio — el
 * estado pasa a `sync-error`, el motivo queda en `lastSyncFailureSignal` y
 * `lastSyncedAt` solo se actualiza en un ciclo completamente exitoso.
 */
export async function syncOnce(connector: Connector, now: string): Promise<SyncReport> {
  setSyncStatus('syncing');

  const push = await pushPendingEvents(connector, now);
  const catalog = await pullCatalog(connector);
  const customers = await pullCustomers(connector);
  const report: SyncReport = {
    push,
    pulls: { products: catalog.products, stock: catalog.stock, customers },
  };

  const events = await db.outbox.toArray();
  const pendingCount = events.filter((event) => event.status === 'pending').length;
  setPendingOutboxCount(pendingCount);
  setLocalCatalogCounts(await countLocalCatalog());

  const firstFailure = [catalog.products, catalog.stock, customers].find(
    (result): result is Failure => !result.ok,
  );
  if (firstFailure !== undefined) {
    setLastSyncFailure(firstFailure);
    setSyncStatus('sync-error');
    return report;
  }
  setLastSyncFailure(null);

  if (isSyncStruggling(events)) {
    setSyncStatus('sync-error');
    return report;
  }
  setSyncStatus('online-idle');
  setLastSyncedAt(now);
  return report;
}

/**
 * Es responsabilidad de la app no saturar a la API: si un push tarda más
 * que el intervalo del loop (una API lenta de verdad), el próximo disparo
 * (`setInterval`, evento `online`, o `/SINCRONIZAR`) no debe arrancar un
 * segundo ciclo en paralelo — ver issue #1. La bandera se lee/escribe de
 * forma síncrona (`tryAcquireSyncLock`, primera línea de `runSyncCycle`),
 * antes de cualquier `await`, así una llamada reentrante la ve actualizada
 * sin importar en qué punto del ciclo anterior ocurra. Desde la Etapa 2b es
 * también el cerrojo de `sync/apply-connection.ts`: aplicar una conexión no
 * puede intercalarse con un ciclo.
 */
let syncInProgress = false;

/** Toma el cerrojo sin esperar; devuelve la función que lo libera, o `undefined` si ya está tomado. */
export function tryAcquireSyncLock(): (() => void) | undefined {
  if (syncInProgress) {
    return undefined;
  }
  syncInProgress = true;
  return () => {
    syncInProgress = false;
  };
}

/** Como `tryAcquireSyncLock`, pero espera hasta `waitMs` a que se libere. */
export async function acquireSyncLockWaiting(
  waitMs: number,
): Promise<(() => void) | undefined> {
  const deadline = Date.now() + waitMs;
  let release = tryAcquireSyncLock();
  while (release === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    release = tryAcquireSyncLock();
  }
  return release;
}

/**
 * Arma el `Connector` real desde la config guardada y corre un ciclo. Acá
 * viven los chequeos de entorno (¿hay red? ¿hay una conexión activa?) que
 * `syncOnce` no conoce a propósito — así queda testeable de forma aislada.
 * Una config sin probar (`verifiedAt` ausente) no sincroniza: la app pide
 * probarla antes de operar (Etapa 2b).
 */
export async function runSyncCycle(): Promise<void> {
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
    await syncOnce(connector, new Date().toISOString());
  } finally {
    release();
  }
}
```

- [ ] **Step 4: Verificar y commitear**

Run: `pnpm vitest run src/sync/engine.test.ts; pnpm test; pnpm typecheck; pnpm lint`
Expected: verde. Si algún test de `syncOnce — pull de clientes` asumía `online-idle` con un pull fallido, ajustarlo al nuevo comportamiento (`sync-error`): es justo el bug #53.

```bash
git add -A src
git commit -m "feat: estado de sync honesto, cerrojo exportado y bloqueo por conexión activa (#76, #53)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Barra de estado — motivo del error y contenido local

**Files:**
- Modify: `src/ui/components/StatusBar.tsx`, `src/ui/components/StatusBar.test.tsx`

**Interfaces:**
- Consumes: `lastSyncFailureSignal`, `localCatalogCountsSignal` (Task 2); `describeError` (Task 1).
- Produces: en `sync-error`, `Problema de sincronización: <mensaje> · última sync OK <hora>` (cada parte solo si existe); en `online-idle`, `Sincronizado (<hora>) · <n> productos · <m> clientes` (los conteos solo si se conocen).

- [ ] **Step 1: Tests que fallan**

En `src/ui/components/StatusBar.test.tsx`: sumar `lastSyncFailureSignal` y `localCatalogCountsSignal` al import de `'../state/sync.ts'`, resetearlos en el `beforeEach` (`lastSyncFailureSignal.value = null; localCatalogCountsSignal.value = null;`) y agregar:

```ts
  it('en sync-error muestra el motivo traducido', () => {
    syncStatusSignal.value = 'sync-error';
    lastSyncFailureSignal.value = {
      ok: false,
      error: 'sync/request-failed',
      meta: { status: 401, message: 'x' },
    };

    render(<StatusBar />);

    expect(
      screen.getByText('Problema de sincronización: El servidor rechazó las credenciales (401).'),
    ).not.toBeNull();
  });

  it('en sync-error muestra también la hora de la última sync exitosa', () => {
    syncStatusSignal.value = 'sync-error';
    lastSyncedAtSignal.value = '2026-01-01T00:00:00.000Z';

    render(<StatusBar />);

    expect(screen.getByText(/^Problema de sincronización · última sync OK /)).not.toBeNull();
  });

  it('en online-idle muestra lo que hay en la base local', () => {
    syncStatusSignal.value = 'online-idle';
    lastSyncedAtSignal.value = '2026-01-01T00:00:00.000Z';
    localCatalogCountsSignal.value = { products: 120, customers: 22 };

    render(<StatusBar />);

    expect(screen.getByText(/· 120 productos · 22 clientes$/)).not.toBeNull();
  });
```

Run: `pnpm vitest run src/ui/components/StatusBar.test.tsx` → FAIL.

- [ ] **Step 2: Implementación**

En `src/ui/components/StatusBar.tsx`: importar `describeError` desde `'../errors.ts'` y `lastSyncFailureSignal`, `localCatalogCountsSignal` desde `'../state/sync.ts'`, y reemplazar el tramo desde `if (status === 'sync-error') {` hasta el final de `statusText()` por:

```ts
  if (status === 'sync-error') {
    const failure = lastSyncFailureSignal.value;
    const lastSyncedAt = lastSyncedAtSignal.value;
    const base =
      failure !== null
        ? `Problema de sincronización: ${describeError(failure)}`
        : 'Problema de sincronización';
    return lastSyncedAt !== null
      ? `${base} · última sync OK ${new Date(lastSyncedAt).toLocaleTimeString()}`
      : base;
  }

  const lastSyncedAt = lastSyncedAtSignal.value;
  const synced =
    lastSyncedAt !== null
      ? `Sincronizado (${new Date(lastSyncedAt).toLocaleTimeString()})`
      : 'Sincronizado';
  const counts = localCatalogCountsSignal.value;
  return counts !== null
    ? `${synced} · ${String(counts.products)} productos · ${String(counts.customers)} clientes`
    : synced;
```

(el `if (status === 'syncing')` anterior queda como está, arriba de este tramo).

- [ ] **Step 3: Verificar y commitear**

Run: `pnpm test; pnpm typecheck; pnpm lint`
Expected: verde.

```bash
git add -A src
git commit -m "feat: la barra de estado muestra el motivo del error y lo que hay en la base local (#76)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Probar la conexión y planear el cambio (`sync/connection.ts`)

**Files:**
- Create: `src/test/fake-connector.ts`, `src/sync/connection.ts`, `src/sync/connection.test.ts`

**Interfaces:**
- Consumes: `createConnector` (registro), `hasUserData`/`LocalDataSummary` (Task 3), `SyncConfig`.
- Produces:
  - `fakeConnector(overrides?: Partial<Connector>): Connector` (helper de tests, `src/test/fake-connector.ts`).
  - `type ProbeSnapshot = { products: Product[]; stock: StockItem[]; customers: ConnectorCustomer[]; cursors: { products?: string; customers?: string } }`
  - `PROBE_TIMEOUT_MS = 20_000`
  - `withTimeout<T>(promise: Promise<Result<T>>, ms: number): Promise<Result<T>>` — si vence devuelve `err('sync/timeout', { seconds })`.
  - `probeConnection(config: SyncConfig, options?: { timeoutMs?: number; connector?: Connector }): Promise<Result<ProbeSnapshot>>` — pull completo **en memoria**, todo o nada, sin tocar IndexedDB, cursores ni config guardada.
  - `originKey(config: SyncConfig): string` — el endpoint normalizado (`baseUrl` o `webAppUrl`); el `type` no forma parte.
  - `type ConnectionPlan = { wipe: boolean; needsConfirmation: boolean }` y `planConnectionChange(params: { current: SyncConfig | undefined; candidate: SyncConfig; localData: LocalDataSummary }): ConnectionPlan`.

- [ ] **Step 1: Helper de tests `src/test/fake-connector.ts`**

```ts
import type { Product } from '../domain/product.ts';
import { ok } from '../domain/result.ts';
import type { StockItem } from '../domain/stock.ts';
import type {
  AccountHoldResult,
  Connector,
  ConnectorCustomer,
  ConnectorPullResult,
} from '../sync/connector.ts';

/** `Connector` de mentira para tests: todo responde OK y vacío; cada test pisa lo que le importa. */
export function fakeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    pullProducts: () => Promise.resolve(ok<ConnectorPullResult<Product>>({ items: [] })),
    pullStock: () => Promise.resolve(ok<StockItem[]>([])),
    pullCustomers: () =>
      Promise.resolve(ok<ConnectorPullResult<ConnectorCustomer>>({ items: [] })),
    pushSale: () => Promise.resolve(ok(undefined)),
    pushStockMovement: () => Promise.resolve(ok(undefined)),
    pushSaleVoid: () => Promise.resolve(ok(undefined)),
    pushCustomer: () => Promise.resolve(ok(undefined)),
    requestAccountHold: () =>
      Promise.resolve(ok<AccountHoldResult>({ approved: true, holdId: 'hold-1' })),
    pushAccountHoldConfirm: () => Promise.resolve(ok(undefined)),
    releaseAccountHold: () => Promise.resolve(ok(undefined)),
    pushCashSession: () => Promise.resolve(ok(undefined)),
    ...overrides,
  };
}
```

- [ ] **Step 2: Tests que fallan — `src/sync/connection.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../domain/product.ts';
import { err, ok } from '../domain/result.ts';
import type { LocalDataSummary } from '../storage/local-data.ts';
import { fakeConnector } from '../test/fake-connector.ts';
import type { SyncConfig } from './config.ts';
import type { Connector } from './connector.ts';
import { originKey, planConnectionChange, probeConnection, withTimeout } from './connection.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const config: SyncConfig = { type: 'rest', baseUrl: 'https://api.example.com' };

const product: Product = {
  id: 'p1',
  sku: 'S1',
  barcodes: [],
  name: 'Arroz',
  price: 100,
  taxRate: 0.21,
  category: 'x',
  tracksStock: false,
};

describe('withTimeout', () => {
  it('devuelve el resultado si llega a tiempo', async () => {
    const result = await withTimeout(Promise.resolve(ok(42)), 1000);

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('devuelve sync/timeout si vence', async () => {
    const never = new Promise<never>(() => undefined);

    const result = await withTimeout(never, 30);

    expect(result).toEqual({ ok: false, error: 'sync/timeout', meta: { seconds: 1 } });
  });
});

describe('probeConnection', () => {
  it('trae productos, stock y clientes en memoria, con los cursores', async () => {
    const connector = fakeConnector({
      pullProducts: () => Promise.resolve(ok({ items: [product], nextCursor: 'cur-p' })),
      pullStock: () =>
        Promise.resolve(ok([{ productId: 'p1', quantity: 5, updatedAt: '2026-01-01T00:00:00.000Z' }])),
      pullCustomers: () =>
        Promise.resolve(ok({ items: [{ id: 'c1', name: 'Ana' }], nextCursor: 'cur-c' })),
    });

    const result = await probeConnection(config, { connector });

    expect(result).toEqual({
      ok: true,
      value: {
        products: [product],
        stock: [{ productId: 'p1', quantity: 5, updatedAt: '2026-01-01T00:00:00.000Z' }],
        customers: [{ id: 'c1', name: 'Ana' }],
        cursors: { products: 'cur-p', customers: 'cur-c' },
      },
    });
  });

  it('sin cursores en la respuesta, no los inventa', async () => {
    const result = await probeConnection(config, { connector: fakeConnector() });

    expect(result).toEqual({
      ok: true,
      value: { products: [], stock: [], customers: [], cursors: {} },
    });
  });

  it('todo o nada: si falla el pull de productos, devuelve ese error y no sigue', async () => {
    const pullStock = vi.fn<Connector['pullStock']>().mockResolvedValue(ok([]));
    const failure = err('sync/request-failed', { status: 401, message: 'x' });
    const connector = fakeConnector({
      pullProducts: () => Promise.resolve(failure),
      pullStock,
    });

    const result = await probeConnection(config, { connector });

    expect(result).toEqual(failure);
    expect(pullStock).not.toHaveBeenCalled();
  });

  it('todo o nada: si falla el pull de clientes, la prueba falla aunque productos hayan andado', async () => {
    const connector = fakeConnector({
      pullProducts: () => Promise.resolve(ok({ items: [product] })),
      pullCustomers: () => Promise.resolve(err('sync/request-failed', { message: 'down' })),
    });

    const result = await probeConnection(config, { connector });

    expect(result.ok).toBe(false);
  });

  it('un backend colgado devuelve sync/timeout en vez de esperar para siempre', async () => {
    const connector = fakeConnector({
      pullProducts: () => new Promise<never>(() => undefined),
    });

    const result = await probeConnection(config, { connector, timeoutMs: 30 });

    expect(result).toMatchObject({ ok: false, error: 'sync/timeout' });
  });

  it('sin conector inyectado, arma el real desde la config (REST: GET a {baseUrl}/products)', async () => {
    const fetchMock = vi.fn((url: string) => {
      const path = new URL(url).pathname;
      const body = path === '/stock' ? [] : { items: [] };
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(body),
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeConnection(config);

    expect(result.ok).toBe(true);
    const paths = fetchMock.mock.calls.map(([url]) => new URL(url).pathname);
    expect(paths).toEqual(['/products', '/stock', '/customers']);
  });
});

describe('originKey', () => {
  it('normaliza: sin barra final y con el host en minúsculas', () => {
    expect(originKey({ type: 'rest', baseUrl: 'https://Api.Example.com/' })).toBe(
      'https://api.example.com',
    );
    expect(originKey({ type: 'rest', baseUrl: 'https://api.example.com/v1/' })).toBe(
      'https://api.example.com/v1',
    );
  });

  it('usa webAppUrl para Google Sheets', () => {
    expect(
      originKey({
        type: 'google-sheets',
        webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      }),
    ).toBe('https://script.google.com/macros/s/abc/exec');
  });

  it('la API key, el secreto y el locale no forman parte del origen', () => {
    expect(originKey({ type: 'rest', baseUrl: 'https://api.example.com', apiKey: 'a', locale: 'es-AR' })).toBe(
      originKey({ type: 'rest', baseUrl: 'https://api.example.com', apiKey: 'b' }),
    );
  });

  it('dos backends distintos tienen orígenes distintos', () => {
    expect(originKey({ type: 'rest', baseUrl: 'https://a.example.com' })).not.toBe(
      originKey({ type: 'rest', baseUrl: 'https://b.example.com' }),
    );
  });
});

describe('planConnectionChange', () => {
  const empty: LocalDataSummary = {
    products: 0,
    customers: 0,
    sales: 0,
    cashSessions: 0,
    pendingOutbox: 0,
    pendingSales: 0,
    draftCartLines: 0,
  };
  const withSales: LocalDataSummary = { ...empty, products: 10, sales: 3 };
  const other: SyncConfig = { type: 'rest', baseUrl: 'https://otro.example.com' };

  it('mismo origen (aunque cambie la API key): no borra ni pregunta, tenga o no datos', () => {
    const plan = planConnectionChange({
      current: config,
      candidate: { ...config, apiKey: 'nueva' },
      localData: withSales,
    });

    expect(plan).toEqual({ wipe: false, needsConfirmation: false });
  });

  it('origen distinto con datos del usuario: borra y pide confirmación', () => {
    const plan = planConnectionChange({ current: config, candidate: other, localData: withSales });

    expect(plan).toEqual({ wipe: true, needsConfirmation: true });
  });

  it('origen distinto con solo catálogo y clientes: borra sin preguntar', () => {
    const plan = planConnectionChange({
      current: config,
      candidate: other,
      localData: { ...empty, products: 50, customers: 20 },
    });

    expect(plan).toEqual({ wipe: true, needsConfirmation: false });
  });

  it('sin config actual pero con datos del usuario: origen desconocido, pide confirmación', () => {
    const plan = planConnectionChange({ current: undefined, candidate: config, localData: withSales });

    expect(plan).toEqual({ wipe: true, needsConfirmation: true });
  });

  it('primer arranque (sin config ni datos): borra (no-op) y no pregunta', () => {
    const plan = planConnectionChange({ current: undefined, candidate: config, localData: empty });

    expect(plan).toEqual({ wipe: true, needsConfirmation: false });
  });
});
```

Run: `pnpm vitest run src/sync/connection.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementación — `src/sync/connection.ts`**

```ts
import type { Product } from '../domain/product.ts';
import { err, ok, type Result } from '../domain/result.ts';
import type { StockItem } from '../domain/stock.ts';
import { hasUserData, type LocalDataSummary } from '../storage/local-data.ts';
import type { SyncConfig } from './config.ts';
import type { Connector, ConnectorCustomer } from './connector.ts';
import { createConnector } from './connector-registry.ts';

/** Lo que trae una prueba de conexión: todo en memoria, nada tocó IndexedDB todavía. */
export type ProbeSnapshot = {
  products: Product[];
  stock: StockItem[];
  customers: ConnectorCustomer[];
  cursors: { products?: string; customers?: string };
};

export const PROBE_TIMEOUT_MS = 20_000;

/**
 * Carrera contra un tiempo máximo, sin cambiar el puerto `Connector`: si
 * vence, devuelve `sync/timeout` y el trabajo en vuelo se ignora (no se
 * cancela el `fetch`, solo se descarta su resultado). Un backend colgado no
 * puede dejar "Probando conexión…" para siempre.
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

async function pullEverything(connector: Connector): Promise<Result<ProbeSnapshot>> {
  const products = await connector.pullProducts({});
  if (!products.ok) {
    return products;
  }
  const stock = await connector.pullStock();
  if (!stock.ok) {
    return stock;
  }
  const customers = await connector.pullCustomers({});
  if (!customers.ok) {
    return customers;
  }
  return ok({
    products: products.value.items,
    stock: stock.value,
    customers: customers.value.items,
    cursors: {
      ...(products.value.nextCursor !== undefined ? { products: products.value.nextCursor } : {}),
      ...(customers.value.nextCursor !== undefined
        ? { customers: customers.value.nextCursor }
        : {}),
    },
  });
}

/**
 * Prueba una conexión candidata (Etapa 2b, #76): el pull completo de
 * productos, stock y clientes, **todo o nada**, en memoria. No toca IndexedDB,
 * ni los cursores, ni la config guardada — recién `applyConnection` lo hace,
 * y solo si esto salió bien. `options.connector` existe para testear sin red.
 */
export function probeConnection(
  config: SyncConfig,
  options: { timeoutMs?: number; connector?: Connector } = {},
): Promise<Result<ProbeSnapshot>> {
  const connector = options.connector ?? createConnector(config);
  return withTimeout(pullEverything(connector), options.timeoutMs ?? PROBE_TIMEOUT_MS);
}

function normalizeEndpoint(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Identidad del backend: el endpoint normalizado (sin barra final, host en
 * minúsculas). El `type` no forma parte: dos tipos de conector que hablan con
 * el mismo endpoint son el mismo backend. Cambiar la API key, el secreto o el
 * locale no cambia el origen.
 */
export function originKey(config: SyncConfig): string {
  switch (config.type) {
    case 'rest':
      return normalizeEndpoint(config.baseUrl);
    case 'google-sheets':
      return normalizeEndpoint(config.webAppUrl);
    default: {
      const exhaustiveCheck: never = config;
      return exhaustiveCheck;
    }
  }
}

export type ConnectionPlan = { wipe: boolean; needsConfirmation: boolean };

/**
 * Decide qué hace falta al aplicar una conexión (función pura):
 * - `wipe`: el origen cambió, o no hay config actual (no se puede saber de
 *   qué origen son los datos, así que se los trata como ajenos).
 * - `needsConfirmation`: hay que borrar **y** hay datos del usuario que se
 *   perderían (ventas, turnos, pendientes de envío, venta en curso). Un
 *   catálogo o clientes solos se reemplazan sin preguntar — nunca se
 *   descartan ventas locales en silencio.
 */
export function planConnectionChange(params: {
  current: SyncConfig | undefined;
  candidate: SyncConfig;
  localData: LocalDataSummary;
}): ConnectionPlan {
  const sameOrigin =
    params.current !== undefined &&
    originKey(params.current) === originKey(params.candidate);
  const wipe = !sameOrigin;
  return { wipe, needsConfirmation: wipe && hasUserData(params.localData) };
}
```

- [ ] **Step 4: Verificar y commitear**

Run: `pnpm vitest run src/sync/connection.test.ts; pnpm test; pnpm typecheck; pnpm lint`
Expected: verde.

```bash
git add -A src
git commit -m "feat: probar la conexión en memoria y planear el cambio de origen (#76)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Aplicar la conexión de forma transaccional (`sync/apply-connection.ts`)

**Files:**
- Create: `src/sync/apply-connection.ts`, `src/sync/apply-connection.test.ts`

**Interfaces:**
- Consumes: `ProbeSnapshot`, `withTimeout` (Task 6); `clearAllTables`, `countLocalCatalog` (Task 3); `splitConnectorCustomers` (Task 4); `acquireSyncLockWaiting`, `pushPendingEvents` (Task 4); setters de `ui/state/sync.ts` (Task 2); `saveSyncConfig`.
- Produces:
  - `FLUSH_TIMEOUT_MS = 10_000`, `APPLY_LOCK_WAIT_MS = 30_000`.
  - `flushPendingBeforeWipe(current: SyncConfig, options?: { timeoutMs?: number; connector?: Connector }): Promise<void>` — último intento de enviar el outbox al conector **actual** (best-effort: ignora el backoff, toma el cerrojo de sync, con tope de tiempo; nunca lanza ni cuelga).
  - `applyConnection(params: { candidate: SyncConfig; snapshot: ProbeSnapshot; wipe: boolean; now: string; lockWaitMs?: number }): Promise<Result<void>>` — una transacción Dexie sobre todas las tablas (limpia si `wipe`, carga el snapshot), después reinicia los cursores y fija los del snapshot, reconstruye los repositorios en memoria y **al final** guarda la config con `verifiedAt = now` y deja la conexión `active`. Cualquier falla devuelve `connection/apply-failed` sin haber cambiado nada de lo guardado.

- [ ] **Step 1: Tests que fallan — `src/sync/apply-connection.test.ts`**

```ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOutboxEventForSale } from '../domain/outbox.ts';
import type { Product } from '../domain/product.ts';
import { ok } from '../domain/result.ts';
import type { Sale } from '../domain/sale.ts';
import { db } from '../storage/db.ts';
import { fakeConnector } from '../test/fake-connector.ts';
import {
  connectionStateSignal,
  syncStatusSignal,
} from '../ui/state/sync.ts';
import { applyConnection, flushPendingBeforeWipe } from './apply-connection.ts';
import { loadSyncConfig, saveSyncConfig, type SyncConfig } from './config.ts';
import type { ProbeSnapshot } from './connection.ts';
import { getCustomersCursor, getProductsCursor, setProductsCursor } from './cursor.ts';
import { tryAcquireSyncLock } from './engine.ts';

const now = '2026-01-01T00:00:00.000Z';

const product: Product = {
  id: 'p1',
  sku: 'S1',
  barcodes: [],
  name: 'Arroz',
  price: 100,
  taxRate: 0.21,
  category: 'x',
  tracksStock: false,
};

const snapshot: ProbeSnapshot = {
  products: [product],
  stock: [{ productId: 'p1', quantity: 5, updatedAt: now }],
  customers: [
    { id: 'c1', name: 'Ana' },
    { id: 'c2', name: 'Beto', creditLimit: 100, margin: 10, balance: 5 },
  ],
  cursors: { products: 'cur-p', customers: 'cur-c' },
};

const candidate: SyncConfig = { type: 'rest', baseUrl: 'https://nuevo.example.com' };
const oldConfig: SyncConfig = {
  type: 'rest',
  baseUrl: 'https://viejo.example.com',
  verifiedAt: '2025-12-01T00:00:00.000Z',
};

function makeSale(id: string): Sale {
  return { id, lines: [], payments: [], total: 0, status: 'closed', createdAt: now };
}

async function seedOldWorld(): Promise<void> {
  saveSyncConfig(oldConfig);
  setProductsCursor('cursor-viejo');
  await db.products.put({ ...product, id: 'viejo', name: 'Del backend viejo' });
  await db.sales.put(makeSale('s-vieja'));
  await db.outbox.put(buildOutboxEventForSale(makeSale('s-vieja'), { now }));
  await db.cashSessions.put({ id: 'cs1', openedAt: now, openingAmount: 0, sales: [] });
  await db.draftCart.put({
    id: 'current',
    cart: { lines: [{ kind: 'freeform', description: 'a', qty: 1, unitPrice: 1 }] },
  });
}

beforeEach(async () => {
  await db.open();
  connectionStateSignal.value = 'unconfigured';
  syncStatusSignal.value = 'offline';
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('applyConnection', () => {
  it('sobre una terminal vacía: carga el snapshot, guarda la config con verifiedAt y deja la conexión activa', async () => {
    const result = await applyConnection({ candidate, snapshot, wipe: true, now });

    expect(result).toEqual({ ok: true, value: undefined });
    await expect(db.products.count()).resolves.toBe(1);
    await expect(db.stock.count()).resolves.toBe(1);
    await expect(db.customers.count()).resolves.toBe(2);
    await expect(db.customerAccounts.count()).resolves.toBe(1);
    expect(loadSyncConfig()).toEqual({ ok: true, value: { ...candidate, verifiedAt: now } });
    expect(connectionStateSignal.value).toBe('active');
    expect(syncStatusSignal.value).toBe('online-idle');
  });

  it('con wipe: borra ventas, outbox, turnos y venta en curso, y deja solo lo del snapshot', async () => {
    await seedOldWorld();

    const result = await applyConnection({ candidate, snapshot, wipe: true, now });

    expect(result.ok).toBe(true);
    await expect(db.products.toArray()).resolves.toEqual([product]);
    await expect(db.sales.count()).resolves.toBe(0);
    await expect(db.outbox.count()).resolves.toBe(0);
    await expect(db.cashSessions.count()).resolves.toBe(0);
    await expect(db.draftCart.count()).resolves.toBe(0);
  });

  it('sin wipe (mismo origen): conserva lo local y suma el snapshot', async () => {
    await seedOldWorld();

    const result = await applyConnection({ candidate, snapshot, wipe: false, now });

    expect(result.ok).toBe(true);
    await expect(db.sales.count()).resolves.toBe(1);
    await expect(db.outbox.count()).resolves.toBe(1);
    await expect(db.products.count()).resolves.toBe(2);
  });

  it('reinicia los cursores y fija los del snapshot', async () => {
    await seedOldWorld();

    await applyConnection({ candidate, snapshot, wipe: true, now });

    expect(getProductsCursor()).toBe('cur-p');
    expect(getCustomersCursor()).toBe('cur-c');
  });

  it('si el snapshot no trae cursor, no queda ninguno (ni el viejo)', async () => {
    await seedOldWorld();

    await applyConnection({
      candidate,
      snapshot: { ...snapshot, cursors: {} },
      wipe: true,
      now,
    });

    expect(getProductsCursor()).toBeUndefined();
  });

  it('si la transacción falla no cambia nada: ni los datos, ni la config, ni el estado', async () => {
    await seedOldWorld();
    connectionStateSignal.value = 'active';
    const broken: ProbeSnapshot = {
      ...snapshot,
      // Una clave inválida de IndexedDB hace fallar el bulkPut a mitad de la transacción.
      products: [{ ...product, id: null as unknown as string }],
    };

    const result = await applyConnection({ candidate, snapshot: broken, wipe: true, now });

    expect(result).toMatchObject({ ok: false, error: 'connection/apply-failed' });
    await expect(db.sales.count()).resolves.toBe(1);
    await expect(db.products.get('viejo')).resolves.not.toBeUndefined();
    expect(loadSyncConfig()).toEqual({ ok: true, value: oldConfig });
    expect(getProductsCursor()).toBe('cursor-viejo');
    expect(connectionStateSignal.value).toBe('active');
  });

  it('no se intercala con un ciclo de sync: si el cerrojo sigue tomado, falla sin tocar nada', async () => {
    await seedOldWorld();
    const release = tryAcquireSyncLock();

    const result = await applyConnection({ candidate, snapshot, wipe: true, now, lockWaitMs: 40 });

    expect(result).toMatchObject({ ok: false, error: 'connection/apply-failed' });
    await expect(db.sales.count()).resolves.toBe(1);
    expect(loadSyncConfig()).toEqual({ ok: true, value: oldConfig });
    release?.();
  });

  it('libera el cerrojo al terminar (bien o mal)', async () => {
    await applyConnection({ candidate, snapshot, wipe: true, now });

    const release = tryAcquireSyncLock();
    expect(release).not.toBeUndefined();
    release?.();
  });
});

describe('flushPendingBeforeWipe', () => {
  it('empuja los pendientes al conector actual ignorando el backoff', async () => {
    await db.outbox.put({
      ...buildOutboxEventForSale(makeSale('s1'), { now }),
      retries: 2,
      nextAttemptAt: '2099-01-01T00:00:00.000Z',
    });
    const pushSale = vi.fn().mockResolvedValue(ok(undefined));

    await flushPendingBeforeWipe(oldConfig, { connector: fakeConnector({ pushSale }) });

    expect(pushSale).toHaveBeenCalledTimes(1);
    await expect(db.outbox.get(makeSale('s1').id)).resolves.toMatchObject({ status: 'synced' });
  });

  it('si el conector se cuelga, vuelve igual (tope de tiempo) y libera el cerrojo', async () => {
    await db.outbox.put(buildOutboxEventForSale(makeSale('s1'), { now }));
    const connector = fakeConnector({ pushSale: () => new Promise<never>(() => undefined) });

    await flushPendingBeforeWipe(oldConfig, { connector, timeoutMs: 40 });

    const release = tryAcquireSyncLock();
    expect(release).not.toBeUndefined();
    release?.();
  });

  it('si el cerrojo sigue tomado y vence la espera, no empuja nada', async () => {
    await db.outbox.put(buildOutboxEventForSale(makeSale('s1'), { now }));
    const pushSale = vi.fn().mockResolvedValue(ok(undefined));
    const release = tryAcquireSyncLock();

    await flushPendingBeforeWipe(oldConfig, {
      connector: fakeConnector({ pushSale }),
      timeoutMs: 40,
    });

    expect(pushSale).not.toHaveBeenCalled();
    release?.();
  });
});
```

Run: `pnpm vitest run src/sync/apply-connection.test.ts` → FAIL (módulo inexistente). Si `buildOutboxEventForSale` devuelve un evento sin el campo `nextAttemptAt`/`retries` con esos nombres, ajustar los `put` de los tests al tipo real de `OutboxEvent` (`domain/outbox.ts`).

- [ ] **Step 2: Implementación — `src/sync/apply-connection.ts`**

```ts
import { splitConnectorCustomers } from '../domain/customer.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { db } from '../storage/db.ts';
import { clearAllTables, countLocalCatalog } from '../storage/local-data.ts';
import { setCatalogRepository } from '../ui/state/catalog.ts';
import { setCustomerRepository } from '../ui/state/customer-repository.ts';
import {
  setConnectionState,
  setLastSyncedAt,
  setLastSyncFailure,
  setLocalCatalogCounts,
  setSyncConfigured,
  setSyncStatus,
} from '../ui/state/sync.ts';
import { saveSyncConfig, type SyncConfig } from './config.ts';
import { withTimeout, type ProbeSnapshot } from './connection.ts';
import type { Connector } from './connector.ts';
import { createConnector } from './connector-registry.ts';
import { clearSyncCursors, setCustomersCursor, setProductsCursor } from './cursor.ts';
import { acquireSyncLockWaiting, pushPendingEvents } from './engine.ts';

export const FLUSH_TIMEOUT_MS = 10_000;
export const APPLY_LOCK_WAIT_MS = 30_000;

/**
 * Último intento de enviar el outbox al conector **actual** antes de borrar
 * los datos al cambiar de conexión (Etapa 2b, #76). Best-effort: ignora el
 * backoff, toma el cerrojo de sync y lleva un tope de tiempo — si el backend
 * viejo ya no responde, no cuelga el cambio (lo que quede pendiente se
 * cuenta como "sin enviar" en la confirmación). Si vence el tiempo, el envío
 * en vuelo sigue por su cuenta pero ya sin cerrojo; es inocuo porque cada
 * evento viaja con su `Idempotency-Key`.
 */
export async function flushPendingBeforeWipe(
  current: SyncConfig,
  options: { timeoutMs?: number; connector?: Connector } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? FLUSH_TIMEOUT_MS;
  const release = await acquireSyncLockWaiting(timeoutMs);
  if (release === undefined) {
    return;
  }
  try {
    const connector = options.connector ?? createConnector(current);
    await withTimeout(
      pushPendingEvents(connector, new Date().toISOString(), { ignoreBackoff: true }).then(() =>
        ok(undefined),
      ),
      timeoutMs,
    );
  } finally {
    release();
  }
}

export type ApplyConnectionParams = {
  candidate: SyncConfig;
  snapshot: ProbeSnapshot;
  wipe: boolean;
  now: string;
  lockWaitMs?: number;
};

/**
 * Aplica una conexión ya probada (Etapa 2b, #76):
 * 1. toma el cerrojo de sync (ningún ciclo se intercala);
 * 2. **una sola transacción Dexie** sobre todas las tablas: limpia si `wipe`
 *    y carga el snapshot — si algo falla acá, no cambió nada;
 * 3. reinicia los cursores, fija los del snapshot y reconstruye los
 *    repositorios en memoria;
 * 4. **al final** guarda la config con `verifiedAt`, así nunca queda una
 *    config activa con datos de otro backend.
 *
 * Riesgo residual aceptado: el guardado de la config vive en `localStorage`,
 * que no puede entrar en la transacción de Dexie. Si ese `setItem` (de un
 * string chico) fallara *después* del commit, el usuario ve el error y el
 * próximo arranque encuentra la config anterior con datos nuevos.
 */
export async function applyConnection(params: ApplyConnectionParams): Promise<Result<void>> {
  const release = await acquireSyncLockWaiting(params.lockWaitMs ?? APPLY_LOCK_WAIT_MS);
  if (release === undefined) {
    return err('connection/apply-failed', { message: 'hay una sincronización en curso' });
  }

  try {
    const { customers, accounts } = splitConnectorCustomers(params.snapshot.customers, {
      now: params.now,
    });

    try {
      await db.transaction('rw', db.tables, async () => {
        if (params.wipe) {
          await clearAllTables();
        }
        await db.products.bulkPut(params.snapshot.products);
        await db.stock.bulkPut(params.snapshot.stock);
        await db.customers.bulkPut(customers);
        await db.customerAccounts.bulkPut(accounts);
      });
    } catch (error) {
      return err('connection/apply-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    clearSyncCursors();
    if (params.snapshot.cursors.products !== undefined) {
      setProductsCursor(params.snapshot.cursors.products);
    }
    if (params.snapshot.cursors.customers !== undefined) {
      setCustomersCursor(params.snapshot.cursors.customers);
    }
    setCatalogRepository(await loadCatalogRepository());
    setCustomerRepository(await loadCustomerRepository());

    const saved = saveSyncConfig({ ...params.candidate, verifiedAt: params.now });
    if (!saved.ok) {
      return err('connection/apply-failed', { message: 'no se pudo guardar la configuración' });
    }

    setConnectionState('active');
    setSyncConfigured(true);
    setLastSyncedAt(params.now);
    setLastSyncFailure(null);
    setLocalCatalogCounts(await countLocalCatalog());
    setSyncStatus('online-idle');
    return ok(undefined);
  } finally {
    release();
  }
}
```

- [ ] **Step 3: Verificar y commitear**

Run: `pnpm vitest run src/sync/apply-connection.test.ts; pnpm test; pnpm typecheck; pnpm lint`
Expected: verde. El test de "si la transacción falla no cambia nada" es el más importante de todo el plan: si no falla como se espera con `id: null`, probar otra clave inválida (por ejemplo `id: {} as unknown as string`) antes de tocar la implementación.

```bash
git add -A src
git commit -m "feat: aplicar la conexión de forma transaccional y enviar pendientes antes de borrar (#76)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
