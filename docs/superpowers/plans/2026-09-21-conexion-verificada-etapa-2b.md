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
  - `clearAllTables(): Promise<void>` — limpia **todas** las tablas (`db.tables`, así una tabla futura queda incluida sola); tiene que llamarse dentro de una transacción Dexie.

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
export async function clearAllTables(): Promise<void> {
  await Promise.all(db.tables.map((table) => table.clear()));
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

---

### Task 8: `placeholder` por campo de conector

**Files:**
- Modify: `src/connectors/config-field.ts`, `src/connectors/rest/config.ts`, `src/connectors/rest/config.test.ts`, `src/connectors/google-sheets/config.ts`, `src/connectors/google-sheets/config.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `ConfigField` con `placeholder: string` (texto de ayuda, **no** un valor por omisión); `restConfigFields` y `googleSheetsConfigFields` lo incluyen.

- [ ] **Step 1: Tests que fallan**

En `src/connectors/rest/config.test.ts`, el test `'lista baseUrl (obligatorio) y apiKey (opcional), en ese orden'` pasa a esperar:

```ts
    expect(restConfigFields).toEqual([
      {
        key: 'baseUrl',
        label: 'URL del sistema externo',
        optional: false,
        placeholder: 'https://api.miempresa.com',
      },
      {
        key: 'apiKey',
        label: 'API key',
        optional: true,
        placeholder: 'Token de acceso, si el backend lo exige',
      },
    ]);
```

En `src/connectors/google-sheets/config.test.ts`, el de `googleSheetsConfigFields` pasa a esperar:

```ts
    expect(googleSheetsConfigFields).toEqual([
      {
        key: 'webAppUrl',
        label: 'URL del Web App de Google Apps Script',
        optional: false,
        placeholder: 'https://script.google.com/macros/s/…/exec',
      },
      {
        key: 'sharedSecret',
        label: 'Secreto compartido',
        optional: true,
        placeholder: 'Valor de SHARED_SECRET, si lo configuraste',
      },
    ]);
```

Run: `pnpm vitest run src/connectors/` → FAIL.

- [ ] **Step 2: Implementación**

`src/connectors/config-field.ts`: sumar al tipo, con su comentario:

```ts
export type ConfigField<K extends string = string> = {
  key: K;
  label: string;
  optional: boolean;
  /** Ejemplo de ayuda que muestra el campo vacío — nunca un valor por omisión (Etapa 2b: no se asume ninguna configuración). */
  placeholder: string;
};
```

`src/connectors/rest/config.ts` y `src/connectors/google-sheets/config.ts`: agregar a cada objeto de `…ConfigFields` el `placeholder` de los tests de arriba.

- [ ] **Step 3: Verificar y commitear**

Run: `pnpm test; pnpm typecheck; pnpm lint`
Expected: verde. (`src/ui/screens/config-screen.tsx` define `LOCALE_FIELD: ConfigField` — si el typecheck falla ahí por el campo nuevo, agregarle `placeholder: 'es-AR'` ya en este task.)

```bash
git add -A src
git commit -m "feat: placeholder por campo de conector, sin valores por omisión (#76)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `/CONFIG` con fases — probar, confirmar y aplicar (estado, controlador, pantalla)

Un solo task: estado, controlador y pantalla se usan entre sí y separarlos dejaría un commit con la pantalla apuntando a signals que ya no existen. Incluye adaptar los dos e2e que recorren el formulario.

**Files:**
- Rewrite: `src/ui/state/sync-config.ts`, `src/ui/keyboard/config-controller.ts`, `src/ui/keyboard/config-controller.test.ts`, `src/ui/screens/config-screen.tsx`, `src/ui/screens/config-screen.test.tsx`
- Modify: `e2e/minibackend-sync.spec.ts`, `e2e/config-connector.spec.ts`

**Interfaces:**
- Consumes: `probeConnection`, `planConnectionChange` (Task 6); `applyConnection`, `flushPendingBeforeWipe` (Task 7); `summarizeLocalData` (Task 3); `describeError` (Task 1); `connectionStateSignal` (Task 2); `runSyncCycle`.
- Produces:
  - Estado (`ui/state/sync-config.ts`): `type ConfigPhase = 'editing' | 'probing' | 'confirming' | 'applying'`; `configPhaseSignal`; `configConfirmationSignal: Signal<LocalDataSummary | null>`; `configTypeSignal: Signal<ConnectorType | null>` (sin tipo elegido = `null`); `configFieldValuesSignal`, `configLocaleSignal`, `configErrorSignal`, `configErrorFieldSignal`; `resetConfigForm(saved?: SyncConfig)`. **Se eliminan** `DEFAULT_BASE_URL` y `DEFAULT_API_KEY`.
  - Controlador: `enterConfigScreen()`, `cancelConfigScreen()`, `handleConfigEscape()`, `setConfigType(type: ConnectorType | null)`, `setConfigField(key, value)`, `setConfigLocale(value)`, `submitConfig(): Promise<void>`, `confirmConfigChange(): Promise<void>`, `backToEditing()`.
  - Pantalla: `ConfigScreen`; con la conexión no `active` funciona en **modo requerido** (sin "Cancelar", Esc no sale).

- [ ] **Step 1: Estado — `src/ui/state/sync-config.ts`**

```ts
import { signal } from '@preact/signals';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import type { SyncConfig } from '../../sync/config.ts';
import { toFieldValues, type ConnectorType } from '../../sync/connector-registry.ts';

/** Valores de los campos de cada conector, como strings (lo que se tipea). */
export type ConfigFormValues = Record<ConnectorType, Record<string, string>>;

/** Sin valores por omisión (Etapa 2b): todo arranca vacío; los ejemplos son `placeholder`s. */
function blankFormValues(): ConfigFormValues {
  return {
    rest: { baseUrl: '', apiKey: '' },
    'google-sheets': { webAppUrl: '', sharedSecret: '' },
  };
}

/** Fase del diálogo: editar → probar → (confirmar el borrado) → aplicar. */
export type ConfigPhase = 'editing' | 'probing' | 'confirming' | 'applying';

/** Conector elegido en el selector; `null` = todavía no se eligió ninguno. */
export const configTypeSignal = signal<ConnectorType | null>(null);
/**
 * Valores tipeados **por conector**: cambiar el tipo no pierde lo que ya se
 * cargó en el otro, y solo los campos del tipo activo llegan a guardarse.
 */
export const configFieldValuesSignal = signal<ConfigFormValues>(blankFormValues());
/** `locale` es config de terminal (no de conector): un solo valor, siempre visible una vez elegido un tipo. */
export const configLocaleSignal = signal('');
export const configErrorSignal = signal<string | null>(null);
/** Clave del campo al que apunta el error, para enfocarlo y seleccionarlo (`data-config-field`). */
export const configErrorFieldSignal = signal<string | null>(null);
export const configPhaseSignal = signal<ConfigPhase>('editing');
/** Lo que se perdería al cambiar de conexión — solo tiene valor en la fase `confirming`. */
export const configConfirmationSignal = signal<LocalDataSummary | null>(null);

/**
 * Deja el formulario en su estado inicial. Con `saved`, precarga esa config
 * (tipo, campos y locale) — así reconfigurar un solo dato no obliga a
 * retipear los demás; sin ella (terminal nueva), todo vacío y sin tipo.
 */
export function resetConfigForm(saved?: SyncConfig): void {
  const values = blankFormValues();
  if (saved !== undefined) {
    values[saved.type] = toFieldValues(saved);
  }
  configTypeSignal.value = saved?.type ?? null;
  configFieldValuesSignal.value = values;
  configLocaleSignal.value = saved?.locale ?? '';
  configErrorSignal.value = null;
  configErrorFieldSignal.value = null;
  configPhaseSignal.value = 'editing';
  configConfirmationSignal.value = null;
}
```

- [ ] **Step 2: Tests del controlador que fallan — reemplazar `src/ui/keyboard/config-controller.test.ts`**

```ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOutboxEventForSale } from '../../domain/outbox.ts';
import type { Sale } from '../../domain/sale.ts';
import { db } from '../../storage/db.ts';
import { loadSyncConfig, saveSyncConfig } from '../../sync/config.ts';
import { cartSignal } from '../state/cart.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { connectionStateSignal } from '../state/sync.ts';
import {
  configConfirmationSignal,
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configLocaleSignal,
  configPhaseSignal,
  configTypeSignal,
} from '../state/sync-config.ts';
import {
  backToEditing,
  cancelConfigScreen,
  confirmConfigChange,
  enterConfigScreen,
  handleConfigEscape,
  setConfigField,
  setConfigLocale,
  setConfigType,
  submitConfig,
} from './config-controller.ts';

const now = '2026-01-01T00:00:00.000Z';
const WEB_APP_URL = 'https://script.google.com/macros/s/abc/exec';

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

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) } as Response;
}

/** Backend REST de mentira: productos, stock y clientes responden; cualquier POST/DELETE da OK. */
function stubRestBackend(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string) => {
    const path = new URL(url).pathname;
    if (path === '/products') return Promise.resolve(okResponse({ items: [product] }));
    if (path === '/stock') return Promise.resolve(okResponse([]));
    if (path === '/customers') return Promise.resolve(okResponse({ items: [{ id: 'c1', name: 'Ana' }] }));
    return Promise.resolve(okResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function makeSale(id: string): Sale {
  return { id, lines: [], payments: [], total: 0, status: 'closed', createdAt: now };
}

async function seedUserDataFor(config: Parameters<typeof saveSyncConfig>[0]): Promise<void> {
  saveSyncConfig(config);
  await db.sales.put(makeSale('s1'));
  await db.outbox.put(buildOutboxEventForSale(makeSale('s1'), { now }));
}

beforeEach(async () => {
  await db.open();
  activeScreenSignal.value = 'sale';
  connectionStateSignal.value = 'unconfigured';
  enterConfigScreen();
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('enterConfigScreen', () => {
  it('cambia a la pantalla config, sin tipo elegido, con los campos vacíos y sin error', () => {
    expect(activeScreenSignal.value).toBe('config');
    expect(configTypeSignal.value).toBeNull();
    expect(configFieldValuesSignal.value.rest).toEqual({ baseUrl: '', apiKey: '' });
    expect(configFieldValuesSignal.value['google-sheets']).toEqual({ webAppUrl: '', sharedSecret: '' });
    expect(configLocaleSignal.value).toBe('');
    expect(configErrorSignal.value).toBeNull();
    expect(configPhaseSignal.value).toBe('editing');
  });

  it('con una config REST guardada, precarga esos valores', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com', locale: 'es-AR' });

    enterConfigScreen();

    expect(configTypeSignal.value).toBe('rest');
    expect(configFieldValuesSignal.value.rest).toEqual({
      baseUrl: 'https://api.example.com',
      apiKey: '',
    });
    expect(configLocaleSignal.value).toBe('es-AR');
  });

  it('con una config de Google Sheets guardada, abre en ese tipo con sus valores', () => {
    saveSyncConfig({ type: 'google-sheets', webAppUrl: WEB_APP_URL, sharedSecret: 's3cr3t' });

    enterConfigScreen();

    expect(configTypeSignal.value).toBe('google-sheets');
    expect(configFieldValuesSignal.value['google-sheets']).toEqual({
      webAppUrl: WEB_APP_URL,
      sharedSecret: 's3cr3t',
    });
  });

  it('con una config guardada sin type (formato anterior a la Etapa 2), la precarga como REST', () => {
    localStorage.setItem(
      'offline-pos:sync-config',
      JSON.stringify({ baseUrl: 'https://api.example.com', apiKey: 'vieja' }),
    );

    enterConfigScreen();

    expect(configTypeSignal.value).toBe('rest');
    expect(configFieldValuesSignal.value.rest.apiKey).toBe('vieja');
  });
});

describe('edición del formulario', () => {
  it('cambiar el tipo no pierde lo tipeado en el otro', () => {
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');
    setConfigType('google-sheets');
    setConfigField('webAppUrl', WEB_APP_URL);
    setConfigType('rest');

    expect(configFieldValuesSignal.value.rest.baseUrl).toBe('https://api.example.com');
    expect(configFieldValuesSignal.value['google-sheets'].webAppUrl).toBe(WEB_APP_URL);
  });

  it('volver a "sin tipo" también es válido', () => {
    setConfigType('rest');
    setConfigType(null);

    expect(configTypeSignal.value).toBeNull();
  });

  it('editar limpia el error visible', () => {
    setConfigType('rest');
    void submitConfig();
    expect(configErrorSignal.value).not.toBeNull();

    setConfigField('baseUrl', 'x');

    expect(configErrorSignal.value).toBeNull();
    expect(configErrorFieldSignal.value).toBeNull();
  });
});

describe('submitConfig — validación (antes de probar)', () => {
  it('sin tipo elegido pide elegir uno y no prueba nada', async () => {
    const fetchMock = stubRestBackend();

    await submitConfig();

    expect(configErrorSignal.value).toBe('Elegí un tipo de conexión.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('una URL vacía señala ese campo', async () => {
    setConfigType('rest');

    await submitConfig();

    expect(configErrorSignal.value).toBe('Completá «URL del sistema externo».');
    expect(configErrorFieldSignal.value).toBe('baseUrl');
    expect(configPhaseSignal.value).toBe('editing');
  });

  it('una URL inválida señala ese campo y no prueba nada', async () => {
    const fetchMock = stubRestBackend();
    setConfigType('rest');
    setConfigField('baseUrl', 'no-es-una-url');

    await submitConfig();

    expect(configErrorSignal.value).toBe('«URL del sistema externo» no es válido.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('submitConfig — primer arranque (sin datos locales)', () => {
  it('prueba, aplica y deja la conexión activa con la config guardada con verifiedAt', async () => {
    stubRestBackend();
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');
    setConfigField('apiKey', 'secreto');
    setConfigLocale('es-AR');

    await submitConfig();

    expect(activeScreenSignal.value).toBe('sale');
    expect(connectionStateSignal.value).toBe('active');
    expect(configPhaseSignal.value).toBe('editing');
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value).toMatchObject({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      apiKey: 'secreto',
      locale: 'es-AR',
    });
    expect(saved.ok && saved.value.verifiedAt).toBeTruthy();
    await expect(db.products.count()).resolves.toBe(1);
    await expect(db.customers.count()).resolves.toBe(1);
  });

  it('si la prueba falla: mensaje legible, el formulario queda como estaba y no cambia nada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');

    await submitConfig();

    expect(configErrorSignal.value).toBe(
      'No se pudo conectar con el servidor (Failed to fetch). ¿Está en línea y corriendo?',
    );
    expect(configPhaseSignal.value).toBe('editing');
    expect(activeScreenSignal.value).toBe('config');
    expect(configFieldValuesSignal.value.rest.baseUrl).toBe('https://api.example.com');
    expect(loadSyncConfig().ok).toBe(false);
    expect(connectionStateSignal.value).toBe('unconfigured');
    await expect(db.products.count()).resolves.toBe(0);
  });
});

describe('submitConfig — cambio de conexión con datos locales', () => {
  const oldConfig = {
    type: 'rest' as const,
    baseUrl: 'https://viejo.example.com',
    verifiedAt: '2025-12-01T00:00:00.000Z',
  };

  it('mismo origen (cambia solo la API key): no pide confirmación y conserva los datos', async () => {
    stubRestBackend();
    await seedUserDataFor(oldConfig);
    connectionStateSignal.value = 'active';
    enterConfigScreen();
    setConfigField('apiKey', 'nueva');

    await submitConfig();

    expect(configPhaseSignal.value).toBe('editing');
    expect(activeScreenSignal.value).toBe('sale');
    await expect(db.sales.count()).resolves.toBe(1);
  });

  it('origen distinto: envía lo pendiente al conector actual y pide confirmación con los conteos', async () => {
    const fetchMock = stubRestBackend();
    await seedUserDataFor(oldConfig);
    connectionStateSignal.value = 'active';
    enterConfigScreen();
    setConfigField('baseUrl', 'https://nuevo.example.com');

    await submitConfig();

    expect(configPhaseSignal.value).toBe('confirming');
    expect(activeScreenSignal.value).toBe('config');
    expect(configConfirmationSignal.value).toMatchObject({ sales: 1 });
    // El último intento de envío fue contra el backend VIEJO.
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain('https://viejo.example.com/sales');
    // Nada cambió todavía.
    await expect(db.sales.count()).resolves.toBe(1);
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value.type === 'rest' && saved.value.baseUrl).toBe(
      'https://viejo.example.com',
    );
  });

  it('confirmar borra lo local, carga lo del backend nuevo y vacía la venta en curso', async () => {
    stubRestBackend();
    await seedUserDataFor(oldConfig);
    connectionStateSignal.value = 'active';
    cartSignal.value = { lines: [{ kind: 'freeform', description: 'x', qty: 1, unitPrice: 1 }] };
    enterConfigScreen();
    setConfigField('baseUrl', 'https://nuevo.example.com');
    await submitConfig();

    await confirmConfigChange();

    expect(activeScreenSignal.value).toBe('sale');
    await expect(db.sales.count()).resolves.toBe(0);
    await expect(db.outbox.count()).resolves.toBe(0);
    await expect(db.products.count()).resolves.toBe(1);
    expect(cartSignal.value).toEqual({ lines: [] });
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value.type === 'rest' && saved.value.baseUrl).toBe(
      'https://nuevo.example.com',
    );
  });

  it('Esc en la confirmación vuelve a editar sin borrar nada', async () => {
    stubRestBackend();
    await seedUserDataFor(oldConfig);
    connectionStateSignal.value = 'active';
    enterConfigScreen();
    setConfigField('baseUrl', 'https://nuevo.example.com');
    await submitConfig();

    handleConfigEscape();

    expect(configPhaseSignal.value).toBe('editing');
    expect(configConfirmationSignal.value).toBeNull();
    await expect(db.sales.count()).resolves.toBe(1);
  });

  it('backToEditing hace lo mismo que Esc en la confirmación', async () => {
    stubRestBackend();
    await seedUserDataFor(oldConfig);
    connectionStateSignal.value = 'active';
    enterConfigScreen();
    setConfigField('baseUrl', 'https://nuevo.example.com');
    await submitConfig();

    backToEditing();

    expect(configPhaseSignal.value).toBe('editing');
  });
});

describe('Esc', () => {
  it('con la conexión activa y editando, cancela y vuelve a la venta sin guardar', () => {
    connectionStateSignal.value = 'active';

    handleConfigEscape();

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('modo requerido (conexión sin activar): Esc no sale de la pantalla', () => {
    connectionStateSignal.value = 'unconfigured';

    handleConfigEscape();

    expect(activeScreenSignal.value).toBe('config');
  });

  it('durante la prueba cancela la prueba: el resultado tardío se descarta', async () => {
    let resolveFirst: (response: Response) => void = () => undefined;
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        calls += 1;
        if (calls === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(
          okResponse(new URL(url).pathname === '/stock' ? [] : { items: [] }),
        );
      }),
    );
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');
    const pending = submitConfig();
    expect(configPhaseSignal.value).toBe('probing');

    handleConfigEscape();
    expect(configPhaseSignal.value).toBe('editing');
    resolveFirst(okResponse({ items: [] }));
    await pending;

    expect(configPhaseSignal.value).toBe('editing');
    expect(activeScreenSignal.value).toBe('config');
    expect(loadSyncConfig().ok).toBe(false);
  });
});

describe('cancelConfigScreen', () => {
  it('vuelve a la venta sin guardar nada', () => {
    setConfigType('rest');
    setConfigField('baseUrl', 'https://api.example.com');

    cancelConfigScreen();

    expect(activeScreenSignal.value).toBe('sale');
    expect(loadSyncConfig().ok).toBe(false);
  });
});
```

Run: `pnpm vitest run src/ui/keyboard/config-controller.test.ts` → FAIL (el controlador viejo no exporta nada de esto).

- [ ] **Step 3: Controlador — reemplazar `src/ui/keyboard/config-controller.ts`**

```ts
import { applyConnection, flushPendingBeforeWipe } from '../../sync/apply-connection.ts';
import { loadSyncConfig, syncConfigSchema, type SyncConfig } from '../../sync/config.ts';
import {
  planConnectionChange,
  probeConnection,
  type ProbeSnapshot,
} from '../../sync/connection.ts';
import { connectorFields, type ConnectorType } from '../../sync/connector-registry.ts';
import { runSyncCycle } from '../../sync/engine.ts';
import { summarizeLocalData } from '../../storage/local-data.ts';
import { describeError } from '../errors.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import { resetAttachedCustomer } from '../state/customer.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { connectionStateSignal } from '../state/sync.ts';
import {
  configConfirmationSignal,
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configLocaleSignal,
  configPhaseSignal,
  configTypeSignal,
  resetConfigForm,
} from '../state/sync-config.ts';

type PendingApply = { candidate: SyncConfig; snapshot: ProbeSnapshot; wipe: boolean };

/**
 * Token de la prueba en curso: `handleConfigEscape` lo incrementa para
 * cancelar, y la prueba, al volver, descarta su resultado si el token ya no
 * es el suyo (no se cancela el `fetch`, solo se ignora lo que traiga).
 */
let submitToken = 0;
/** Lo que se aplica si el usuario confirma el borrado (fase `confirming`). */
let pendingApply: PendingApply | undefined;

/** `/CONFIG`: abre el formulario, precargado con la config guardada (o vacío si no hay). */
export function enterConfigScreen(): void {
  submitToken += 1;
  pendingApply = undefined;
  const saved = loadSyncConfig();
  resetConfigForm(saved.ok ? saved.value : undefined);
  activeScreenSignal.value = 'config';
}

/** Sale de la pantalla sin guardar nada (solo con la conexión activa; ver `handleConfigEscape`). */
export function cancelConfigScreen(): void {
  submitToken += 1;
  pendingApply = undefined;
  resetConfigForm();
  activeScreenSignal.value = 'sale';
}

/** Vuelve del paso de confirmación a editar el formulario, sin borrar nada. */
export function backToEditing(): void {
  pendingApply = undefined;
  configConfirmationSignal.value = null;
  configPhaseSignal.value = 'editing';
}

/**
 * Esc según la fase: probando → cancela la prueba; confirmando → vuelve a
 * editar; aplicando → se ignora (es corto y no se puede interrumpir); editando
 * → sale, salvo en modo requerido (conexión todavía no activa), donde no hay
 * a dónde salir.
 */
export function handleConfigEscape(): void {
  switch (configPhaseSignal.value) {
    case 'probing':
      submitToken += 1;
      configPhaseSignal.value = 'editing';
      return;
    case 'confirming':
      backToEditing();
      return;
    case 'applying':
      return;
    default:
      if (connectionStateSignal.value === 'active') {
        cancelConfigScreen();
      }
  }
}

function clearConfigError(): void {
  configErrorSignal.value = null;
  configErrorFieldSignal.value = null;
}

/** Cambia el conector elegido — los campos que se muestran cambian en el acto, sin perder lo tipeado en el otro. */
export function setConfigType(type: ConnectorType | null): void {
  configTypeSignal.value = type;
  clearConfigError();
}

/** Edita un campo del conector activo. */
export function setConfigField(key: string, value: string): void {
  const type = configTypeSignal.value;
  if (type === null) {
    return;
  }
  const all = configFieldValuesSignal.value;
  configFieldValuesSignal.value = { ...all, [type]: { ...all[type], [key]: value } };
  clearConfigError();
}

export function setConfigLocale(value: string): void {
  configLocaleSignal.value = value;
  clearConfigError();
}

/**
 * Valida el formulario (solo al confirmar, nunca mientras se tipea) y arma la
 * config candidata. Un valor vacío se omite (un opcional en blanco no se
 * guarda). En caso de error deja el mensaje y el campo señalado en los signals.
 */
function validateForm(): SyncConfig | undefined {
  const type = configTypeSignal.value;
  if (type === null) {
    configErrorSignal.value = 'Elegí un tipo de conexión.';
    return undefined;
  }
  const fields = connectorFields(type);
  const raw = configFieldValuesSignal.value[type];

  const candidate: Record<string, string> = { type };
  for (const field of fields) {
    const value = (raw[field.key] ?? '').trim();
    if (value !== '') {
      candidate[field.key] = value;
    }
  }
  const locale = configLocaleSignal.value.trim();
  if (locale !== '') {
    candidate.locale = locale;
  }

  const parsed = syncConfigSchema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }
  const offendingKey = parsed.error.issues[0]?.path[0];
  const field = fields.find((candidateField) => candidateField.key === offendingKey);
  if (field === undefined) {
    configErrorSignal.value = 'La configuración no es válida.';
    return undefined;
  }
  const isEmpty = (raw[field.key] ?? '').trim() === '';
  configErrorFieldSignal.value = field.key;
  configErrorSignal.value = isEmpty
    ? `Completá «${field.label}».`
    : `«${field.label}» no es válido.`;
  return undefined;
}

async function applyAndFinish(pending: PendingApply): Promise<void> {
  configPhaseSignal.value = 'applying';
  const result = await applyConnection({ ...pending, now: new Date().toISOString() });
  if (!result.ok) {
    configPhaseSignal.value = 'editing';
    configErrorSignal.value = describeError(result);
    return;
  }
  if (pending.wipe) {
    // La venta en curso ya no existe en la base: se vacía también en memoria.
    cartSignal.value = { lines: [] };
    cartSelectionIndexSignal.value = null;
    resetAttachedCustomer();
  }
  pendingApply = undefined;
  resetConfigForm();
  activeScreenSignal.value = 'sale';
  void runSyncCycle();
}

/**
 * Ctrl+Enter: valida, **prueba** la conexión (pull completo en memoria,
 * todo o nada), **planea** (¿cambió el origen? ¿se perderían datos del
 * usuario?) y, según eso, aplica directo o pide confirmación. Nada local ni
 * guardado cambia hasta que la prueba salió bien y, si hace falta, el usuario
 * confirmó el borrado.
 */
export async function submitConfig(): Promise<void> {
  if (configPhaseSignal.value !== 'editing') {
    return;
  }
  const candidate = validateForm();
  if (candidate === undefined) {
    return;
  }

  clearConfigError();
  submitToken += 1;
  const token = submitToken;
  configPhaseSignal.value = 'probing';

  const probe = await probeConnection(candidate);
  if (token !== submitToken) {
    return;
  }
  if (!probe.ok) {
    configPhaseSignal.value = 'editing';
    configErrorSignal.value = describeError(probe);
    return;
  }

  const currentResult = loadSyncConfig();
  const current = currentResult.ok ? currentResult.value : undefined;
  const plan = planConnectionChange({
    current,
    candidate,
    localData: await summarizeLocalData(),
  });
  const pending: PendingApply = { candidate, snapshot: probe.value, wipe: plan.wipe };

  if (!plan.needsConfirmation) {
    await applyAndFinish(pending);
    return;
  }

  // Antes de advertir qué se pierde: un último intento de enviar lo pendiente
  // al backend ACTUAL, así el conteo de "sin enviar" es el que de verdad queda.
  if (current !== undefined && navigator.onLine) {
    await flushPendingBeforeWipe(current);
  }
  const summary = await summarizeLocalData();
  if (token !== submitToken) {
    return;
  }
  pendingApply = pending;
  configConfirmationSignal.value = summary;
  configPhaseSignal.value = 'confirming';
}

/** Enter en la confirmación: borra lo local y aplica la conexión nueva. */
export async function confirmConfigChange(): Promise<void> {
  const pending = pendingApply;
  if (configPhaseSignal.value !== 'confirming' || pending === undefined) {
    return;
  }
  await applyAndFinish(pending);
}
```

Run: `pnpm vitest run src/ui/keyboard/config-controller.test.ts` → PASS (17+ tests). Si el test "origen distinto: envía lo pendiente…" no ve el POST a `viejo.example.com/sales`, revisar que `buildOutboxEventForSale` cree un evento `pending` con `nextAttemptAt` vencido (el envío final usa `ignoreBackoff`, pero el evento tiene que ser de tipo `'sale'`).

- [ ] **Step 4: Tests de la pantalla que fallan — reemplazar `src/ui/screens/config-screen.test.tsx`**

```tsx
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../storage/db.ts';
import { loadSyncConfig, saveSyncConfig } from '../../sync/config.ts';
import { enterConfigScreen } from '../keyboard/config-controller.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { connectionStateSignal } from '../state/sync.ts';
import { ConfigScreen } from './config-screen.tsx';

const WEB_APP_URL = 'https://script.google.com/macros/s/abc/exec';
const CTRL_ENTER = { key: 'Enter', ctrlKey: true };

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) } as Response;
}

function stubRestBackend(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = new URL(url).pathname;
      return Promise.resolve(okResponse(path === '/stock' ? [] : { items: [] }));
    }),
  );
}

beforeEach(async () => {
  await db.open();
  connectionStateSignal.value = 'active';
  enterConfigScreen();
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function typeSelect(): HTMLSelectElement {
  return screen.getByLabelText<HTMLSelectElement>('Tipo de conexión');
}

function chooseRest(): void {
  fireEvent.change(typeSelect(), { target: { value: 'rest' } });
}

describe('ConfigScreen — formulario', () => {
  it('arranca sin tipo elegido y sin ningún campo, solo el selector', () => {
    render(<ConfigScreen />);

    expect(typeSelect().value).toBe('');
    expect(screen.queryByLabelText(/URL del sistema externo/)).toBeNull();
    expect(screen.queryByLabelText(/Locale/)).toBeNull();
  });

  it('el foco arranca en el selector de tipo', () => {
    render(<ConfigScreen />);

    expect(document.activeElement).toBe(typeSelect());
  });

  it('elegir REST muestra sus campos más el locale, sin valores por omisión y con placeholders', () => {
    render(<ConfigScreen />);

    chooseRest();

    const url = screen.getByLabelText<HTMLInputElement>(/URL del sistema externo/);
    expect(url.value).toBe('');
    expect(url.placeholder).toBe('https://api.miempresa.com');
    expect(screen.getByLabelText(/API key/)).not.toBeNull();
    expect(screen.getByLabelText(/Locale/)).not.toBeNull();
  });

  it('cambiar a Google Sheets intercambia los campos sin ocultar el selector', () => {
    render(<ConfigScreen />);
    chooseRest();

    fireEvent.change(typeSelect(), { target: { value: 'google-sheets' } });

    expect(screen.queryByLabelText(/URL del sistema externo/)).toBeNull();
    expect(screen.getByLabelText(/URL del Web App/)).not.toBeNull();
    expect(screen.getByLabelText(/Secreto compartido/)).not.toBeNull();
    expect(typeSelect().value).toBe('google-sheets');
  });

  it('marca como opcionales los campos opcionales', () => {
    render(<ConfigScreen />);
    chooseRest();

    expect(screen.getByLabelText(/API key.*opcional/)).not.toBeNull();
    expect(screen.queryByLabelText(/URL del sistema externo.*opcional/)).toBeNull();
  });

  it('valida solo al confirmar: sin error mientras se tipea, alerta al Ctrl+Enter', () => {
    render(<ConfigScreen />);
    chooseRest();
    const url = screen.getByLabelText(/URL del sistema externo/);

    fireEvent.input(url, { target: { value: 'no-es-una-url' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.keyDown(url, CTRL_ENTER);

    expect(screen.getByRole('alert').textContent).toContain('URL del sistema externo');
    expect(activeScreenSignal.value).toBe('config');
  });

  it('tras un error de validación, el campo queda enfocado y con todo su texto seleccionado', () => {
    render(<ConfigScreen />);
    chooseRest();
    const url = screen.getByLabelText<HTMLInputElement>(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'no-es-una-url' } });

    fireEvent.keyDown(url, CTRL_ENTER);

    expect(document.activeElement).toBe(url);
    expect(url.selectionStart).toBe(0);
    expect(url.selectionEnd).toBe('no-es-una-url'.length);
  });

  it('Enter solo no prueba ni guarda nada', () => {
    stubRestBackend();
    render(<ConfigScreen />);
    chooseRest();
    const url = screen.getByLabelText(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'https://api.example.com' } });

    fireEvent.keyDown(url, { key: 'Enter' });

    expect(loadSyncConfig().ok).toBe(false);
    expect(screen.queryByText(/Probando conexión/)).toBeNull();
  });

  it('precarga la config guardada al abrirse', () => {
    saveSyncConfig({ type: 'google-sheets', webAppUrl: WEB_APP_URL, locale: 'es-AR' });
    enterConfigScreen();

    render(<ConfigScreen />);

    expect(typeSelect().value).toBe('google-sheets');
    expect(screen.getByLabelText<HTMLInputElement>(/URL del Web App/).value).toBe(WEB_APP_URL);
    expect(screen.getByLabelText<HTMLInputElement>(/Locale/).value).toBe('es-AR');
  });
});

describe('ConfigScreen — probar y guardar', () => {
  it('Ctrl+Enter prueba, guarda con verifiedAt y vuelve a la venta', async () => {
    stubRestBackend();
    render(<ConfigScreen />);
    chooseRest();
    const url = screen.getByLabelText(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'https://api.example.com' } });

    fireEvent.keyDown(url, CTRL_ENTER);

    await waitFor(() => expect(activeScreenSignal.value).toBe('sale'));
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value.verifiedAt).toBeTruthy();
  });

  it('muestra "Probando conexión…" mientras espera', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    render(<ConfigScreen />);
    chooseRest();
    const url = screen.getByLabelText(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'https://api.example.com' } });

    fireEvent.keyDown(url, CTRL_ENTER);

    await waitFor(() => expect(screen.getByText('Probando conexión…')).not.toBeNull());
  });

  it('si la prueba falla, muestra el motivo y el formulario queda editable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    render(<ConfigScreen />);
    chooseRest();
    const url = screen.getByLabelText(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'https://api.example.com' } });

    fireEvent.keyDown(url, CTRL_ENTER);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('No se pudo conectar con el servidor'),
    );
    expect(activeScreenSignal.value).toBe('config');
    expect(loadSyncConfig().ok).toBe(false);
  });
});

describe('ConfigScreen — confirmación del borrado', () => {
  async function openConfirmation(): Promise<void> {
    stubRestBackend();
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'https://viejo.example.com',
      verifiedAt: '2025-12-01T00:00:00.000Z',
    });
    await db.sales.put({
      id: 's1',
      lines: [],
      payments: [],
      total: 0,
      status: 'closed',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    enterConfigScreen();
    render(<ConfigScreen />);
    const url = screen.getByLabelText(/URL del sistema externo/);
    fireEvent.input(url, { target: { value: 'https://nuevo.example.com' } });
    fireEvent.keyDown(url, CTRL_ENTER);
    await waitFor(() => expect(screen.getByText(/Cambiar de conexión borra/)).not.toBeNull());
  }

  it('muestra qué se pierde, con los conteos', async () => {
    await openConfirmation();

    expect(screen.getByText(/1 venta/)).not.toBeNull();
    expect(screen.getByText(/Enter borra y cambia de conexión/)).not.toBeNull();
  });

  it('Enter confirma: aplica la conexión nueva y vuelve a la venta', async () => {
    await openConfirmation();

    fireEvent.keyDown(screen.getByText(/Cambiar de conexión borra/), { key: 'Enter' });

    await waitFor(() => expect(activeScreenSignal.value).toBe('sale'));
    await expect(db.sales.count()).resolves.toBe(0);
  });

  it('Esc vuelve a editar sin borrar nada', async () => {
    await openConfirmation();

    fireEvent.keyDown(screen.getByText(/Cambiar de conexión borra/), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByText(/Cambiar de conexión borra/)).toBeNull());
    await expect(db.sales.count()).resolves.toBe(1);
    expect(activeScreenSignal.value).toBe('config');
  });
});

describe('ConfigScreen — modo normal vs. requerido', () => {
  it('con la conexión activa: hay botón Cancelar y Esc sale', () => {
    connectionStateSignal.value = 'active';
    render(<ConfigScreen />);

    expect(screen.getByRole('button', { name: 'Cancelar' })).not.toBeNull();
    fireEvent.keyDown(typeSelect(), { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('sale');
  });

  it('modo requerido: sin Cancelar, con el texto de bienvenida, y Esc no sale', () => {
    connectionStateSignal.value = 'unconfigured';
    render(<ConfigScreen />);

    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    expect(screen.getByText('Configurá y probá la conexión para empezar.')).not.toBeNull();
    fireEvent.keyDown(typeSelect(), { key: 'Escape' });

    expect(activeScreenSignal.value).toBe('config');
  });
});
```

Run: `pnpm vitest run src/ui/screens/config-screen.test.tsx` → FAIL.

- [ ] **Step 5: Pantalla — reemplazar `src/ui/screens/config-screen.tsx`**

```tsx
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ConfigField } from '../../connectors/config-field.ts';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import { CONNECTOR_TYPES, connectorFields } from '../../sync/connector-registry.ts';
import {
  backToEditing,
  cancelConfigScreen,
  confirmConfigChange,
  handleConfigEscape,
  setConfigField,
  setConfigLocale,
  setConfigType,
  submitConfig,
} from '../keyboard/config-controller.ts';
import {
  configConfirmationSignal,
  configErrorFieldSignal,
  configErrorSignal,
  configFieldValuesSignal,
  configLocaleSignal,
  configPhaseSignal,
  configTypeSignal,
  type ConfigPhase,
} from '../state/sync-config.ts';
import { connectionStateSignal } from '../state/sync.ts';

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
  maxWidth: '560px',
  background: 'var(--color-bg)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-4)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-3)',
  color: 'var(--color-text)',
  fontFamily: 'var(--font-sans)',
  outline: 'none',
};

const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-2)' };

const controlStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-base)',
  padding: 'var(--space-2)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
};

const buttonStyle = {
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 'var(--radius-md)',
  whiteSpace: 'nowrap' as const,
};

/** `locale` es config de terminal, no de un conector: vive aparte y va siempre al final. */
const LOCALE_FIELD: ConfigField = {
  key: 'locale',
  label: 'Locale (ej. es-AR — en blanco usa el del navegador)',
  optional: true,
  placeholder: 'es-AR',
};

function fieldLabel(field: ConfigField): string {
  return field.optional ? `${field.label} (opcional)` : field.label;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

/** Lo que se perdería, en una línea: solo lo que existe. */
function describeLocalDataLoss(summary: LocalDataSummary): string {
  const parts: string[] = [];
  if (summary.sales > 0) parts.push(plural(summary.sales, 'venta', 'ventas'));
  if (summary.cashSessions > 0) parts.push(plural(summary.cashSessions, 'turno de caja', 'turnos de caja'));
  if (summary.draftCartLines > 0) parts.push('la venta en curso');
  if (summary.products > 0) parts.push(plural(summary.products, 'producto', 'productos'));
  if (summary.customers > 0) parts.push(plural(summary.customers, 'cliente', 'clientes'));
  return parts.join(' · ');
}

function ConfirmationCard({ summary }: { summary: LocalDataSummary }) {
  return (
    <div
      style={{
        border: '1px solid var(--color-danger)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      <p style={{ margin: 0, fontWeight: 'bold' }}>
        Cambiar de conexión borra los datos de esta terminal
      </p>
      <p style={{ margin: 0 }}>Se van a borrar: {describeLocalDataLoss(summary)}.</p>
      {summary.pendingOutbox > 0 && (
        <p style={{ margin: 0, fontWeight: 'bold', color: 'var(--color-danger)' }}>
          {plural(summary.pendingOutbox, 'evento sin enviar', 'eventos sin enviar')} al backend
          actual ({plural(summary.pendingSales, 'venta', 'ventas')}) se perderán.
        </p>
      )}
      <p style={{ margin: 0 }}>La caja empieza limpia con la conexión nueva.</p>
    </div>
  );
}

function footerHint(phase: ConfigPhase, required: boolean): string {
  switch (phase) {
    case 'confirming':
      return 'Enter borra y cambia de conexión · Esc vuelve a editar.';
    case 'probing':
      return 'Esc cancela la prueba.';
    case 'applying':
      return '';
    default:
      return required
        ? 'Tab para moverte entre campos, Ctrl+Enter para probar y guardar.'
        : 'Tab para moverte entre campos, Ctrl+Enter para probar y guardar, Esc para cancelar.';
  }
}

/**
 * `/CONFIG` como diálogo modal con fases (Etapa 2b, #76): editar → probar la
 * conexión → (confirmar el borrado de lo local, si cambia el origen y hay
 * datos del usuario) → aplicar. Tab/Shift+Tab (nativo) navega, Ctrl+Enter
 * prueba y guarda todo junto, Esc según la fase (ver `handleConfigEscape`);
 * Enter solo confirma el borrado en la fase de confirmación. Los atajos se
 * atienden en el contenedor (los eventos suben desde los campos), así siguen
 * llegando aunque el foco pase al contenedor en las fases sin campos
 * editables. Con la conexión todavía no activa es el **modo requerido**: no
 * hay "Cancelar" ni salida hasta tener una conexión probada.
 */
export function ConfigScreen() {
  const typeRef = useRef<HTMLSelectElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const phase = configPhaseSignal.value;
  const required = connectionStateSignal.value !== 'active';
  const errorField = configErrorFieldSignal.value;
  const error = configErrorSignal.value;
  const type = configTypeSignal.value;
  const editing = phase === 'editing';

  // Foco: editando va al selector; en las demás fases al contenedor, para que
  // Esc/Enter sigan llegando aunque los campos queden de solo lectura.
  // `useLayoutEffect` (no `useSignalEffect`, que corre diferido y dejó una
  // ventana de carrera en la Etapa 2).
  useLayoutEffect(() => {
    if (phase === 'editing') {
      typeRef.current?.focus();
    } else {
      dialogRef.current?.focus();
    }
  }, [phase]);

  // Un error apunta a un campo concreto: enfocarlo y seleccionarlo permite
  // retipear de una. Declarado después del efecto de fase: si cambian juntos, gana este.
  useLayoutEffect(() => {
    if (errorField === null || error === null) {
      return;
    }
    const input = dialogRef.current?.querySelector<HTMLInputElement>(
      `[data-config-field="${errorField}"]`,
    );
    input?.focus();
    input?.select();
  }, [errorField, error]);

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleConfigEscape();
      return;
    }
    if (event.key === 'Enter' && event.ctrlKey && phase === 'editing') {
      event.preventDefault();
      void submitConfig();
      return;
    }
    if (event.key === 'Enter' && phase === 'confirming') {
      event.preventDefault();
      void confirmConfigChange();
    }
  };

  const handleTypeChange = (event: TargetedEvent<HTMLSelectElement>) => {
    const chosen = CONNECTOR_TYPES.find((info) => info.type === event.currentTarget.value);
    setConfigType(chosen?.type ?? null);
  };

  const values = type === null ? undefined : configFieldValuesSignal.value[type];
  const visibleFields = type === null ? [] : [...connectorFields(type), LOCALE_FIELD];
  const confirmation = configConfirmationSignal.value;

  return (
    <div style={overlayStyle}>
      <div ref={dialogRef} tabIndex={-1} onKeyDown={handleKeyDown} style={dialogStyle}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Configurar conexión</h1>
        {required && (
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            Configurá y probá la conexión para empezar.
          </p>
        )}

        {phase === 'confirming' && confirmation !== null ? (
          <ConfirmationCard summary={confirmation} />
        ) : (
          <>
            <label style={fieldStyle}>
              <span>Tipo de conexión</span>
              <select
                ref={typeRef}
                value={type ?? ''}
                onChange={handleTypeChange}
                disabled={!editing}
                aria-label="Tipo de conexión"
                style={controlStyle}
              >
                <option value="">Elegí un tipo de conexión…</option>
                {CONNECTOR_TYPES.map((info) => (
                  <option key={info.type} value={info.type}>
                    {info.label}
                  </option>
                ))}
              </select>
            </label>

            {visibleFields.map((field) => {
              const isLocale = field.key === 'locale';
              const value = isLocale ? configLocaleSignal.value : (values?.[field.key] ?? '');
              return (
                <label key={`${type ?? ''}:${field.key}`} style={fieldStyle}>
                  <span>{fieldLabel(field)}</span>
                  <input
                    type="text"
                    value={value}
                    readOnly={!editing}
                    placeholder={field.placeholder}
                    onInput={(event) => {
                      if (isLocale) {
                        setConfigLocale(event.currentTarget.value);
                      } else {
                        setConfigField(field.key, event.currentTarget.value);
                      }
                    }}
                    data-config-field={field.key}
                    aria-label={fieldLabel(field)}
                    style={{
                      ...controlStyle,
                      borderColor:
                        errorField === field.key ? 'var(--color-danger)' : 'var(--color-border)',
                    }}
                  />
                </label>
              );
            })}
          </>
        )}

        <div style={{ minHeight: 'var(--space-8)' }}>
          {phase === 'probing' && <p role="status" style={{ margin: 0 }}>Probando conexión…</p>}
          {phase === 'applying' && <p role="status" style={{ margin: 0 }}>Aplicando conexión…</p>}
          {editing && error !== null && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>
              {error}
            </p>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}
        >
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{footerHint(phase, required)}</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            {phase === 'confirming' ? (
              <>
                <button type="button" onClick={backToEditing} style={buttonStyle}>
                  Volver
                </button>
                <button type="button" onClick={() => void confirmConfigChange()} style={buttonStyle}>
                  Borrar y cambiar
                </button>
              </>
            ) : (
              <>
                {!required && (
                  <button type="button" onClick={cancelConfigScreen} disabled={!editing} style={buttonStyle}>
                    Cancelar
                  </button>
                )}
                <button type="button" onClick={() => void submitConfig()} disabled={!editing} style={buttonStyle}>
                  Probar y guardar
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

Run: `pnpm vitest run src/ui/screens/config-screen.test.tsx src/ui/keyboard/config-controller.test.ts` → PASS. Puntos donde suele haber que ajustar: (a) `getByLabelText<HTMLSelectElement>` con genérico (ya usado en la Etapa 2, el lint prohíbe `as` innecesarios); (b) si `fireEvent.keyDown(screen.getByText(/Cambiar de conexión borra/), …)` no llega al contenedor, verificar que el `<p>` esté dentro del `div` con `onKeyDown`; (c) `role="alert"` debe existir una sola vez por vez en cada fase.

- [ ] **Step 6: Adaptar los dos e2e que recorren el formulario**

`e2e/minibackend-sync.spec.ts`: reemplazar el tramo que va desde `const urlInput = page.getByLabel(/URL del sistema externo/);` hasta `await expect(commandBar).toBeVisible();` (justo antes de `/SINCRONIZAR`), **conservando el comentario largo sobre el Bearer token**, por:

```ts
  // Sin valores por omisión (Etapa 2b): hay que elegir el tipo y tipear la URL.
  await page.getByLabel('Tipo de conexión').selectOption('rest');
  await page.getByLabel(/URL del sistema externo/).fill(BACKEND_URL);

  // (comentario existente sobre por qué hace falta un Bearer token no vacío)
  const apiKeyInput = page.getByLabel(/API key/);
  await apiKeyInput.fill('demo-api-key');

  // Ctrl+Enter prueba la conexión (pull completo) y, si sale bien, la guarda:
  // el catálogo llega en este mismo paso, no hace falta un sync aparte.
  await apiKeyInput.press('Control+Enter');
  await expect(commandBar).toBeVisible();
```

`e2e/config-connector.spec.ts`:
- En el `beforeEach`, reemplazar el `route.abort()` por una respuesta exitosa del puente (con CORS), porque ahora guardar **prueba** la conexión:

```ts
test.beforeEach(async ({ page }) => {
  // El puente de Sheets simulado: toda acción responde OK con listas vacías.
  await page.route('https://script.google.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok: true, data: { items: [] } }),
    }),
  );
});
```

- En el primer test, después de `typeSelect.press('G')` todo sigue igual (el selector ahora arranca vacío, pero el type-ahead "G" elige Google Sheets). Al final, en vez de comparar el JSON completo guardado, verificar el contenido y la prueba:

```ts
  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  const parsed = JSON.parse(stored ?? 'null') as Record<string, unknown>;
  expect(parsed).toMatchObject({ type: 'google-sheets', webAppUrl: WEB_APP_URL });
  expect(parsed.verifiedAt).toBeTruthy();
```

- En el test `'Esc cancela sin guardar'`, elegir el tipo antes de llenar la URL (el formulario arranca sin campos): agregar `await page.getByLabel('Tipo de conexión').selectOption('rest');` antes del `fill`.

Run (puertos 4000 y 4173 libres): `pnpm test:e2e e2e/config-connector.spec.ts e2e/minibackend-sync.spec.ts e2e/keyboard-only.spec.ts`
Expected: PASS. Repetir el de config 10 veces: `pnpm exec playwright test e2e/config-connector.spec.ts --repeat-each=10 --reporter=dot`.

- [ ] **Step 7: Verificar todo y commitear**

Run: `grep -rn "DEFAULT_BASE_URL\|DEFAULT_API_KEY\|configStepSignal\|submitConfigStep" src e2e` (esperado: sin resultados); `pnpm test; pnpm typecheck; pnpm lint`; `pnpm prettier --check --end-of-line auto src/ui/state/sync-config.ts src/ui/keyboard/config-controller.ts src/ui/keyboard/config-controller.test.ts src/ui/screens/config-screen.tsx src/ui/screens/config-screen.test.tsx e2e/config-connector.spec.ts`.
Expected: verde.

```bash
git add -A src e2e
git commit -m "feat: /CONFIG con fases — probar, confirmar el borrado y aplicar la conexión (#76)

Sin valores por omisión, selector sin tipo elegido, modo requerido sin salida.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Fixture e2e con una conexión activa sembrada

Se hace **antes** del bloqueo de arranque (Task 11) para que los e2e sigan verdes: cuando el bloqueo exista, los specs que ejercitan la app ya conectada (y offline) arrancan con una config `active`.

**Files:**
- Create: `e2e/fixtures.ts`
- Modify: `e2e/account-sale.spec.ts`, `e2e/cart-persistence.spec.ts`, `e2e/cash-session.spec.ts`, `e2e/keyboard-only.spec.ts`, `e2e/offline-sale.spec.ts`, `e2e/void-sale.spec.ts` (solo la línea de import)

**Interfaces:**
- Consumes: `SyncConfig.verifiedAt` (Task 2).
- Produces: `e2e/fixtures.ts` exporta `test` (el de Playwright con la config sembrada), `expect`, `ACTIVE_CONFIG` y `CONFIG_STORAGE_KEY`.

- [ ] **Step 1: Crear `e2e/fixtures.ts`**

```ts
import { test as base, expect } from '@playwright/test';

export const CONFIG_STORAGE_KEY = 'offline-pos:sync-config';

/**
 * Conexión `active` (con `verifiedAt`) apuntando a un backend inalcanzable: es
 * lo que necesitan los specs que ejercitan la app ya conectada y 100% offline
 * (sin backend real). Desde la Etapa 2b una terminal sin conexión activa solo
 * muestra `/CONFIG`, así que sin esto ningún spec llegaría a la venta. El sync
 * contra el puerto 9 falla en silencio (estado `sync-error`) sin molestar.
 */
export const ACTIVE_CONFIG = {
  type: 'rest',
  baseUrl: 'http://127.0.0.1:9',
  verifiedAt: '2026-01-01T00:00:00.000Z',
};

/** `test` de Playwright que siembra `ACTIVE_CONFIG` antes de que cargue la app (en cada navegación). */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(
      ({ key, config }) => {
        localStorage.setItem(key, JSON.stringify(config));
      },
      { key: CONFIG_STORAGE_KEY, config: ACTIVE_CONFIG },
    );
    await use(page);
  },
});

export { expect };
```

- [ ] **Step 2: Cambiar el import de los seis specs**

Run: `grep -n "@playwright/test" e2e/*.spec.ts` para ver la línea exacta de cada uno. En los seis listados arriba, `import { expect, test } from '@playwright/test';` pasa a `import { expect, test } from './fixtures.ts';` (si alguno importa algo más de `@playwright/test`, como `type Page`, dejar ese import aparte y mover solo `expect`/`test`):

```bash
sed -i "s#import { expect, test } from '@playwright/test';#import { expect, test } from './fixtures.ts';#" e2e/account-sale.spec.ts e2e/cart-persistence.spec.ts e2e/cash-session.spec.ts e2e/keyboard-only.spec.ts e2e/offline-sale.spec.ts e2e/void-sale.spec.ts
grep -n "fixtures.ts" e2e/*.spec.ts
```
Expected: los seis aparecen; ninguno sigue importando `test` de `@playwright/test`.

- [ ] **Step 3: Verificar y commitear**

Con los puertos 4000 y 4173 libres: `pnpm test:e2e`
Expected: la suite completa pasa (el bloqueo todavía no existe, la config sembrada es inofensiva).

```bash
git add -A e2e
git commit -m "test: fixture e2e que siembra una conexión activa (#76)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Bloqueo de arranque — `App` y `bootstrap`

**Files:**
- Modify: `src/ui/app.tsx`, `src/ui/app.test.tsx`, `src/ui/bootstrap.ts`, `src/ui/bootstrap.test.ts`

**Interfaces:**
- Consumes: `connectionState` (Task 2), `connectionStateSignal`/`setConnectionState` (Task 2), `resetConfigForm` (Task 9), `ConfigScreen` en modo requerido (Task 9).
- Produces: sin conexión `active`, `App` muestra **solo** `ConfigScreen`; `bootstrap()` calcula el estado desde la config guardada y precarga el formulario si la conexión no está activa.

- [ ] **Step 1: Tests que fallan**

`src/ui/app.test.tsx`: sumar `import { connectionStateSignal } from './state/sync.ts';`, poner `connectionStateSignal.value = 'active';` en el `beforeEach` existente (para que los tests actuales sigan viendo la venta) y agregar:

```tsx
describe('App (Etapa 2b: bloqueo de arranque)', () => {
  it.each(['unconfigured', 'unverified'] as const)(
    'con la conexión %s muestra solo la configuración: no hay pantalla de venta ni barra de comandos',
    (state) => {
      connectionStateSignal.value = state;

      render(<App />);

      expect(screen.getByRole('heading', { name: 'Configurar conexión' })).not.toBeNull();
      expect(screen.queryByLabelText('Barra de comandos')).toBeNull();
    },
  );

  it('con la conexión activa muestra la pantalla de venta', () => {
    connectionStateSignal.value = 'active';

    render(<App />);

    expect(screen.getByLabelText('Barra de comandos')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Configurar conexión' })).toBeNull();
  });
});
```

`src/ui/bootstrap.test.ts`: sumar imports de `saveSyncConfig` (`'../sync/config.ts'`), `connectionStateSignal` (`'./state/sync.ts'`), `configTypeSignal`/`configFieldValuesSignal` (`'./state/sync-config.ts'`) y agregar dentro del `describe('bootstrap', …)`:

```ts
  it('sin config guardada: la conexión queda unconfigured', async () => {
    await bootstrap();

    expect(connectionStateSignal.value).toBe('unconfigured');
  });

  it('con una config sin verifiedAt (por ejemplo, la guardada antes de la Etapa 2b): unverified y el formulario queda precargado', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'https://api.example.com' });

    await bootstrap();

    expect(connectionStateSignal.value).toBe('unverified');
    expect(configTypeSignal.value).toBe('rest');
    expect(configFieldValuesSignal.value.rest.baseUrl).toBe('https://api.example.com');
  });

  it('con una config con verifiedAt: active', async () => {
    saveSyncConfig({
      type: 'rest',
      baseUrl: 'https://api.example.com',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });

    await bootstrap();

    expect(connectionStateSignal.value).toBe('active');
  });
```

Run: `pnpm vitest run src/ui/app.test.tsx src/ui/bootstrap.test.ts` → FAIL.

- [ ] **Step 2: Implementación**

`src/ui/app.tsx`: importar `connectionStateSignal` desde `'./state/sync.ts'` y, al principio de `ActiveScreen`, antes del `switch`:

```tsx
function ActiveScreen() {
  // Etapa 2b (#76): sin una conexión activa no hay ninguna otra pantalla
  // posible — ni venta ni barra de comandos. La única salida es probar una
  // conexión en `/CONFIG` (modo requerido: sin Cancelar y Esc no sale).
  if (connectionStateSignal.value !== 'active') {
    return <ConfigScreen />;
  }
  switch (activeScreenSignal.value) {
```
(el resto del `switch` queda igual).

`src/ui/bootstrap.ts`: agregar imports `connectionState` (`'../sync/connection-state.ts'`), `loadSyncConfig` (`'../sync/config.ts'`), `setConnectionState` (`'./state/sync.ts'`), `resetConfigForm` (`'./state/sync-config.ts'`), y al final de `bootstrap()`, **antes** de `startSyncEngine()`:

```ts
  // Etapa 2b (#76): sin una conexión probada la app solo muestra `/CONFIG`
  // (ver `ui/app.tsx`). Si hay una config guardada pero sin probar (por ejemplo
  // la de antes de 2b), el formulario abre precargado para que un Ctrl+Enter
  // alcance — el origen no cambia, así que no se pierde ningún dato.
  const configResult = loadSyncConfig();
  const state = connectionState(configResult);
  setConnectionState(state);
  if (state !== 'active') {
    resetConfigForm(configResult.ok ? configResult.value : undefined);
  }
```

Actualizar además el comentario de cabecera de `bootstrap()` (frase "una terminal recién instalada, sin `/CONFIG` configurado todavía, arranca vacía hasta el primer sync") para decir que ahora arranca directamente en `/CONFIG` hasta probar una conexión.

- [ ] **Step 3: Verificar y commitear**

Run: `pnpm test; pnpm typecheck; pnpm lint` y, con puertos libres, `pnpm test:e2e`.
Expected: verde. Los e2e que estaban en `@playwright/test` puro (`config-connector`, `minibackend-sync`) fallan en este punto porque abren `/CONFIG` desde la barra de comandos y ahora la app arranca en la pantalla de configuración: se arreglan en el Task 12; **no commitear con ellos en rojo** — hacer el Task 12 antes del commit, o adaptarlos mínimamente acá. Recomendado: commitear Tasks 11 y 12 seguidos, corriendo la suite completa recién al final del 12.

```bash
git add -A src
git commit -m "feat: sin conexión activa la app solo muestra /CONFIG (#76)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: e2e del ciclo de vida de la conexión

**Files:**
- Modify: `e2e/minibackend-sync.spec.ts`, `e2e/config-connector.spec.ts`
- Create: `e2e/connection-lifecycle.spec.ts`

**Interfaces:**
- Consumes: todo lo anterior; `putIntoStore`/`getAllFromStore` (`e2e/indexed-db.ts`), `test`/`expect`/`ACTIVE_CONFIG` (`e2e/fixtures.ts`).
- Produces: cobertura e2e del arranque bloqueado, la prueba fallida, la config vieja y el cambio de conector con advertencia.

- [ ] **Step 1: `minibackend-sync.spec.ts` — arranca directo en la configuración**

Reemplazar el tramo que va desde `await page.goto('/');` hasta justo antes de `await commandBar.fill('/SINCRONIZAR');` por (conservando el comentario largo sobre el Bearer token del minibackend):

```ts
  await page.goto('/');
  // Sin config guardada la app abre directo en /CONFIG (modo requerido, Etapa 2b).
  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();

  // Sin valores por omisión: hay que elegir el tipo y tipear la URL.
  await page.getByLabel('Tipo de conexión').selectOption('rest');
  await page.getByLabel(/URL del sistema externo/).fill(BACKEND_URL);

  // (comentario existente sobre por qué hace falta un Bearer token no vacío)
  const apiKeyInput = page.getByLabel(/API key/);
  await apiKeyInput.fill('demo-api-key');

  // Ctrl+Enter prueba la conexión (pull completo) y, si sale bien, la guarda:
  // el catálogo llega en este mismo paso.
  await apiKeyInput.press('Control+Enter');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

```

(y borrar la declaración previa de `commandBar`, si quedó duplicada.)

- [ ] **Step 2: `config-connector.spec.ts` — con conexión activa sembrada**

Cambiar el import de `test`/`expect` a `'./fixtures.ts'` (queda `import { expect, test } from './fixtures.ts';` y `import type { Page } from '@playwright/test';`). El primer test y el de Esc se quedan; **borrar** el test `'una config guardada por una versión anterior…'` (se cubre en el spec nuevo). Ajustes:
- El primer test: como ahora arranca con la config REST activa de `ACTIVE_CONFIG`, el formulario abre en REST precargado; `typeSelect.press('G')` sigue eligiendo Google Sheets. Todo lo demás igual (el puente simulado del `beforeEach` responde OK).
- El test de Esc: la config activa hace que el formulario abra en REST con `http://127.0.0.1:9`; tipear una URL nueva y Esc no debe cambiar lo guardado:

```ts
test('Esc cancela sin guardar', async ({ page }) => {
  await page.goto('/');
  await openConfig(page);
  await page.getByLabel(/URL del sistema externo/).fill('http://localhost:9999');

  await page.keyboard.press('Escape');

  await expect(page.getByLabel('Barra de comandos')).toBeFocused();
  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(stored).toContain('127.0.0.1:9');
  expect(stored).not.toContain('9999');
});
```

- [ ] **Step 3: Spec nuevo `e2e/connection-lifecycle.spec.ts`**

```ts
import { expect, test } from '@playwright/test';
import { getAllFromStore, putIntoStore } from './indexed-db.ts';

const STORAGE_KEY = 'offline-pos:sync-config';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

/** Backend REST simulado en http://backend.test: OPTIONS, productos/stock/clientes vacíos. */
async function routeRestBackend(page: import('@playwright/test').Page): Promise<void> {
  await page.route('http://backend.test/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify(path === '/stock' ? [] : { items: [] }),
    });
  });
}

/** Puente de Sheets simulado: un producto propio, sin clientes. */
async function routeSheetsBridge(page: import('@playwright/test').Page): Promise<void> {
  await page.route('https://script.google.com/**', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { action: string } | null;
    const data =
      body?.action === 'pullProducts'
        ? {
            items: [
              {
                id: 'sheet-p1',
                sku: 'SHEET-1',
                barcodes: [],
                name: 'Producto de la planilla',
                price: 500,
                taxRate: 0.21,
                category: 'x',
              },
            ],
          }
        : { items: [] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify({ ok: true, data }),
    });
  });
}

test('sin config guardada la app abre directo en /CONFIG y no hay forma de salir', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(page.getByText('Configurá y probá la conexión para empezar.')).toBeVisible();
  await expect(page.getByLabel('Barra de comandos')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0);

  await page.keyboard.press('Escape');

  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(page.getByLabel('Barra de comandos')).toHaveCount(0);
});

test('una prueba fallida deja el modal abierto con lo tipeado y no guarda nada', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Tipo de conexión').selectOption('rest');
  await page.getByLabel(/URL del sistema externo/).fill('http://127.0.0.1:9');

  await page.keyboard.press('Control+Enter');

  await expect(page.getByRole('alert')).toContainText('No se pudo conectar con el servidor');
  await expect(page.getByLabel(/URL del sistema externo/)).toHaveValue('http://127.0.0.1:9');
  await expect(page.getByLabel('Barra de comandos')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
});

test('una config guardada antes de la Etapa 2b (sin type ni verifiedAt) pide probarla una vez, precargada', async ({
  page,
}) => {
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({ baseUrl: 'http://backend.test', apiKey: 'clave-vieja' }),
    );
  }, STORAGE_KEY);
  await routeRestBackend(page);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(page.getByLabel('Tipo de conexión')).toHaveValue('rest');
  await expect(page.getByLabel(/URL del sistema externo/)).toHaveValue('http://backend.test');
  await expect(page.getByLabel(/API key/)).toHaveValue('clave-vieja');

  await page.keyboard.press('Control+Enter');

  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  const stored = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)) ?? 'null') as Record<string, unknown>;
  expect(stored.verifiedAt).toBeTruthy();
  expect(stored.type).toBe('rest');
});

test('cambiar de conector con datos: advierte qué se pierde, y al confirmar borra y carga lo nuevo', async ({
  page,
}) => {
  await routeRestBackend(page);
  await routeSheetsBridge(page);

  // Primer arranque contra el backend REST simulado.
  await page.goto('/');
  await page.getByLabel('Tipo de conexión').selectOption('rest');
  await page.getByLabel(/URL del sistema externo/).fill('http://backend.test');
  await page.keyboard.press('Control+Enter');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  // Datos del usuario que se perderían: una venta cerrada.
  await putIntoStore(page, 'sales', {
    id: 'e2e-sale-1',
    lines: [],
    payments: [],
    total: 0,
    status: 'closed',
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  // Cambiar a Google Sheets.
  await commandBar.fill('/CONFIG');
  await commandBar.press('Enter');
  await page.getByLabel('Tipo de conexión').selectOption('google-sheets');
  await page.getByLabel(/URL del Web App/).fill('https://script.google.com/macros/s/e2e/exec');
  await page.keyboard.press('Control+Enter');

  await expect(page.getByText('Cambiar de conexión borra los datos de esta terminal')).toBeVisible();
  await expect(page.getByText(/1 venta/)).toBeVisible();
  // Todavía no cambió nada.
  expect(await getAllFromStore(page, 'sales')).toHaveLength(1);

  await page.keyboard.press('Enter');

  await expect(commandBar).toBeVisible();
  expect(await getAllFromStore(page, 'sales')).toHaveLength(0);
  const products = await getAllFromStore<{ name: string }>(page, 'products');
  expect(products.map((product) => product.name)).toEqual(['Producto de la planilla']);
});

test('Esc en la confirmación vuelve a editar sin borrar nada', async ({ page }) => {
  await routeRestBackend(page);
  await routeSheetsBridge(page);
  await page.goto('/');
  await page.getByLabel('Tipo de conexión').selectOption('rest');
  await page.getByLabel(/URL del sistema externo/).fill('http://backend.test');
  await page.keyboard.press('Control+Enter');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();
  await putIntoStore(page, 'sales', {
    id: 'e2e-sale-1',
    lines: [],
    payments: [],
    total: 0,
    status: 'closed',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  await commandBar.fill('/CONFIG');
  await commandBar.press('Enter');
  await page.getByLabel('Tipo de conexión').selectOption('google-sheets');
  await page.getByLabel(/URL del Web App/).fill('https://script.google.com/macros/s/e2e/exec');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('Cambiar de conexión borra los datos de esta terminal')).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByLabel(/URL del Web App/)).toBeVisible();
  expect(await getAllFromStore(page, 'sales')).toHaveLength(1);
});
```

- [ ] **Step 4: Correr, repetir y commitear**

Con los puertos 4000 y 4173 libres:
`pnpm test:e2e` → la suite completa pasa.
`pnpm exec playwright test e2e/connection-lifecycle.spec.ts e2e/config-connector.spec.ts --repeat-each=10 --reporter=dot` → sin fallas (los tiempos de la prueba/confirmación son justo el tipo de cosa que se rompe a veces).
Si el foco tras la confirmación no llega a Enter (el `keyboard.press('Enter')` no dispara `confirmConfigChange`), verificar que el foco esté en el contenedor (`useLayoutEffect` de fase en `config-screen.tsx`).

```bash
git add -A e2e
git commit -m "test: e2e del ciclo de vida de la conexión (#76)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Documentación, verificación final y PR

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Actualizar `CLAUDE.md`**

Ubicar los pasajes: `grep -n "/CONFIG\` (configura\|Barra de estado\|sin \`/CONFIG\`\|se configura por terminal vía\|Conectores plugin (epic" CLAUDE.md`. Cambios:

1. **Comando `/CONFIG`** (lista de comandos de "UX keyboard-first"): reemplazar "abre precargado con la config guardada, o con los defaults del demo si no hay ninguna" por: "abre precargado con la config guardada (vacío y sin tipo elegido si no hay ninguna: no hay valores por omisión); Ctrl+Enter no solo valida sino que **prueba la conexión** (pull completo en memoria) y, si cambia el origen y hay datos del usuario, pide confirmar el borrado de lo local antes de aplicar — ver 'Ciclo de vida de la conexión'".
2. **Nueva sección "Ciclo de vida de la conexión (Etapa 2b)"** debajo de "Connector API": estados `unconfigured`/`unverified`/`active` (`verifiedAt` en `SyncConfig`, `sync/connection-state.ts`); `App` muestra solo `/CONFIG` en modo requerido (sin Cancelar, Esc no sale) hasta tener una conexión `active`, sin depender de la conectividad (offline-first intacto); flujo probar (`sync/connection.ts::probeConnection`, todo o nada, con tiempo máximo) → planear (`planConnectionChange`; origen = endpoint normalizado, el `type` no cuenta) → confirmar (solo si se pierden datos del usuario: ventas, turnos, pendientes del outbox, venta en curso; con un último intento de envío al conector actual) → aplicar (`sync/apply-connection.ts::applyConnection`: una transacción Dexie sobre `db.tables`, cursores reiniciados, config guardada **al final** con `verifiedAt`; toma el cerrojo de `sync/engine.ts`); riesgo residual aceptado del guardado en `localStorage`; las terminales con config anterior a 2b pasan una vez por `/CONFIG` (precargada, sin borrar nada).
3. **Barra de estado**: el estado `sync-error` ahora también aparece cuando falla cualquier pull (#53), con el motivo traducido (`lastSyncFailureSignal`) y, en `online-idle`, lo que hay en la base local (`localCatalogCountsSignal`); `syncOnce` devuelve un `SyncReport`. Errores de red legibles en `ui/errors.ts` (conectividad, 401/403, 404, timeout, error del puente de Sheets `sync/remote-error`).
4. **Terminal nueva** (párrafo de `/DEMO_RESET` y de `ui/bootstrap.ts`): "arranca vacía hasta el primer sync" pasa a "arranca directamente en `/CONFIG` hasta probar una conexión".
5. **Estado del proyecto**, bullet de "Conectores plugin": agregar Etapa 2b (#76) — conexión verificada, bloqueo de arranque, sin defaults, estado de sync honesto (cierra #53); y que la Etapa 2c (#77, comandos por conector) sigue pendiente.
6. **Testing**: mencionar `e2e/fixtures.ts` (config `active` sembrada para los specs offline) y `src/test/fake-connector.ts`.

- [ ] **Step 2: Verificación final completa**

Con los puertos 4000 y 4173 libres:

```bash
pnpm test; pnpm typecheck; pnpm typecheck:backend; pnpm lint; pnpm test:backend
pnpm test:e2e
git diff --stat origin/main...HEAD | tail -5
grep -rn "DEFAULT_BASE_URL\|DEFAULT_API_KEY\|submitConfigStep" src e2e
```
Expected: todo verde; el diff solo toca lo listado en "File Structure" (más lo de la Etapa 2 si su PR todavía no está mergeado); el `grep` no devuelve nada.

- [ ] **Step 3: Commit, push y PR**

```bash
git add CLAUDE.md
git commit -m "docs: ciclo de vida de la conexión (Etapa 2b) en CLAUDE.md (#76)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -u origin claude/conexion-verificada-2b
gh pr view 75 --json state --jq .state
```

Si el PR #75 (Etapa 2) está `MERGED`: `gh pr create --base main --head claude/conexion-verificada-2b`. Si sigue `OPEN`: `gh pr create --base claude/sheets-connector-stage-2 --head claude/conexion-verificada-2b` (GitHub lo re-apunta a `main` cuando #75 se mergee). Título: `feat: conexión verificada — probar, limpiar al cambiar de origen y estado de sync honesto (#76)`. Cuerpo: resumen de las decisiones, plan de pruebas (unitarios, e2e, repeticiones), qué necesita prueba manual del usuario (la prueba real contra su planilla y el minibackend, y el cambio REST→Sheets con ventas cargadas), `Closes #76`, `Closes #53`, parte de #66, y `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Después: `mcp__ccd_pr__bind_pr` con la URL y `mcp__ccd_pr__get_status` para leer el CI (no hacer polling con `gh`), y una `PushNotification` breve avisando que terminó.

---

## Self-Review

**Spec coverage (Parte 1 del spec):**
- 1.1 estados y `verifiedAt` → Task 2 (+ migración de terminales existentes en Tasks 2, 11 y e2e del Task 12).
- 1.2 bloqueo de arranque, modo requerido, engine sin ciclos sin `active`, offline-first → Tasks 4 (gating del motor), 9 (modo requerido), 11 (`App`), 12 (e2e).
- 1.3 sin defaults, placeholders, selector sin tipo → Tasks 8 y 9.
- 1.4 aplicar conexión (probar, planear, confirmar con envío previo, aplicar transaccional con cerrojo, config al final, fases del modal, Esc por fase) → Tasks 6, 7 y 9; `demoReset` reutiliza `clearAllTables` → Task 3.
- 1.5 estado de sync honesto (#53), señales y barra → Tasks 2, 4 y 5.
- 1.6 errores de red legibles y `sync/timeout` → Task 1 (el timeout lo produce `withTimeout`, Task 6).
- 1.7 impacto en tests existentes → Tasks 4 (engine), 10 (fixture e2e), 9 y 12 (specs de `/CONFIG`).
- Testing del spec → cada task trae sus tests; la aplicación transaccional (la más importante) es el Task 7.
- Fuera de alcance respetado: sin base por conexión, sin re-verificación periódica.

**Placeholder scan:** sin TBD/TODO. Los puntos donde el ejecutor debe mirar el archivo real están acotados y nombrados (firmas de `buildOutboxEventForSale`, el comentario largo del Bearer token que se conserva, la línea exacta de import de cada spec).

**Type consistency:** `LocalDataSummary`/`hasUserData` (Task 3) → `planConnectionChange` (6), `ConfirmationCard` y controlador (9). `ProbeSnapshot`/`withTimeout` (6) → `applyConnection`/`flushPendingBeforeWipe` (7) y controlador (9). `acquireSyncLockWaiting`/`pushPendingEvents`/`tryAcquireSyncLock` (4) → Task 7 y sus tests. `connectionStateSignal`/`setConnectionState`/`lastSyncFailureSignal`/`localCatalogCountsSignal` (2) → Tasks 4, 5, 7, 9, 11. `ConfigPhase`, `configConfirmationSignal`, `handleConfigEscape`, `confirmConfigChange`, `backToEditing` se definen en el Task 9 y solo se usan ahí y en el Task 11/12.
