# Identidad de terminal, wizard de `/CONFIG` y teclado + mouse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar la Etapa 2 del epic #94 (issue #97): ciclo de vida del id de dispositivo,
sucursal/punto de venta obligatorios, `/CONFIG` como wizard con mantener/borrar a elección, y el
patrón teclado + mouse en venta, `/CONFIG`, `/ANULAR`, comprobante, `/DIAGNOSTICO`, `/DEMO_RESET` y
`/RESUMEN`.

**Architecture:** Un modelo puro del wizard (`ui/keyboard/config-wizard-model.ts`) decide pasos,
salteos y qué hace Aplicar; el controller solo orquesta lo async (probar, enviar antes de borrar,
aplicar) y la pantalla solo dibuja. `applyConnection` gana los modos `keep`/`wipe`, y un camino aparte
guarda solo la config de terminal. Un handler compartido (`keepFocusOnMouseDown`) fija el patrón de
mouse.

**Tech Stack:** Preact + `@preact/signals`, Dexie, Zod, Vitest + Testing Library (preact), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-23-identidad-terminal-y-wizard-config-design.md`

## Global Constraints

- TypeScript estricto: `any` prohibido; `unknown` solo en un borde validado con Zod en la línea siguiente.
- Funciones de negocio devuelven `Result<T>`; `try/catch` solo en adaptadores (Dexie, `localStorage`, fetch).
- Foco imperativo siempre con `useLayoutEffect`/hooks de `ui/hooks/`, nunca `autoFocus`.
- Textos de UI en español rioplatense; ningún texto por debajo de `--font-size-sm`.
- La app funciona desde 600px de ancho real (zoom de `.app-zoom-wrapper`, ancho lógico ≥ 1024px).
- Tests de componentes sin `jest-dom` (aserciones planas de DOM). Tests de `storage/`/Dexie importan `'fake-indexeddb/auto'`.
- Contrato del Connector API sigue en `3.0.0`; minibackend y puente de Sheets no cambian.
- Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comandos de verificación: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e`.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/sync/terminal-identity.ts` (mod) | `resolveDeviceIdentity`, `getDeviceId` sin creación, `peekDeviceId`, setter de tests |
| `src/sync/connection-state.ts` (mod) | estado `incomplete`, `hasTerminalIdentity` |
| `src/sync/connection.ts` (mod) | `probeConnection` con `onProgress`; se va `planConnectionChange`; `originKey` sobre `ConnectorConfig` |
| `src/storage/reconcile.ts` (mod) | `applySnapshotReconciled` (sin transacción propia, `allowEmptyTables`) |
| `src/sync/apply-connection.ts` (mod) | `applyConnection` con `local`/`originChanged`; `applyTerminalSettings` |
| `src/sync/connector-registry.ts` (mod) | `description` y `setupHelp` por tipo |
| `src/ui/keyboard/config-wizard-model.ts` (nuevo) | modelo puro del wizard |
| `src/ui/state/sync-config.ts` (reescrito) | signals del wizard |
| `src/ui/keyboard/config-controller.ts` (reescrito) | orquestación async del wizard |
| `src/ui/components/Spinner.tsx` (nuevo) | spinner accesible |
| `src/ui/screens/config-screen.tsx` (reescrito) | wizard |
| `src/ui/hooks/use-mouse-keeps-focus.ts` (nuevo) | `keepFocusOnMouseDown` |
| `src/ui/keyboard/commands.ts`, `src/ui/state/command-bar.ts`, `src/ui/keyboard/command-bar-controller.ts` (mod) | disponibilidad de comandos, preselección, click en filas |
| `src/ui/components/CommandBarInput.tsx`, `src/ui/screens/sale-screen.tsx` (mod) | mouse en la venta |
| `src/ui/screens/{void-sale,receipt,diagnostico,demo-reset,cash-summary}-screen.tsx` (mod) | mouse + botones |
| `e2e/*` | fixtures, specs reescritos y nuevos |
| `docs/connector-api.openapi.yaml`, `CLAUDE.md` | documentación |

---

### Task 1: Ciclo de vida del id de dispositivo

**Files:**
- Modify: `src/sync/terminal-identity.ts`
- Modify: `src/ui/bootstrap.ts`
- Modify: `src/ui/state/sync-config.ts` (solo agregar `identityResetSignal`)
- Modify: `src/ui/console/pos-console.ts` (dep `getDeviceId` → `peekDeviceId`)
- Modify: `src/test/setup.ts`
- Test: `src/sync/terminal-identity.test.ts`, `src/ui/bootstrap.test.ts`, `src/ui/console/pos-console.test.ts` (si existe; si no, el test de consola que use `deviceId`)

**Interfaces:**
- Produces:
  - `resolveDeviceIdentity(): Promise<IdentityResolution>` con `IdentityResolution = { status: 'existing' } | { status: 'created'; wipedLocalData: boolean }`
  - `getDeviceId(): string` (lanza si no se resolvió — invariante)
  - `peekDeviceId(): string | null`
  - `setDeviceIdForTests(id: string | undefined): void`
  - `identityResetSignal: Signal<boolean>` en `ui/state/sync-config.ts`

- [ ] **Step 1: Test setup global**

En `src/test/setup.ts`, agregar al final (así todo test que llegue a `getDeviceId` indirectamente tiene un id sin depender de `localStorage`):

```typescript
import { beforeEach } from 'vitest';
import { setDeviceIdForTests } from '../sync/terminal-identity.ts';

// Etapa 2 (#97): `getDeviceId()` ya no crea un id — lo resuelve `bootstrap()`
// una vez. Los tests que llegan al motor/conectores sin pasar por el arranque
// usan este id fijo; los de `terminal-identity.test.ts` lo pisan a propósito.
beforeEach(() => {
  setDeviceIdForTests('test-device-id');
});
```

(Unificar el import de `vitest` con el `afterEach, vi` que ya existe.)

- [ ] **Step 2: Tests que fallan**

Reemplazar el `describe('getDeviceId', …)` de `src/sync/terminal-identity.test.ts`:

```typescript
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../storage/db.ts';
import { loadSyncConfig, saveSyncConfig } from './config.ts';
import { getProductsCursor, setProductsCursor } from './cursor.ts';
import {
  currentEventOrigin,
  DEVICE_ID_KEY,
  getDeviceId,
  peekDeviceId,
  resolveDeviceIdentity,
  setDeviceIdForTests,
} from './terminal-identity.ts';

beforeEach(async () => {
  localStorage.clear();
  setDeviceIdForTests(undefined);
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('resolveDeviceIdentity', () => {
  it('con id guardado lo reusa y no toca nada', async () => {
    localStorage.setItem(DEVICE_ID_KEY, 'abc');
    await db.sales.put({ id: 's1', lines: [], payments: [], total: 0, status: 'closed', createdAt: 'x' });
    expect(await resolveDeviceIdentity()).toEqual({ status: 'existing' });
    expect(getDeviceId()).toBe('abc');
    expect(await db.sales.count()).toBe(1);
  });

  it('instalación nueva: crea el id sin avisar', async () => {
    expect(await resolveDeviceIdentity()).toEqual({ status: 'created', wipedLocalData: false });
    expect(getDeviceId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe(getDeviceId());
  });

  it('sin id con datos: borra todo, conserva la config sin verifiedAt y avisa', async () => {
    await db.sales.put({ id: 's1', lines: [], payments: [], total: 0, status: 'closed', createdAt: 'x' });
    setProductsCursor('c1');
    saveSyncConfig({ type: 'rest', baseUrl: 'http://x', branch: 'Centro', pointOfSale: 'Caja 1', verifiedAt: 'y' });

    expect(await resolveDeviceIdentity()).toEqual({ status: 'created', wipedLocalData: true });

    expect(await db.sales.count()).toBe(0);
    expect(getProductsCursor()).toBeUndefined();
    const config = loadSyncConfig();
    expect(config.ok && config.value).toEqual({
      type: 'rest',
      baseUrl: 'http://x',
      branch: 'Centro',
      pointOfSale: 'Caja 1',
    });
  });

  it('sin id y solo con config (sin datos): igual avisa', async () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'http://x', verifiedAt: 'y' });
    expect(await resolveDeviceIdentity()).toEqual({ status: 'created', wipedLocalData: true });
  });
});

describe('getDeviceId', () => {
  it('nunca crea un id: sin resolver es un bug', () => {
    expect(() => getDeviceId()).toThrow();
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull();
  });

  it('borrar la clave a mitad de sesión no cambia el id en memoria', async () => {
    await resolveDeviceIdentity();
    const id = getDeviceId();
    localStorage.removeItem(DEVICE_ID_KEY);
    expect(getDeviceId()).toBe(id);
  });
});

describe('peekDeviceId', () => {
  it('null antes de resolver', () => {
    expect(peekDeviceId()).toBeNull();
  });
});
```

Mantener el `describe('currentEventOrigin', …)` existente.

- [ ] **Step 3: Correr y ver que fallan**

Run: `pnpm vitest run src/sync/terminal-identity.test.ts`
Expected: FAIL (`resolveDeviceIdentity`, `peekDeviceId`, `setDeviceIdForTests` no existen).

- [ ] **Step 4: Implementación**

Reemplazar `getDeviceId` y el fallback en `src/sync/terminal-identity.ts`:

```typescript
import { buildEventOrigin, type EventOrigin } from '../domain/event-origin.ts';
import { db } from '../storage/db.ts';
import { clearAllTables } from '../storage/local-data.ts';
import { loadSyncConfig, saveSyncConfig } from './config.ts';
import { clearSyncCursors } from './cursor.ts';
import { clearPushLotState } from './push-lot.ts';

export const DEVICE_ID_KEY = 'offline-pos:device-id';

/** Id resuelto al arrancar (`resolveDeviceIdentity`); nunca se crea después. */
let cachedDeviceId: string | undefined;

export type IdentityResolution =
  | { status: 'existing' }
  | { status: 'created'; wipedLocalData: boolean };

function readStoredDeviceId(): string | undefined {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    return stored !== null && stored !== '' ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort como `sync/cursor.ts`: si `localStorage` falla, el id vive solo en memoria. */
function storeDeviceId(id: string): void {
  try {
    localStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    /* best-effort */
  }
}

async function hasAnyLocalData(): Promise<boolean> {
  const counts = await Promise.all(db.tables.map((table) => table.count()));
  return counts.some((count) => count > 0);
}

/**
 * Ciclo de vida del id de dispositivo (Etapa 2, #97). Se llama **una sola
 * vez**, al principio de `bootstrap()`. Sin id guardado, los datos locales
 * dejan de servir (el backend no podría atribuirlos): se borran todas las
 * tablas, los cursores y el estado de lotes, y se genera un id nuevo. La config
 * de `/CONFIG` se conserva como precarga pero **sin `verifiedAt`**, así el
 * wizard obliga a volver a probar la conexión sin tener que retipearla.
 * Riesgo aceptado (epic #94): lo pendiente sin enviar se pierde.
 */
export async function resolveDeviceIdentity(): Promise<IdentityResolution> {
  const stored = readStoredDeviceId();
  if (stored !== undefined) {
    cachedDeviceId = stored;
    return { status: 'existing' };
  }

  const config = loadSyncConfig();
  const wipedLocalData = (await hasAnyLocalData()) || config.ok;
  await db.transaction('rw', db.tables, clearAllTables);
  clearSyncCursors();
  clearPushLotState();
  if (config.ok) {
    const { verifiedAt: _dropped, ...unverified } = config.value;
    saveSyncConfig(unverified);
  }

  const created = crypto.randomUUID();
  storeDeviceId(created);
  cachedDeviceId = created;
  return { status: 'created', wipedLocalData };
}

/**
 * Id de dispositivo: viaja una vez por request de push y de pull (contrato
 * v3). Nunca crea uno: si alguien borra la clave a mitad de sesión, la
 * terminal sigue con el id en memoria hasta recargar, y recién ahí
 * `resolveDeviceIdentity` aplica el ciclo de vida. Llamarlo antes de resolver
 * es un bug (invariante), no un error de negocio.
 */
export function getDeviceId(): string {
  if (cachedDeviceId === undefined) {
    throw new Error('getDeviceId() antes de resolveDeviceIdentity()');
  }
  return cachedDeviceId;
}

/** Para `pos.deviceId()`, que existe antes del arranque: `null` si todavía no se resolvió. */
export function peekDeviceId(): string | null {
  return cachedDeviceId ?? null;
}

/** Solo tests (`src/test/setup.ts`): fija o limpia el id en memoria. */
export function setDeviceIdForTests(id: string | undefined): void {
  cachedDeviceId = id;
}
```

Si `saveSyncConfig` exige `SyncConfig` y el tipo del rest-spread no encaja por el `preprocess`, castear
con el tipo explícito `const unverified: SyncConfig = { ...config.value }; delete unverified.verifiedAt;`
— el objetivo es solo quitar `verifiedAt`. Si ESLint marca `_dropped`, usar esa segunda forma.

Verificar que no haya ciclo de imports problemático: `storage/local-data.ts` no importa de `sync/`.

- [ ] **Step 5: `identityResetSignal` y bootstrap**

En `src/ui/state/sync-config.ts` agregar:

```typescript
/**
 * Etapa 2 (#97): el arranque encontró la terminal sin id de dispositivo y
 * borró sus datos. El paso 1 del wizard lo avisa; se apaga al aplicar.
 */
export const identityResetSignal = signal(false);
```

En `src/ui/bootstrap.ts`, primera línea de `bootstrap()`:

```typescript
  // Etapa 2 (#97): antes que nada — sin id, lo local se borra y no hay que
  // cargar repositorios ni la venta en curso de datos que ya no sirven.
  const identity = await resolveDeviceIdentity();
  identityResetSignal.value = identity.status === 'created' && identity.wipedLocalData;
```

con los imports correspondientes.

- [ ] **Step 6: Consola**

En `src/ui/console/pos-console.ts` cambiar la dependencia a `getDeviceId: () => string | null` y el
default de instalación a `peekDeviceId`. Actualizar el texto de ayuda de `deviceId()` si dice que
siempre devuelve un string. Ajustar su test si verifica el tipo.

- [ ] **Step 7: Test de bootstrap**

En `src/ui/bootstrap.test.ts` agregar:

```typescript
it('sin id de dispositivo con datos: borra y prende el aviso de identidad', async () => {
  setDeviceIdForTests(undefined);
  localStorage.removeItem(DEVICE_ID_KEY);
  await db.sales.put({ id: 's1', lines: [], payments: [], total: 0, status: 'closed', createdAt: 'x' });
  await bootstrap();
  expect(await db.sales.count()).toBe(0);
  expect(identityResetSignal.value).toBe(true);
});
```

(Seguir el `beforeEach`/`afterEach` del archivo; si el archivo mockea `startSyncEngine`, mantenerlo.)

- [ ] **Step 8: Correr todo**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. Si algún test existente dependía de que `getDeviceId` generara un UUID (por ejemplo
`engine.test.ts` comparando `deviceId` con un regex de UUID), ajustarlo a `'test-device-id'`.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(sync): ciclo de vida del id de dispositivo (#97)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Estado de conexión `incomplete` (sucursal y punto de venta obligatorios)

**Files:**
- Modify: `src/sync/connection-state.ts`
- Modify: `e2e/fixtures.ts`
- Test: `src/sync/connection-state.test.ts`, `src/ui/app.test.tsx`

**Interfaces:**
- Produces: `ConnectionState = 'unconfigured' | 'unverified' | 'incomplete' | 'active'`; `hasTerminalIdentity(config: { branch?: string; pointOfSale?: string }): boolean`

- [ ] **Step 1: Tests que fallan** — en `src/sync/connection-state.test.ts`:

```typescript
it('verificada pero sin sucursal o punto de venta es incomplete', () => {
  expect(connectionState(ok({ type: 'rest', baseUrl: 'http://x', verifiedAt: 'y' }))).toBe('incomplete');
  expect(
    connectionState(ok({ type: 'rest', baseUrl: 'http://x', verifiedAt: 'y', branch: 'A', pointOfSale: '  ' })),
  ).toBe('incomplete');
});

it('verificada con identidad completa es active', () => {
  expect(
    connectionState(ok({ type: 'rest', baseUrl: 'http://x', verifiedAt: 'y', branch: 'A', pointOfSale: 'B' })),
  ).toBe('active');
});
```

Actualizar los casos `active` existentes para que incluyan `branch`/`pointOfSale`.

- [ ] **Step 2: Correr** — `pnpm vitest run src/sync/connection-state.test.ts` → FAIL.

- [ ] **Step 3: Implementación**

```typescript
/**
 * Estado de la conexión de esta terminal (Etapa 2b, #76; `incomplete` desde la Etapa 2 de #94):
 * - `unconfigured`: no hay config guardada (o está inválida).
 * - `unverified`: hay config pero sin una prueba exitosa registrada.
 * - `incomplete`: probada, pero sin sucursal o punto de venta (obligatorios
 *   desde #97; una config de la Etapa 1 cae acá) — completarlos no exige probar.
 * - `active`: la app puede operar.
 * Depende solo de lo guardado, nunca de la conectividad.
 */
export type ConnectionState = 'unconfigured' | 'unverified' | 'incomplete' | 'active';

export function hasTerminalIdentity(config: { branch?: string; pointOfSale?: string }): boolean {
  return (config.branch ?? '').trim() !== '' && (config.pointOfSale ?? '').trim() !== '';
}

export function connectionState(config: Result<SyncConfig>): ConnectionState {
  if (!config.ok) {
    return 'unconfigured';
  }
  if (config.value.verifiedAt === undefined) {
    return 'unverified';
  }
  return hasTerminalIdentity(config.value) ? 'active' : 'incomplete';
}
```

- [ ] **Step 4: Fixture e2e** — en `e2e/fixtures.ts`, `ACTIVE_CONFIG` suma
`branch: 'Casa central', pointOfSale: 'Caja 1'`. Buscar otros specs que siembren una config a mano
(`grep -rn "verifiedAt" e2e`) y sumarles los dos campos.

- [ ] **Step 5: Test de app** — en `src/ui/app.test.tsx`, un caso: con `connectionStateSignal.value =
'incomplete'` se renderiza `/CONFIG` (buscar por el título del diálogo que ya usan los tests del archivo).

- [ ] **Step 6: Correr** — `pnpm test && pnpm typecheck` → PASS.

- [ ] **Step 7: Commit** — `feat(sync): estado incomplete sin sucursal o punto de venta (#97)`.

---

### Task 3: Progreso de la prueba de conexión

**Files:**
- Modify: `src/sync/connection.ts`
- Test: `src/sync/connection.test.ts`

**Interfaces:**
- Produces: `ProbeStage = 'waiting-lock' | 'pulling'`; `probeConnection(config, options & { onProgress?: (stage: ProbeStage) => void })`

- [ ] **Step 1: Test que falla**

```typescript
it('informa el progreso: pulling sin cerrojo tomado', async () => {
  const stages: string[] = [];
  await probeConnection(REST_CONFIG, { connector: fakeConnector(), onProgress: (s) => stages.push(s) });
  expect(stages).toEqual(['pulling']);
});

it('informa waiting-lock si hay un ciclo en curso', async () => {
  const release = tryAcquireSyncLock();
  const stages: string[] = [];
  const probe = probeConnection(REST_CONFIG, { connector: fakeConnector(), onProgress: (s) => stages.push(s) });
  release?.();
  await probe;
  expect(stages).toEqual(['waiting-lock', 'pulling']);
});
```

Usar el `Connector` fake y la config que ya usa el archivo (`src/test/fake-connector.ts`); importar
`tryAcquireSyncLock` de `./engine.ts`.

- [ ] **Step 2: Correr** → FAIL.

- [ ] **Step 3: Implementación** — en `probeConnection`:

```typescript
export type ProbeStage = 'waiting-lock' | 'pulling';

export async function probeConnection(
  config: SyncConfig,
  options: {
    timeoutMs?: number;
    lockWaitMs?: number;
    connector?: Connector;
    /** Para el spinner del wizard: qué se está esperando ahora. */
    onProgress?: (stage: ProbeStage) => void;
  } = {},
): Promise<Result<ProbeSnapshot>> {
  if (isSyncLockHeld()) {
    options.onProgress?.('waiting-lock');
  }
  const release = await acquireSyncLockWaiting(options.lockWaitMs ?? PROBE_LOCK_WAIT_MS);
  if (release === undefined) {
    return err('connection/sync-busy', undefined);
  }
  options.onProgress?.('pulling');
  // …resto igual
```

- [ ] **Step 4: Correr** → PASS. **Step 5: Commit** — `feat(sync): progreso de la prueba de conexión (#97)`.

---

### Task 4: Aplicar con Mantener/Borrar y guardar solo terminal

**Files:**
- Modify: `src/storage/reconcile.ts`
- Modify: `src/sync/apply-connection.ts`
- Modify: `src/sync/connection.ts` (`originKey` recibe `ConnectorConfig`)
- Modify: `src/ui/keyboard/config-controller.ts` (adaptador temporal a la firma nueva; se reescribe en la Task 7)
- Test: `src/storage/reconcile.test.ts`, `src/sync/apply-connection.test.ts`

**Interfaces:**
- Consumes: `connectionState`, `hasTerminalIdentity` (Task 2).
- Produces:
  - `applySnapshotReconciled(snapshot: ProbeSnapshot, params: { now: string; allowEmptyTables?: boolean }): Promise<{ skipped: SnapshotTable[] }>` — sin transacción propia, lanza.
  - `ApplyConnectionParams = { candidate: SyncConfig; snapshot: ProbeSnapshot; local: 'keep' | 'wipe'; originChanged: boolean; now: string; lockWaitMs?: number }`
  - `applyTerminalSettings(terminal: { branch: string; pointOfSale: string; locale: string }): Result<void>`
  - `originKey(config: ConnectorConfig): string`

- [ ] **Step 1: Refactor de reconcile (test primero)** — en `src/storage/reconcile.test.ts`:

```typescript
it('con allowEmptyTables, una tabla que llega vacía borra lo local', async () => {
  await db.products.put(someProduct);
  await db.transaction('rw', db.tables, () =>
    applySnapshotReconciled(
      { products: [], stock: [], customers: [], cursors: {} },
      { now, allowEmptyTables: true },
    ),
  );
  expect(await db.products.count()).toBe(0);
});
```

(Usar el producto de ejemplo que ya define el archivo.)

- [ ] **Step 2: Implementación** — mover el cuerpo de la transacción de `reconcileSnapshot` a:

```typescript
/**
 * La reconciliación de una foto completa, **sin transacción propia**: para
 * correr dentro de una ya abierta (la de `applyConnection`, Etapa 2 de #94).
 * Lanza si Dexie falla — quien la llama convierte a `Result`.
 * `allowEmptyTables`: un backend **nuevo** vacío es legítimo (una planilla
 * recién creada), así que la salvaguarda de tabla vacía no aplica.
 */
export async function applySnapshotReconciled(
  snapshot: ProbeSnapshot,
  params: { now: string; allowEmptyTables?: boolean },
): Promise<{ skipped: SnapshotTable[] }> {
  // cuerpo actual de absentKeys + las cuatro tablas, con:
  // if (incomingKeys.length === 0 && absent.length > 0 && params.allowEmptyTables !== true) { … }
}

export async function reconcileSnapshot(
  snapshot: ProbeSnapshot,
  params: { now: string },
): Promise<Result<{ skipped: SnapshotTable[] }>> {
  try {
    return ok(
      await db.transaction(
        'rw',
        [db.products, db.stock, db.customers, db.customerAccounts, db.outbox],
        () => applySnapshotReconciled(snapshot, params),
      ),
    );
  } catch (error) {
    return err('sync/reconcile-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
```

`skipped` pasa a ser local de `applySnapshotReconciled`. Correr `pnpm vitest run src/storage/reconcile.test.ts` → PASS.

- [ ] **Step 3: Tests de `applyConnection` que fallan** — en `src/sync/apply-connection.test.ts`
reemplazar los usos de `wipe: true/false` y sumar:

```typescript
describe('applyConnection — keep', () => {
  it('reconcilia la foto y conserva ventas y outbox', async () => {
    await db.products.put(oldProduct);
    await db.sales.put(sale);
    await db.outbox.put(pendingEvent);
    const result = await applyConnection({ candidate, snapshot: snapshotWith([newProduct]), local: 'keep', originChanged: true, now });
    expect(result.ok).toBe(true);
    expect(await db.products.toCollection().primaryKeys()).toEqual([newProduct.id]);
    expect(await db.sales.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it('origen cambiado: descarta el estado de lotes', async () => {
    setCurrentPushLot({ idempotencyId: 'L1', eventIds: ['e1'], attempts: 1 });
    await applyConnection({ candidate, snapshot: emptySnapshot, local: 'keep', originChanged: true, now });
    expect(getCurrentPushLot()).toBeUndefined();
  });

  it('mismo origen: conserva el estado de lotes y la salvaguarda de tabla vacía', async () => {
    setCurrentPushLot({ idempotencyId: 'L1', eventIds: ['e1'], attempts: 1 });
    await db.products.put(oldProduct);
    await applyConnection({ candidate, snapshot: emptySnapshot, local: 'keep', originChanged: false, now });
    expect(getCurrentPushLot()?.idempotencyId).toBe('L1');
    expect(await db.products.count()).toBe(1);
  });
});

describe('applyConnection — wipe', () => {
  it('borra todo y carga la foto', async () => {
    await db.sales.put(sale);
    await applyConnection({ candidate, snapshot: snapshotWith([newProduct]), local: 'wipe', originChanged: true, now });
    expect(await db.sales.count()).toBe(0);
    expect(await db.products.count()).toBe(1);
  });
});

describe('applyTerminalSettings', () => {
  it('guarda sucursal y punto de venta conservando verifiedAt y activa la terminal', () => {
    saveSyncConfig({ type: 'rest', baseUrl: 'http://x', verifiedAt: 'v' });
    const result = applyTerminalSettings({ branch: ' Centro ', pointOfSale: 'Caja 2', locale: '' });
    expect(result.ok).toBe(true);
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value).toEqual({ type: 'rest', baseUrl: 'http://x', verifiedAt: 'v', branch: 'Centro', pointOfSale: 'Caja 2' });
    expect(connectionStateSignal.value).toBe('active');
  });
});
```

Ajustar la forma exacta de `PushLot` a la de `domain/push-lot.ts` (leerla antes). `oldProduct`,
`newProduct`, `sale`, `pendingEvent`, `snapshotWith`, `emptySnapshot` se definen en el archivo con
los helpers que ya tiene.

- [ ] **Step 4: Correr** → FAIL.

- [ ] **Step 5: Implementación en `apply-connection.ts`**

```typescript
export type ApplyConnectionParams = {
  candidate: SyncConfig;
  snapshot: ProbeSnapshot;
  /** Etapa 2 (#97): el usuario elige; nunca se borra solo por cambiar de origen. */
  local: 'keep' | 'wipe';
  originChanged: boolean;
  now: string;
  lockWaitMs?: number;
};
```

Dentro de la transacción:

```typescript
      await db.transaction('rw', db.tables, async () => {
        if (params.local === 'wipe') {
          await clearAllTables();
          await db.products.bulkPut(params.snapshot.products);
          await db.stock.bulkPut(params.snapshot.stock);
          await db.customers.bulkPut(customers);
          await db.customerAccounts.bulkPut(accounts);
          return;
        }
        // Mantener: la foto es la fuente de verdad del catálogo/clientes (desaparece lo del
        // backend anterior), ventas/turnos/outbox/venta en curso quedan intactos.
        await applySnapshotReconciled(params.snapshot, {
          now: params.now,
          allowEmptyTables: params.originChanged,
        });
      });
```

(`splitConnectorCustomers` solo se necesita en la rama `wipe`: moverlo adentro.)

Después de la transacción:

```typescript
    clearSyncCursors();
    // Mismo origen: un lote congelado cuyo ack se perdió tiene que reenviarse con SU
    // idempotency_id, o el backend lo recibiría duplicado. Otro origen: el backend nuevo no
    // conoce esos lotes y los pendientes salen en uno nuevo.
    if (params.local === 'wipe' || params.originChanged) {
      clearPushLotState();
    }
```

Nueva función:

```typescript
/**
 * Camino "solo terminal" del wizard (Etapa 2, #97): la conexión no cambió, así
 * que no hay prueba ni cerrojo ni IndexedDB — solo se guarda sucursal, punto de
 * venta y locale sobre la config actual, conservando `verifiedAt`. Los eventos
 * ya encolados conservan su `origin`.
 */
export function applyTerminalSettings(terminal: {
  branch: string;
  pointOfSale: string;
  locale: string;
}): Result<void> {
  const current = loadSyncConfig();
  if (!current.ok) {
    return current;
  }
  const { locale: _oldLocale, ...rest } = current.value;
  const locale = terminal.locale.trim();
  const next: SyncConfig = {
    ...rest,
    branch: terminal.branch.trim(),
    pointOfSale: terminal.pointOfSale.trim(),
    ...(locale !== '' ? { locale } : {}),
  };
  const saved = saveSyncConfig(next);
  if (!saved.ok) {
    return saved;
  }
  setConnectionState(connectionState(ok(next)));
  return ok(undefined);
}
```

En `connection.ts`, cambiar `originKey(config: SyncConfig)` a `originKey(config: ConnectorConfig)`
(importar el tipo de `./connector-registry.ts`).

- [ ] **Step 6: Adaptador temporal** — en `config-controller.ts`, donde arma `PendingApply`, pasar
`local: plan.wipe ? 'wipe' : 'keep', originChanged: plan.wipe` en vez de `wipe: plan.wipe`, y usar
`pending.local === 'wipe'` donde se leía `pending.wipe`. (La Task 7 lo reescribe.)

- [ ] **Step 7: Correr** — `pnpm test && pnpm typecheck` → PASS.

- [ ] **Step 8: Commit** — `feat(sync): aplicar conexión manteniendo o borrando lo local (#97)`.

---

### Task 5: Descripción e instrucciones por conector

**Files:**
- Modify: `src/sync/connector-registry.ts`
- Test: `src/sync/connector-registry.test.ts`

**Interfaces:**
- Produces: `ConnectorTypeInfo.description: string`, `ConnectorTypeInfo.setupHelp: string[]`; `connectorInfo(type: ConnectorType): ConnectorTypeInfo`

- [ ] **Step 1: Test que falla**

```typescript
it('cada tipo tiene descripción e instrucciones', () => {
  for (const info of CONNECTOR_TYPES) {
    expect(info.description.trim()).not.toBe('');
    expect(info.setupHelp.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Correr** → FAIL (typecheck).

- [ ] **Step 3: Implementación** — sumar a `ConnectorTypeInfo`:

```typescript
  /** Una línea en el paso "Tipo de conexión" del wizard (Etapa 2, #97). */
  description: string;
  /** Pasos numerados en "Datos del conector". */
  setupHelp: string[];
```

y los valores:

```typescript
  // rest
  description: 'Cualquier backend que implemente el contrato del Connector API v3.',
  setupHelp: [
    'El backend tiene que implementar el contrato v3 (docs/connector-api.openapi.yaml).',
    'Cargá la URL base del backend, por ejemplo https://api.mi-negocio.com.',
    'Si el backend pide una API key, cargala; si no, dejala vacía.',
  ],
  // rest-demo
  description: 'El minibackend de demostración que viene con el POS, para probar sin un backend real.',
  setupHelp: [
    'Levantá el minibackend: pnpm dev (levanta la app y el minibackend) o solo el minibackend con pnpm --filter demo-backend start.',
    'La URL es http://localhost:4000.',
    'El panel del minibackend está en http://localhost:4000/_demo.',
  ],
  // google-sheets
  description: 'Una planilla de Google Sheets, a través de un puente de Apps Script.',
  setupHelp: [
    'En la planilla: Extensiones → Apps Script. Pegá bridge.gs y columnas.gs (están en src/connectors/google-sheets/).',
    'Implementar → Nueva implementación → Aplicación web. Ejecutar como: yo. Quién tiene acceso: cualquier persona.',
    'Copiá la URL de la aplicación web: termina en /exec.',
    'Si configuraste SHARED_SECRET en las propiedades del script, cargá el mismo valor como secreto compartido.',
    'Detalle completo en el README del conector (src/connectors/google-sheets/README.md).',
  ],
```

Y `export function connectorInfo(type: ConnectorType): ConnectorTypeInfo` (busca en `CONNECTOR_TYPES`;
`find` con `!` no — lanzar un `Error` si no está, es invariante).

- [ ] **Step 4: Correr** → PASS. **Step 5: Commit** — `feat(connectors): descripción e instrucciones por tipo (#97)`.

---

### Task 6: Modelo puro del wizard

**Files:**
- Create: `src/ui/keyboard/config-wizard-model.ts`
- Test: `src/ui/keyboard/config-wizard-model.test.ts`

**Interfaces:**
- Consumes: `syncConfigSchema`, `SyncConfig` (`sync/config.ts`); `connectorFields`, `toFieldValues`, `ConnectorType`, `connectorConfigSchema` (`sync/connector-registry.ts`); `originKey` (`sync/connection.ts`); `hasUserData`, `LocalDataSummary` (`storage/local-data.ts`); `ConfigFormValues` (`ui/state/sync-config.ts` — si importar de `ui/state` crea un ciclo, mover `ConfigFormValues` a este archivo y reexportarlo desde el state).
- Produces (exactos, los usan las Tasks 7 y 8):

```typescript
export type WizardStepId = 'terminal' | 'type' | 'connector' | 'probe' | 'local-data' | 'review';
export const WIZARD_STEPS: readonly WizardStepId[];
export const WIZARD_STEP_TITLES: Record<WizardStepId, string>;
export type StepStatus = 'pending' | 'complete' | 'error' | 'skipped';
export type SkipReason = 'connection-unchanged' | 'no-user-data';
export type WizardStep = { id: WizardStepId; number: number; status: StepStatus; skipReason?: SkipReason };
export type TerminalForm = { branch: string; pointOfSale: string; locale: string };
export type LocalChoice = 'keep' | 'wipe';
export type ProbeOutcome =
  | { status: 'ok'; key: string; products: number; customers: number }
  | { status: 'failed'; key: string; message: string }
  | { status: 'cancelled'; key: string };
export type WizardInput = {
  terminal: TerminalForm;
  type: ConnectorType | null;
  fieldValues: ConfigFormValues;
  saved: SyncConfig | undefined;
  probe: ProbeOutcome | null;
  localData: LocalDataSummary | null;
  localChoice: LocalChoice;
  localChoiceConfirmed: boolean;
};
export type ApplyAction =
  | { kind: 'save-terminal' }
  | { kind: 'apply-connection'; local: LocalChoice; originChanged: boolean };
export type WizardModel = {
  steps: WizardStep[];
  candidate: SyncConfig | undefined;
  connectionKey: string | undefined;
  connectionChanged: boolean;
  originChanged: boolean;
  probeValid: boolean;
  applyAction: ApplyAction | null;
  firstIncomplete: WizardStepId;
};
export type StepValidation = { ok: true } | { ok: false; field?: string; message: string };
export function buildWizardModel(input: WizardInput): WizardModel;
export function validateStep(input: WizardInput, step: 'terminal' | 'type' | 'connector'): StepValidation;
export function formConnectionKey(type: ConnectorType, values: Record<string, string>): string;
export function nextStep(model: WizardModel, from: WizardStepId): WizardStepId;
export function previousStep(model: WizardModel, from: WizardStepId): WizardStepId;
export function isReachable(model: WizardModel, step: WizardStepId): boolean;
export function initialStep(model: WizardModel, params: { active: boolean; identityReset: boolean }): WizardStepId;
```

- [ ] **Step 1: Tests que fallan** — `src/ui/keyboard/config-wizard-model.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import {
  buildWizardModel,
  formConnectionKey,
  initialStep,
  isReachable,
  nextStep,
  previousStep,
  validateStep,
  type WizardInput,
} from './config-wizard-model.ts';

const NO_DATA: LocalDataSummary = { products: 3, customers: 2, sales: 0, cashSessions: 0, pendingOutbox: 0, pendingSales: 0, draftCartLines: 0 };
const WITH_SALES: LocalDataSummary = { ...NO_DATA, sales: 4, pendingOutbox: 2, pendingSales: 2 };

function blankValues(): WizardInput['fieldValues'] {
  return {
    rest: { baseUrl: '', apiKey: '' },
    'rest-demo': { baseUrl: '', apiKey: '' },
    'google-sheets': { webAppUrl: '', sharedSecret: '' },
  };
}

function input(overrides: Partial<WizardInput> = {}): WizardInput {
  const values = blankValues();
  values.rest = { baseUrl: 'http://a.test', apiKey: '' };
  return {
    terminal: { branch: 'Centro', pointOfSale: 'Caja 1', locale: '' },
    type: 'rest',
    fieldValues: values,
    saved: undefined,
    probe: null,
    localData: NO_DATA,
    localChoice: 'keep',
    localChoiceConfirmed: false,
    ...overrides,
  };
}

const SAVED = { type: 'rest' as const, baseUrl: 'http://a.test', branch: 'Centro', pointOfSale: 'Caja 1', verifiedAt: '2026-09-23T14:02:00.000Z' };
const KEY_A = formConnectionKey('rest', { baseUrl: 'http://a.test', apiKey: '' });

describe('validateStep', () => {
  it('terminal exige sucursal y punto de venta', () => {
    const result = validateStep(input({ terminal: { branch: ' ', pointOfSale: 'x', locale: '' } }), 'terminal');
    expect(result).toEqual({ ok: false, field: 'branch', message: 'Completá «Sucursal».' });
  });
  it('type exige elegir', () => {
    expect(validateStep(input({ type: null }), 'type')).toEqual({ ok: false, message: 'Elegí un tipo de conexión.' });
  });
  it('connector valida con el schema y apunta al campo', () => {
    const values = blankValues();
    values.rest = { baseUrl: 'no-es-url', apiKey: '' };
    const result = validateStep(input({ fieldValues: values }), 'connector');
    expect(result).toMatchObject({ ok: false, field: 'baseUrl' });
  });
});

describe('buildWizardModel — instalación', () => {
  it('sin prueba, se frena en probe', () => {
    const model = buildWizardModel(input());
    expect(model.connectionChanged).toBe(true);
    expect(model.firstIncomplete).toBe('probe');
    expect(model.applyAction).toBeNull();
  });
  it('con prueba vigente y sin datos del usuario, saltea local-data y aplica borrando (origen nuevo)', () => {
    const model = buildWizardModel(input({ probe: { status: 'ok', key: KEY_A, products: 3, customers: 2 } }));
    expect(model.probeValid).toBe(true);
    expect(model.steps.find((s) => s.id === 'local-data')).toMatchObject({ status: 'skipped', skipReason: 'no-user-data' });
    expect(model.firstIncomplete).toBe('review');
    expect(model.applyAction).toEqual({ kind: 'apply-connection', local: 'wipe', originChanged: true });
  });
  it('una prueba hecha con otra conexión no vale', () => {
    const model = buildWizardModel(input({ probe: { status: 'ok', key: 'otra', products: 0, customers: 0 } }));
    expect(model.probeValid).toBe(false);
  });
  it('prueba fallida con la conexión actual marca error', () => {
    const model = buildWizardModel(input({ probe: { status: 'failed', key: KEY_A, message: 'x' } }));
    expect(model.steps.find((s) => s.id === 'probe')?.status).toBe('error');
  });
});

describe('buildWizardModel — terminal activa', () => {
  it('solo cambió la terminal: saltea probe y local-data y guarda solo terminal', () => {
    const model = buildWizardModel(input({ saved: SAVED, terminal: { branch: 'Norte', pointOfSale: 'Caja 3', locale: '' }, localData: WITH_SALES }));
    expect(model.connectionChanged).toBe(false);
    expect(model.steps.find((s) => s.id === 'probe')).toMatchObject({ status: 'skipped', skipReason: 'connection-unchanged' });
    expect(model.applyAction).toEqual({ kind: 'save-terminal' });
  });
  it('cambió la conexión con ventas: local-data pendiente hasta confirmar', () => {
    const values = blankValues();
    values.rest = { baseUrl: 'http://b.test', apiKey: '' };
    const key = formConnectionKey('rest', values.rest);
    const base = { saved: SAVED, fieldValues: values, localData: WITH_SALES, probe: { status: 'ok' as const, key, products: 1, customers: 1 } };
    expect(buildWizardModel(input(base)).firstIncomplete).toBe('local-data');
    const confirmed = buildWizardModel(input({ ...base, localChoiceConfirmed: true }));
    expect(confirmed.applyAction).toEqual({ kind: 'apply-connection', local: 'keep', originChanged: true });
  });
  it('mismo origen con otra API key: originChanged false', () => {
    const values = blankValues();
    values.rest = { baseUrl: 'http://a.test/', apiKey: 'k' };
    const key = formConnectionKey('rest', values.rest);
    const model = buildWizardModel(input({ saved: SAVED, fieldValues: values, probe: { status: 'ok', key, products: 0, customers: 0 } }));
    expect(model.connectionChanged).toBe(true);
    expect(model.originChanged).toBe(false);
    expect(model.applyAction).toEqual({ kind: 'apply-connection', local: 'keep', originChanged: false });
  });
  it('config guardada sin verifiedAt cuenta como conexión cambiada', () => {
    const { verifiedAt: _v, ...unverified } = SAVED;
    expect(buildWizardModel(input({ saved: unverified })).connectionChanged).toBe(true);
  });
});

describe('navegación', () => {
  it('next/previous saltean los pasos salteados', () => {
    const model = buildWizardModel(input({ saved: SAVED }));
    expect(nextStep(model, 'connector')).toBe('review');
    expect(previousStep(model, 'review')).toBe('connector');
    expect(previousStep(model, 'terminal')).toBe('terminal');
  });
  it('no se puede saltar más allá del primer paso incompleto', () => {
    const model = buildWizardModel(input({ terminal: { branch: '', pointOfSale: '', locale: '' } }));
    expect(isReachable(model, 'terminal')).toBe(true);
    expect(isReachable(model, 'type')).toBe(false);
  });
  it('paso inicial', () => {
    const active = buildWizardModel(input({ saved: SAVED }));
    expect(initialStep(active, { active: true, identityReset: false })).toBe('review');
    const install = buildWizardModel(input());
    expect(initialStep(install, { active: false, identityReset: false })).toBe('probe');
    expect(initialStep(install, { active: false, identityReset: true })).toBe('terminal');
  });
});
```

- [ ] **Step 2: Correr** — `pnpm vitest run src/ui/keyboard/config-wizard-model.test.ts` → FAIL.

- [ ] **Step 3: Implementación** — `src/ui/keyboard/config-wizard-model.ts`:

```typescript
import { hasUserData, type LocalDataSummary } from '../../storage/local-data.ts';
import { syncConfigSchema, type SyncConfig } from '../../sync/config.ts';
import { originKey } from '../../sync/connection.ts';
import {
  connectorConfigSchema,
  connectorFields,
  toFieldValues,
  type ConnectorType,
} from '../../sync/connector-registry.ts';
import type { ConfigFormValues } from '../state/sync-config.ts';

/**
 * Modelo puro del wizard de `/CONFIG` (Etapa 2, #97): a partir de lo tipeado,
 * lo guardado, la última prueba y los datos locales decide qué pasos se
 * saltean, cuáles están completos, hasta dónde se puede navegar y qué hace
 * Aplicar. Sin DOM ni async — el controller orquesta, la pantalla dibuja.
 */

export type WizardStepId = 'terminal' | 'type' | 'connector' | 'probe' | 'local-data' | 'review';
export const WIZARD_STEPS: readonly WizardStepId[] = ['terminal', 'type', 'connector', 'probe', 'local-data', 'review'];
export const WIZARD_STEP_TITLES: Record<WizardStepId, string> = {
  terminal: 'Terminal',
  type: 'Tipo de conexión',
  connector: 'Datos del conector',
  probe: 'Probar',
  'local-data': 'Datos locales',
  review: 'Revisar',
};

// …tipos exactos de "Interfaces" arriba…

const TERMINAL_LABELS = { branch: 'Sucursal', pointOfSale: 'Punto de venta' } as const;

/** Identidad de la conexión cargada: tipo + cada campo del conector, sin espacios. */
export function formConnectionKey(type: ConnectorType, values: Record<string, string>): string {
  return JSON.stringify([type, ...connectorFields(type).map((field) => (values[field.key] ?? '').trim())]);
}

function savedConnectionKey(saved: SyncConfig): string {
  return formConnectionKey(saved.type, toFieldValues(saved));
}

/** Los campos no vacíos del conector elegido, listos para el schema (un opcional en blanco no se guarda). */
function connectorCandidate(type: ConnectorType, values: Record<string, string>): Record<string, string> {
  const candidate: Record<string, string> = { type };
  for (const field of connectorFields(type)) {
    const value = (values[field.key] ?? '').trim();
    if (value !== '') candidate[field.key] = value;
  }
  return candidate;
}

export function validateStep(input: WizardInput, step: 'terminal' | 'type' | 'connector'): StepValidation {
  switch (step) {
    case 'terminal':
      for (const key of ['branch', 'pointOfSale'] as const) {
        if (input.terminal[key].trim() === '') {
          return { ok: false, field: key, message: `Completá «${TERMINAL_LABELS[key]}».` };
        }
      }
      return { ok: true };
    case 'type':
      return input.type === null ? { ok: false, message: 'Elegí un tipo de conexión.' } : { ok: true };
    case 'connector': {
      if (input.type === null) return { ok: false, message: 'Elegí un tipo de conexión.' };
      const raw = input.fieldValues[input.type];
      const parsed = connectorConfigSchema.safeParse(connectorCandidate(input.type, raw));
      if (parsed.success) return { ok: true };
      const offendingKey = parsed.error.issues[0]?.path[0];
      const field = connectorFields(input.type).find((f) => f.key === offendingKey);
      if (field === undefined) return { ok: false, message: 'La configuración no es válida.' };
      const isEmpty = (raw[field.key] ?? '').trim() === '';
      return {
        ok: false,
        field: field.key,
        message: isEmpty ? `Completá «${field.label}».` : `«${field.label}» no es válido.`,
      };
    }
  }
}

function buildCandidate(input: WizardInput): SyncConfig | undefined {
  if (input.type === null) return undefined;
  const candidate: Record<string, string> = connectorCandidate(input.type, input.fieldValues[input.type]);
  for (const [key, value] of Object.entries(input.terminal)) {
    const trimmed = value.trim();
    if (trimmed !== '') candidate[key] = trimmed;
  }
  const parsed = syncConfigSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function buildWizardModel(input: WizardInput): WizardModel {
  const terminalOk = validateStep(input, 'terminal').ok;
  const typeOk = validateStep(input, 'type').ok;
  const connectorOk = typeOk && validateStep(input, 'connector').ok;
  const candidate = terminalOk && connectorOk ? buildCandidate(input) : undefined;
  const connectionKey =
    input.type !== null && connectorOk ? formConnectionKey(input.type, input.fieldValues[input.type]) : undefined;

  const saved = input.saved;
  const connectionChanged =
    saved?.verifiedAt === undefined || connectionKey === undefined || savedConnectionKey(saved) !== connectionKey;
  const originChanged =
    saved === undefined || candidate === undefined || originKey(saved) !== originKey(candidate);

  const probeValid = input.probe?.status === 'ok' && input.probe.key === connectionKey;
  const probeFailedNow = input.probe?.status === 'failed' && input.probe.key === connectionKey;

  const localSkip: SkipReason | undefined = !connectionChanged
    ? 'connection-unchanged'
    : input.localData !== null && !hasUserData(input.localData)
      ? 'no-user-data'
      : undefined;

  const statusOf = (id: WizardStepId): WizardStep => {
    const number = WIZARD_STEPS.indexOf(id) + 1;
    switch (id) {
      case 'terminal':
        return { id, number, status: terminalOk ? 'complete' : 'pending' };
      case 'type':
        return { id, number, status: typeOk ? 'complete' : 'pending' };
      case 'connector':
        return { id, number, status: connectorOk ? 'complete' : 'pending' };
      case 'probe':
        if (!connectionChanged) return { id, number, status: 'skipped', skipReason: 'connection-unchanged' };
        return { id, number, status: probeValid ? 'complete' : probeFailedNow ? 'error' : 'pending' };
      case 'local-data':
        if (localSkip !== undefined) return { id, number, status: 'skipped', skipReason: localSkip };
        return { id, number, status: input.localChoiceConfirmed ? 'complete' : 'pending' };
      case 'review':
        return { id, number, status: 'pending' };
    }
  };
  const steps = WIZARD_STEPS.map(statusOf);
  const firstIncomplete =
    steps.find((step) => step.id !== 'review' && (step.status === 'pending' || step.status === 'error'))?.id ?? 'review';

  let applyAction: ApplyAction | null = null;
  if (firstIncomplete === 'review') {
    applyAction = !connectionChanged
      ? { kind: 'save-terminal' }
      : {
          kind: 'apply-connection',
          local: localSkip !== undefined ? (originChanged ? 'wipe' : 'keep') : input.localChoice,
          originChanged,
        };
  }

  return { steps, candidate, connectionKey, connectionChanged, originChanged, probeValid, applyAction, firstIncomplete };
}

const indexOf = (id: WizardStepId): number => WIZARD_STEPS.indexOf(id);
const isSkipped = (model: WizardModel, id: WizardStepId): boolean =>
  model.steps.find((step) => step.id === id)?.status === 'skipped';

export function nextStep(model: WizardModel, from: WizardStepId): WizardStepId {
  for (let i = indexOf(from) + 1; i < WIZARD_STEPS.length; i += 1) {
    const id = WIZARD_STEPS[i];
    if (id !== undefined && !isSkipped(model, id)) return id;
  }
  return 'review';
}

export function previousStep(model: WizardModel, from: WizardStepId): WizardStepId {
  for (let i = indexOf(from) - 1; i >= 0; i -= 1) {
    const id = WIZARD_STEPS[i];
    if (id !== undefined && !isSkipped(model, id)) return id;
  }
  return from;
}

export function isReachable(model: WizardModel, step: WizardStepId): boolean {
  return !isSkipped(model, step) && indexOf(step) <= indexOf(model.firstIncomplete);
}

export function initialStep(model: WizardModel, params: { active: boolean; identityReset: boolean }): WizardStepId {
  if (params.identityReset) return 'terminal';
  return params.active ? 'review' : model.firstIncomplete;
}
```

Nota sobre `originKey(saved)` vs `originKey(candidate)`: `originKey` normaliza la URL (barra final),
por eso `http://a.test/` y `http://a.test` son el mismo origen en el test.

- [ ] **Step 4: Correr** → PASS. Correr `pnpm typecheck && pnpm lint` y ajustar lo que marquen
(p. ej. `switch` exhaustivo).

- [ ] **Step 5: Commit** — `feat(ui): modelo puro del wizard de /CONFIG (#97)`.

---

### Task 7: Estado y controller del wizard

**Files:**
- Rewrite: `src/ui/state/sync-config.ts`
- Rewrite: `src/ui/keyboard/config-controller.ts`
- Modify: `src/sync/connection.ts` (quitar `planConnectionChange` y sus tests en `connection.test.ts`)
- Modify: `src/ui/bootstrap.ts` (precarga del formulario en modo requerido)
- Rewrite: `src/ui/keyboard/config-controller.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces (los usa la Task 8):

```typescript
// ui/state/sync-config.ts
export type ConfigFormValues = Record<ConnectorType, Record<string, string>>;
export type TerminalFieldKey = 'locale' | 'branch' | 'pointOfSale';
export type WizardAsync = 'idle' | 'probing' | 'flushing' | 'confirming-wipe' | 'applying';
export const configTypeSignal: Signal<ConnectorType | null>;
export const configFieldValuesSignal: Signal<ConfigFormValues>;
export const configTerminalSignal: Signal<Record<TerminalFieldKey, string>>;
export const configErrorSignal: Signal<string | null>;
export const configErrorFieldSignal: Signal<string | null>;
export const savedConfigSignal: Signal<SyncConfig | undefined>;
export const wizardStepSignal: Signal<WizardStepId>;
export const wizardAsyncSignal: Signal<WizardAsync>;
export const probeOutcomeSignal: Signal<ProbeOutcome | null>;
export const probeProgressSignal: Signal<{ stage: ProbeStage; startedAt: number } | null>;
export const localDataSignal: Signal<LocalDataSummary | null>;
export const localChoiceSignal: Signal<LocalChoice>;
export const localChoiceConfirmedSignal: Signal<boolean>;
export const wipeSummarySignal: Signal<LocalDataSummary | null>;
export const identityResetSignal: Signal<boolean>;
export const wizardModelSignal: ReadonlySignal<WizardModel>;
export function resetConfigForm(saved?: SyncConfig): void;

// ui/keyboard/config-controller.ts
export function enterConfigScreen(): void;
export function openRequiredWizard(): Promise<void>;     // bootstrap en modo requerido
export function goToStep(step: WizardStepId): void;      // navegación interna (sin chequear alcance)
export function jumpToStep(step: WizardStepId): void;    // Alt+N / click en la columna: solo si es alcanzable
export function goBack(): void;                           // Alt+← / "Atrás"
export function advance(): void;                          // Enter
export function fastForward(): void;                      // Ctrl+Enter
export function handleWizardEscape(): void;              // Esc
export function setConfigType(type: ConnectorType | null): void;
export function chooseConnectorType(type: ConnectorType): void; // click/Enter en una opción: elige y avanza
export function moveTypeChoice(direction: 1 | -1): void;
export function setConfigField(key: string, value: string): void;
export function setConfigTerminalField(key: TerminalFieldKey, value: string): void;
export function setLocalChoice(choice: LocalChoice): void;
export function moveLocalChoice(): void;                  // ↑/↓ alterna
export function retryProbe(): void;
export function applyWizard(): Promise<void>;             // Enter en Revisar / "Aplicar"
export function confirmWipe(): Promise<void>;             // Enter en la confirmación de borrado
export function backFromWipeConfirmation(): void;
```

- [ ] **Step 1: Reescribir el state** — `src/ui/state/sync-config.ts`: mantener `blankFormValues`,
`configTypeSignal`, `configFieldValuesSignal`, `configTerminalSignal`, `configErrorSignal`,
`configErrorFieldSignal`, `identityResetSignal`; quitar `ConfigPhase`, `configPhaseSignal`,
`configConfirmationSignal`; agregar los signals de "Produces" y:

```typescript
export const wizardModelSignal = computed<WizardModel>(() =>
  buildWizardModel({
    terminal: configTerminalSignal.value,
    type: configTypeSignal.value,
    fieldValues: configFieldValuesSignal.value,
    saved: savedConfigSignal.value,
    probe: probeOutcomeSignal.value,
    localData: localDataSignal.value,
    localChoice: localChoiceSignal.value,
    localChoiceConfirmed: localChoiceConfirmedSignal.value,
  }),
);
```

`resetConfigForm(saved)` precarga como hoy y además: `savedConfigSignal.value = saved`,
`wizardStepSignal.value = 'terminal'`, `wizardAsyncSignal.value = 'idle'`, `probeOutcomeSignal.value
= null`, `probeProgressSignal.value = null`, `localDataSignal.value = null`, `localChoiceSignal.value
= 'keep'`, `localChoiceConfirmedSignal.value = false`, `wipeSummarySignal.value = null`.

Si `config-wizard-model.ts` importa `ConfigFormValues` de este archivo y este importa
`buildWizardModel` de aquel, mover `ConfigFormValues` al modelo y reexportarlo acá
(`export type { ConfigFormValues } from '../keyboard/config-wizard-model.ts'`).

- [ ] **Step 2: Tests del controller que fallan** — reescribir `config-controller.test.ts` conservando
los helpers de arriba del archivo (mock de `runPushThenPull`, `stubRestBackend`, `okResponse`,
`product`). Casos:

```typescript
describe('wizard — instalación', () => {
  beforeEach(async () => {
    connectionStateSignal.value = 'unconfigured';
    await openRequiredWizard();
  });

  it('arranca en Terminal; Enter sin sucursal marca el campo', () => {
    expect(wizardStepSignal.value).toBe('terminal');
    advance();
    expect(configErrorFieldSignal.value).toBe('branch');
    expect(wizardStepSignal.value).toBe('terminal');
  });

  it('recorrido completo: terminal → tipo → datos → probar (arranca solo) → revisar → aplicar', async () => {
    stubRestBackend();
    setConfigTerminalField('branch', 'Centro');
    setConfigTerminalField('pointOfSale', 'Caja 1');
    advance();
    expect(wizardStepSignal.value).toBe('type');
    chooseConnectorType('rest');
    expect(wizardStepSignal.value).toBe('connector');
    setConfigField('baseUrl', 'http://a.test');
    advance();
    expect(wizardStepSignal.value).toBe('probe');
    await vi.waitFor(() => expect(probeOutcomeSignal.value?.status).toBe('ok'));
    advance();
    expect(wizardStepSignal.value).toBe('review');
    await applyWizard();
    expect(activeScreenSignal.value).toBe('sale');
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value.branch).toBe('Centro');
    expect(saved.ok && saved.value.verifiedAt).toBeDefined();
    expect(connectionStateSignal.value).toBe('active');
  });

  it('Esc probando cancela y queda en probe con la prueba cancelada', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    setConfigTerminalField('branch', 'Centro');
    setConfigTerminalField('pointOfSale', 'Caja 1');
    setConfigType('rest');
    setConfigField('baseUrl', 'http://a.test');
    goToStep('probe');
    expect(wizardAsyncSignal.value).toBe('probing');
    handleWizardEscape();
    expect(wizardAsyncSignal.value).toBe('idle');
    expect(probeOutcomeSignal.value?.status).toBe('cancelled');
  });

  it('Esc en modo requerido fuera de una prueba no sale', () => {
    handleWizardEscape();
    expect(activeScreenSignal.value).not.toBe('sale');
  });
});

describe('wizard — terminal activa', () => {
  beforeEach(() => {
    saveSyncConfig({ type: 'rest', baseUrl: 'http://a.test', branch: 'Centro', pointOfSale: 'Caja 1', verifiedAt: now });
    connectionStateSignal.value = 'active';
    enterConfigScreen();
  });

  it('abre en Revisar y pausa el sync', () => {
    expect(wizardStepSignal.value).toBe('review');
    expect(syncPausedSignal.value).toBe(true);
  });

  it('cambiar solo la sucursal guarda sin probar', async () => {
    const fetchMock = stubRestBackend();
    goToStep('terminal');
    setConfigTerminalField('branch', 'Norte');
    fastForward();
    expect(wizardStepSignal.value).toBe('review');
    await applyWizard();
    expect(fetchMock).not.toHaveBeenCalled();
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value).toMatchObject({ branch: 'Norte', verifiedAt: now });
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('Esc sale sin guardar', () => {
    goToStep('terminal');
    setConfigTerminalField('branch', 'Norte');
    handleWizardEscape();
    expect(activeScreenSignal.value).toBe('sale');
    const saved = loadSyncConfig();
    expect(saved.ok && saved.value.branch).toBe('Centro');
  });

  it('cambiar de origen con ventas: pasa por Datos locales; Mantener conserva las ventas', async () => {
    stubRestBackend();
    await db.sales.put(makeSale('s1'));
    goToStep('connector');
    setConfigField('baseUrl', 'http://b.test');
    advance(); // → probe
    await vi.waitFor(() => expect(probeOutcomeSignal.value?.status).toBe('ok'));
    advance(); // → local-data
    expect(wizardStepSignal.value).toBe('local-data');
    expect(localChoiceSignal.value).toBe('keep');
    advance(); // confirma Mantener → review
    expect(wizardStepSignal.value).toBe('review');
    await applyWizard();
    expect(await db.sales.count()).toBe(1);
  });

  it('Borrar: envía lo pendiente al backend actual, pide confirmar y borra', async () => {
    const fetchMock = stubRestBackend();
    await db.sales.put(makeSale('s1'));
    await db.outbox.put(buildOutboxEventForSale(makeSale('s1'), { now, origin: {} }));
    goToStep('connector');
    setConfigField('baseUrl', 'http://b.test');
    advance();
    await vi.waitFor(() => expect(probeOutcomeSignal.value?.status).toBe('ok'));
    advance();
    setLocalChoice('wipe');
    advance();
    await vi.waitFor(() => expect(wizardAsyncSignal.value).toBe('confirming-wipe'));
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('http://a.test/sync/push'))).toBe(true);
    await confirmWipe();
    expect(await db.sales.count()).toBe(0);
    expect(activeScreenSignal.value).toBe('sale');
  });
});
```

(Ajustar la firma real de `buildOutboxEventForSale` leyendo `domain/outbox.ts`; el test viejo ya la usa.)

- [ ] **Step 3: Correr** → FAIL.

- [ ] **Step 4: Implementación del controller** — reescribir `config-controller.ts`:

```typescript
/**
 * `/CONFIG` como wizard (Etapa 2, #97). Las reglas (salteos, qué hace Aplicar)
 * viven en el modelo puro (`config-wizard-model.ts`, vía `wizardModelSignal`);
 * acá solo se orquesta lo async — probar, enviar lo pendiente antes de borrar,
 * aplicar — y la navegación. Mientras el wizard está abierto no hay sync de
 * fondo (`syncPausedSignal`).
 */

/** Token de la prueba en curso: Esc lo incrementa y la prueba descarta su resultado. */
let probeToken = 0;
/** Foto de la última prueba exitosa, con la clave de conexión con que se hizo. */
let lastSnapshot: { key: string; snapshot: ProbeSnapshot } | undefined;

function model(): WizardModel {
  return wizardModelSignal.value;
}

function clearError(): void {
  configErrorSignal.value = null;
  configErrorFieldSignal.value = null;
}

async function refreshLocalData(): Promise<void> {
  localDataSignal.value = await summarizeLocalData();
}

function openWizard(active: boolean): void {
  probeToken += 1;
  lastSnapshot = undefined;
  const saved = loadSyncConfig();
  resetConfigForm(saved.ok ? saved.value : undefined);
  setSyncPaused(true);
  void refreshLocalData();
  goToStep(initialStep(model(), { active, identityReset: identityResetSignal.value }));
}

/** `/CONFIG` con la terminal activa: abre en Revisar. */
export function enterConfigScreen(): void {
  openWizard(true);
  activeScreenSignal.value = 'config';
}

/** Arranque sin conexión activa (modo requerido): lo llama `bootstrap`. */
export async function openRequiredWizard(): Promise<void> {
  const saved = loadSyncConfig();
  resetConfigForm(saved.ok ? saved.value : undefined);
  setSyncPaused(true);
  await refreshLocalData();
  goToStep(initialStep(model(), { active: false, identityReset: identityResetSignal.value }));
}

function leaveWizard(): void {
  probeToken += 1;
  lastSnapshot = undefined;
  resetConfigForm();
  setSyncPaused(false);
  activeScreenSignal.value = 'sale';
}

export function goToStep(step: WizardStepId): void {
  if (wizardAsyncSignal.value !== 'idle' && wizardAsyncSignal.value !== 'probing') return;
  if (wizardAsyncSignal.value === 'probing') cancelProbe();
  clearError();
  wizardStepSignal.value = step;
  if (step === 'probe' && !model().probeValid) {
    void runProbe();
  }
}

/** Salto desde la columna de pasos o Alt+N: solo a un paso alcanzable. */
export function jumpToStep(step: WizardStepId): void {
  if (isReachable(model(), step)) goToStep(step);
}

export function goBack(): void {
  goToStep(previousStep(model(), wizardStepSignal.value));
}

function showValidation(result: StepValidation): boolean {
  if (result.ok) return true;
  configErrorSignal.value = result.message;
  configErrorFieldSignal.value = result.field ?? null;
  return false;
}

/** Enter: valida el paso actual y avanza al siguiente no salteado. */
export function advance(): void {
  if (wizardAsyncSignal.value === 'confirming-wipe') {
    void confirmWipe();
    return;
  }
  if (wizardAsyncSignal.value !== 'idle') return;
  const step = wizardStepSignal.value;
  switch (step) {
    case 'terminal':
    case 'type':
    case 'connector':
      if (showValidation(validateStep(currentInput(), step))) goToStep(nextStep(model(), step));
      return;
    case 'probe':
      if (model().probeValid) goToStep(nextStep(model(), step));
      else void runProbe();
      return;
    case 'local-data':
      if (localChoiceSignal.value === 'keep') {
        localChoiceConfirmedSignal.value = true;
        goToStep(nextStep(model(), step));
      } else {
        void prepareWipe();
      }
      return;
    case 'review':
      void applyWizard();
  }
}

/** Ctrl+Enter: recorre desde el paso 1 y se frena donde haga falta el usuario. */
export function fastForward(): void {
  if (wizardAsyncSignal.value !== 'idle') return;
  for (const step of WIZARD_STEPS) {
    const current = model();
    if (current.steps.find((s) => s.id === step)?.status === 'skipped') continue;
    if (step === 'terminal' || step === 'type' || step === 'connector') {
      const validation = validateStep(currentInput(), step);
      if (!validation.ok) {
        goToStep(step);
        showValidation(validation);
        return;
      }
      continue;
    }
    if (step === 'probe' && current.probeValid) continue;
    if (step === 'local-data' && localChoiceConfirmedSignal.value) continue;
    goToStep(step);
    return;
  }
}
```

`currentInput()` arma el `WizardInput` desde los signals (el mismo objeto que usa
`wizardModelSignal`; extraerlo a una función `currentWizardInput()` exportada desde el state y usarla
en los dos lugares).

Prueba:

```typescript
function cancelProbe(): void {
  probeToken += 1;
  const key = model().connectionKey;
  probeOutcomeSignal.value = key === undefined ? null : { status: 'cancelled', key };
  probeProgressSignal.value = null;
  wizardAsyncSignal.value = 'idle';
}

async function runProbe(): Promise<void> {
  const current = model();
  const candidate = current.candidate;
  const key = current.connectionKey;
  if (candidate === undefined || key === undefined) {
    goToStep(current.firstIncomplete);
    return;
  }
  probeToken += 1;
  const token = probeToken;
  wizardAsyncSignal.value = 'probing';
  probeOutcomeSignal.value = null;
  probeProgressSignal.value = { stage: 'pulling', startedAt: Date.now() };
  const result = await probeConnection(candidate, {
    onProgress: (stage) => {
      if (token === probeToken && probeProgressSignal.value !== null) {
        probeProgressSignal.value = { ...probeProgressSignal.value, stage };
      }
    },
  });
  if (token !== probeToken) return;
  probeProgressSignal.value = null;
  wizardAsyncSignal.value = 'idle';
  if (!result.ok) {
    probeOutcomeSignal.value = { status: 'failed', key, message: describeError(result) };
    return;
  }
  lastSnapshot = { key, snapshot: result.value };
  probeOutcomeSignal.value = {
    status: 'ok',
    key,
    products: result.value.products.length,
    customers: result.value.customers.length,
  };
  await refreshLocalData();
}

export function retryProbe(): void {
  if (wizardAsyncSignal.value === 'idle') void runProbe();
}
```

Edición (cambiar el conector invalida la elección de datos locales):

```typescript
export function setConfigType(type: ConnectorType | null): void {
  configTypeSignal.value = type;
  localChoiceConfirmedSignal.value = false;
  clearError();
}

export function chooseConnectorType(type: ConnectorType): void {
  setConfigType(type);
  goToStep(nextStep(model(), 'type'));
}

export function moveTypeChoice(direction: 1 | -1): void {
  const index = CONNECTOR_TYPES.findIndex((info) => info.type === configTypeSignal.value);
  const next = index === -1 ? (direction === 1 ? 0 : CONNECTOR_TYPES.length - 1) : Math.min(Math.max(index + direction, 0), CONNECTOR_TYPES.length - 1);
  const chosen = CONNECTOR_TYPES[next];
  if (chosen !== undefined) setConfigType(chosen.type);
}

export function setConfigField(key: string, value: string): void {
  const type = configTypeSignal.value;
  if (type === null) return;
  const all = configFieldValuesSignal.value;
  configFieldValuesSignal.value = { ...all, [type]: { ...all[type], [key]: value } };
  localChoiceConfirmedSignal.value = false;
  clearError();
}

export function setConfigTerminalField(key: TerminalFieldKey, value: string): void {
  configTerminalSignal.value = { ...configTerminalSignal.value, [key]: value };
  clearError();
}

export function setLocalChoice(choice: LocalChoice): void {
  localChoiceSignal.value = choice;
  localChoiceConfirmedSignal.value = false;
}

export function moveLocalChoice(): void {
  setLocalChoice(localChoiceSignal.value === 'keep' ? 'wipe' : 'keep');
}
```

Borrar y aplicar:

```typescript
async function prepareWipe(): Promise<void> {
  wizardAsyncSignal.value = 'flushing';
  const current = savedConfigSignal.value;
  if (current !== undefined && navigator.onLine) {
    await flushPendingBeforeWipe(current);
  }
  wipeSummarySignal.value = await summarizeLocalData();
  wizardAsyncSignal.value = 'confirming-wipe';
}

export function backFromWipeConfirmation(): void {
  if (wizardAsyncSignal.value !== 'confirming-wipe') return;
  wipeSummarySignal.value = null;
  wizardAsyncSignal.value = 'idle';
}

/** Enter en la confirmación de borrado: aplica directo (spec §3, camino 3). */
export async function confirmWipe(): Promise<void> {
  if (wizardAsyncSignal.value !== 'confirming-wipe') return;
  localChoiceConfirmedSignal.value = true;
  wizardAsyncSignal.value = 'idle';
  await applyWizard();
}

export async function applyWizard(): Promise<void> {
  if (wizardAsyncSignal.value !== 'idle') return;
  const current = model();
  const action = current.applyAction;
  if (action === null) {
    goToStep(current.firstIncomplete);
    return;
  }
  wizardAsyncSignal.value = 'applying';
  if (action.kind === 'save-terminal') {
    const result = applyTerminalSettings(configTerminalSignal.value);
    wizardAsyncSignal.value = 'idle';
    if (!result.ok) {
      configErrorSignal.value = describeError(result);
      return;
    }
    finishWizard({ wiped: false });
    return;
  }
  const candidate = current.candidate;
  if (candidate === undefined || lastSnapshot === undefined || lastSnapshot.key !== current.connectionKey) {
    wizardAsyncSignal.value = 'idle';
    goToStep('probe');
    return;
  }
  const result = await applyConnection({
    candidate,
    snapshot: lastSnapshot.snapshot,
    local: action.local,
    originChanged: action.originChanged,
    now: new Date().toISOString(),
  });
  wizardAsyncSignal.value = 'idle';
  if (!result.ok) {
    wizardStepSignal.value = 'review';
    configErrorSignal.value = describeError(result);
    return;
  }
  finishWizard({ wiped: action.local === 'wipe' });
  void runPushThenPull();
}

function finishWizard(params: { wiped: boolean }): void {
  if (params.wiped) {
    // La venta en curso ya no existe en la base: se vacía también en memoria.
    cartSignal.value = { lines: [] };
    cartSelectionIndexSignal.value = null;
    resetAttachedCustomer();
  }
  identityResetSignal.value = false;
  leaveWizard();
}
```

Esc:

```typescript
export function handleWizardEscape(): void {
  switch (wizardAsyncSignal.value) {
    case 'probing':
      cancelProbe();
      return;
    case 'confirming-wipe':
      backFromWipeConfirmation();
      return;
    case 'flushing':
    case 'applying':
      return;
    case 'idle':
      if (connectionStateSignal.value === 'active') leaveWizard();
  }
}
```

(`applyWizard` en `save-terminal` con estado `incomplete`: `applyTerminalSettings` ya pone el estado en
`active`, y `ui/app.tsx` pasa sola a la venta.)

- [ ] **Step 5: Bootstrap** — en `bootstrap.ts`, reemplazar `resetConfigForm(...)` en la rama
`state !== 'active'` por `await openRequiredWizard();` (import desde `./keyboard/config-controller.ts`).

- [ ] **Step 6: Quitar `planConnectionChange`** de `connection.ts` y sus tests de `connection.test.ts`;
buscar otros usos: `grep -rn "planConnectionChange\|configPhaseSignal\|configConfirmationSignal\|handleConfigEscape\|submitConfig\|confirmConfigChange\|backToEditing\|cancelConfigScreen" src`
y actualizarlos (la pantalla se reescribe en la Task 8; mientras tanto, si `config-screen.tsx` no compila,
dejar en esta task un stub mínimo que renderice el título y llame a `advance`/`handleWizardEscape`, que la
Task 8 reemplaza).

- [ ] **Step 7: Correr** — `pnpm vitest run src/ui/keyboard src/sync && pnpm typecheck` → PASS.

- [ ] **Step 8: Commit** — `feat(ui): estado y controller del wizard de /CONFIG (#97)`.

---

### Task 8: Pantalla del wizard

**Files:**
- Create: `src/ui/components/Spinner.tsx`
- Modify: `src/ui/tokens.css` (keyframes del spinner, estilos del wizard)
- Rewrite: `src/ui/screens/config-screen.tsx`
- Rewrite: `src/ui/screens/config-screen.test.tsx`
- Create: `src/ui/hooks/use-mouse-keeps-focus.ts` (se adelanta de la Task 9: la pantalla lo usa)

**Interfaces:**
- Consumes: Task 7 completa, `connectorInfo`/`CONNECTOR_TYPES` (Task 5), `formatDate` (`ui/format.ts`).
- Produces: `Spinner({ label }: { label: string })`; `keepFocusOnMouseDown(event: MouseEvent): void`.

Nombres accesibles (los usan los e2e — **exactos**):
- Pasos de la columna: botones `Paso 1: Terminal` … `Paso 6: Revisar` (`aria-current="step"` en el actual).
- Inputs: `Sucursal`, `Punto de venta`, `Locale (opcional)`, y los del conector con `fieldLabel(field)`.
- Opciones de tipo: botones con el `label` del tipo (`REST genérico`, `REST (minibackend de demo)`, `Google Sheets`), `aria-pressed` en el elegido.
- Opciones de datos locales: `Mantener los datos locales`, `Borrar los datos locales`.
- Pie: `Atrás (Alt+←)`, `Siguiente (Enter)`, `Aplicar (Enter)` (en Revisar), `Cancelar (Esc)` (solo con la terminal activa), `Reintentar (Enter)`, `Corregir datos (Alt+3)`, `Borrar y cambiar (Enter)`, `Volver (Esc)`.
- Estado de espera: `role="status"`.

- [ ] **Step 1: `keepFocusOnMouseDown` (test + impl)** — `src/ui/hooks/use-mouse-keeps-focus.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { keepFocusOnMouseDown } from './use-mouse-keeps-focus.ts';

function mouseDownOn(target: Element, button = 0): MouseEvent {
  const event = new MouseEvent('mousedown', { button, cancelable: true, bubbles: true });
  target.dispatchEvent(event);
  return event;
}

describe('keepFocusOnMouseDown', () => {
  const setup = (html: string) => {
    document.body.innerHTML = `<div id="root">${html}</div>`;
    const root = document.getElementById('root');
    root?.addEventListener('mousedown', keepFocusOnMouseDown);
    return root;
  };

  it('cancela el botón izquierdo sobre algo que no es un control de texto', () => {
    setup('<p id="t">texto</p><button id="b">x</button>');
    expect(mouseDownOn(document.getElementById('t') as Element).defaultPrevented).toBe(true);
    expect(mouseDownOn(document.getElementById('b') as Element).defaultPrevented).toBe(true);
  });

  it('no toca inputs', () => {
    setup('<input id="i" />');
    expect(mouseDownOn(document.getElementById('i') as Element).defaultPrevented).toBe(false);
  });

  it('no toca el botón del medio (autoscroll)', () => {
    setup('<p id="t">texto</p>');
    expect(mouseDownOn(document.getElementById('t') as Element, 1).defaultPrevented).toBe(false);
  });
});
```

Implementación `src/ui/hooks/use-mouse-keeps-focus.ts`:

```typescript
const TEXT_CONTROLS = 'input, textarea, select';

/**
 * Patrón teclado + mouse (Etapa 2 de #94, sacado de `/RESUMEN`): va en el
 * `onMouseDown` del contenedor de una pantalla. Un click con el botón
 * izquierdo sobre algo que no es un control de texto le sacaría el foco al
 * "hogar" de la pantalla (el input o el contenedor) y lo dejaría en `<body>`,
 * donde los atajos ya no llegan — se cancela el `mousedown` (el `click` se
 * dispara igual). Los controles de texto quedan afuera para poder ubicar el
 * cursor con el mouse. Los demás botones no se tocan: la rueda y el
 * autoscroll con el botón del medio siguen andando.
 */
export function keepFocusOnMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return;
  const target = event.target;
  if (target instanceof Element && target.closest(TEXT_CONTROLS) !== null) return;
  event.preventDefault();
}
```

- [ ] **Step 2: Spinner** — `src/ui/components/Spinner.tsx`:

```tsx
/** Actividad en curso mientras se espera a un servicio (Etapa 2 de #94). Decorativo: el texto va aparte en un `role="status"`. */
export function Spinner() {
  return <span class="spinner" aria-hidden="true" />;
}
```

En `tokens.css`:

```css
.spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spinner-turn 0.8s linear infinite;
  vertical-align: -0.15em;
}
@keyframes spinner-turn {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .spinner { animation: none; border-top-color: var(--color-border); border-right-color: var(--color-accent); }
}
.wizard-step-button:hover { background: var(--color-surface); }
.wizard-option:hover { border-color: var(--color-accent); }
```

(Verificar que `--color-accent`, `--color-surface`, `--color-border` existan en `tokens.css`; usar
los equivalentes si no.)

- [ ] **Step 3: Tests de pantalla que fallan** — reescribir `config-screen.test.tsx` (mantener el
mock de `runPushThenPull`, `okResponse`, `stubRestBackend`, `beforeEach/afterEach` de base):

```typescript
describe('ConfigScreen — wizard', () => {
  beforeEach(async () => {
    connectionStateSignal.value = 'unconfigured';
    await openRequiredWizard();
  });

  it('muestra los seis pasos y arranca en Terminal', () => {
    render(<ConfigScreen />);
    for (const title of ['Terminal', 'Tipo de conexión', 'Datos del conector', 'Probar', 'Datos locales', 'Revisar']) {
      expect(screen.getByRole('button', { name: new RegExp(`Paso \\d: ${title}`) })).not.toBeNull();
    }
    expect(document.activeElement).toBe(screen.getByLabelText('Sucursal'));
  });

  it('Enter sin sucursal muestra el error y selecciona el campo', () => {
    render(<ConfigScreen />);
    fireEvent.keyDown(screen.getByLabelText('Sucursal'), { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toContain('Sucursal');
  });

  it('con el mouse: completar terminal, elegir tipo con click, avanzar con el botón', async () => {
    stubRestBackend();
    render(<ConfigScreen />);
    fireEvent.input(screen.getByLabelText('Sucursal'), { target: { value: 'Centro' } });
    fireEvent.input(screen.getByLabelText('Punto de venta'), { target: { value: 'Caja 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente (Enter)' }));
    fireEvent.click(screen.getByRole('button', { name: /^REST genérico/ }));
    fireEvent.input(screen.getByLabelText('URL base del backend'), { target: { value: 'http://a.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente (Enter)' }));
    await waitFor(() => expect(screen.getByText(/Conexión OK/)).not.toBeNull());
  });

  it('mientras prueba muestra spinner, qué espera y los segundos', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    configTerminalSignal.value = { branch: 'Centro', pointOfSale: 'Caja 1', locale: '' };
    setConfigType('rest');
    setConfigField('baseUrl', 'http://a.test');
    render(<ConfigScreen />);
    jumpToStep('probe');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Pidiendo productos, stock y clientes/));
    expect(document.querySelector('.spinner')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/máx\. 20 s/);
  });

  it('Alt+1 vuelve a Terminal desde otro paso', () => {
    configTerminalSignal.value = { branch: 'Centro', pointOfSale: 'Caja 1', locale: '' };
    render(<ConfigScreen />);
    jumpToStep('type');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: '1', altKey: true });
    expect(wizardStepSignal.value).toBe('terminal');
  });

  it('en modo requerido no hay botón Cancelar', () => {
    render(<ConfigScreen />);
    expect(screen.queryByRole('button', { name: 'Cancelar (Esc)' })).toBeNull();
  });
});

describe('ConfigScreen — terminal activa', () => {
  beforeEach(() => {
    saveSyncConfig({ type: 'rest', baseUrl: 'http://a.test', branch: 'Centro', pointOfSale: 'Caja 1', verifiedAt: '2026-09-23T14:02:00.000Z' });
    connectionStateSignal.value = 'active';
    enterConfigScreen();
  });

  it('abre en Revisar con el resumen y Cancelar', () => {
    render(<ConfigScreen />);
    expect(screen.getByRole('button', { name: 'Aplicar (Enter)' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Cancelar (Esc)' })).not.toBeNull();
    expect(screen.getByText(/Centro · Caja 1/)).not.toBeNull();
  });

  it('Esc sale', () => {
    render(<ConfigScreen />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(activeScreenSignal.value).toBe('sale');
  });
});
```

(El label del campo de URL REST es el que declara `connectors/rest/config.ts` — leerlo y usar el
texto exacto.)

- [ ] **Step 4: Correr** → FAIL.

- [ ] **Step 5: Implementación** — `config-screen.tsx`. Estructura:

```tsx
/**
 * `/CONFIG` como wizard de instalación (Etapa 2 de #94, #97): columna de pasos
 * a la izquierda (resumen visible de todo lo cargado, click o Alt+N para
 * volver), el paso actual a la derecha, pie con atajos y botones. Las reglas
 * viven en `config-wizard-model.ts`; la orquestación en `config-controller.ts`.
 * Reemplaza para esta pantalla el criterio de #49 ("no un wizard secuencial
 * que oculta lo ya cargado"): lo cargado nunca se oculta, queda en la columna.
 * Teclado y mouse equivalentes (`keepFocusOnMouseDown`).
 */
export function ConfigScreen() {
  const dialogRef = useRef<HTMLDivElement>(null);
  const step = wizardStepSignal.value;
  const async = wizardAsyncSignal.value;
  const model = wizardModelSignal.value;
  const required = connectionStateSignal.value !== 'active';

  // Foco al cambiar de paso: el primer control del paso, o el diálogo si no tiene.
  useLayoutEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>('[data-step-autofocus]');
    (first ?? dialogRef.current)?.focus();
  }, [step, async]);

  // Error con campo: enfocarlo y seleccionarlo (como hoy).
  useLayoutEffect(() => { /* igual que el efecto actual, sobre [data-config-field] */ }, [configErrorFieldSignal.value, configErrorSignal.value]);

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); handleWizardEscape(); return; }
    if (event.altKey && /^[1-6]$/.test(event.key)) {
      event.preventDefault();
      const target = WIZARD_STEPS[Number(event.key) - 1];
      if (target !== undefined) jumpToStep(target);
      return;
    }
    if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); goBack(); return; }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && async === 'idle') {
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      if (step === 'type') { event.preventDefault(); moveTypeChoice(direction); return; }
      if (step === 'local-data') { event.preventDefault(); moveLocalChoice(); return; }
    }
    if (event.key === 'Enter') {
      // Un botón enfocado con Tab se activa solo (nativo): no duplicar.
      if (event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      if (event.ctrlKey) fastForward();
      else advance();
    }
  };

  return (
    <div style={overlayStyle} onMouseDown={keepFocusOnMouseDown}>
      <div ref={dialogRef} role="dialog" aria-label="Configurar conexión" tabIndex={-1} onKeyDown={handleKeyDown} style={dialogStyle}>
        <h1>Configurar conexión</h1>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 'var(--space-4)', minHeight: 0, flex: 1 }}>
          <StepList model={model} current={step} />
          <div style={{ overflowY: 'auto', minHeight: 0 }}>
            <StepContent step={step} />
          </div>
        </div>
        <Footer step={step} async={async} required={required} model={model} />
      </div>
    </div>
  );
}
```

Estilos: `overlayStyle` como hoy; `dialogStyle` con `maxWidth: '860px'`, `maxHeight: 'calc(var(--app-height) - 2 * var(--space-4))'`,
`display: flex; flexDirection: column`. Nada con `fontSize` menor a `var(--font-size-sm)`.

Componentes (en el mismo archivo; si pasa de ~500 líneas, moverlos a `src/ui/screens/config-wizard/`):

- `StepList`: por cada `model.steps`, un `<button class="wizard-step-button" aria-label={`Paso ${n}: ${title}`} aria-current={current===id ? 'step' : undefined} disabled={!isReachable(model,id) && current!==id} onClick={() => jumpToStep(id)}>` con número, título, un indicador de estado (`✓` completo, `!` error, `—` salteado) y el resumen de `stepSummary(id)` en texto secundario.
- `stepSummary(id)` (función local que lee los signals):
  - terminal: `[branch, pointOfSale, locale].filter(Boolean).join(' · ')`
  - type: `connectorLabel(type)`
  - connector: por campo con valor, `field.secret ? `${field.label}: •••` : value`, unidos con ` · `
  - probe: salteado → `Ya probada el ${formatDate(saved.verifiedAt)}`; ok → `OK: N productos, M clientes`; failed → `Falló`; cancelled → `Cancelada`
  - local-data: salteado `no-user-data` → `Sin datos locales para conservar`; si no, `Mantener` / `Borrar`
  - review: `''`
- `StepContent`:
  - `terminal`: aviso si `identityResetSignal` (`role="alert"` no — usar un `<p>` con borde de advertencia: "Esta terminal no tenía identidad: se reinició con datos vacíos."); inputs `Sucursal` (con `data-step-autofocus`), `Punto de venta`, `Locale (opcional)`, con `data-config-field` y `onInput` → `setConfigTerminalField`.
  - `type`: por cada `CONNECTOR_TYPES`, `<button class="wizard-option" aria-pressed={selected} onClick={() => chooseConnectorType(info.type)}>` con label en negrita y `description` debajo. El contenedor de la lista lleva `data-step-autofocus` y `tabIndex={-1}` (↑/↓ los maneja el diálogo).
  - `connector`: campos de `connectorFields(type)` (primer input con `data-step-autofocus`), después `<ol>` con `connectorInfo(type).setupHelp`.
  - `probe`: con `async==='probing'`: `<p role="status"><Spinner /> {texto de etapa} · {segundos} s (máx. 20 s)</p>` y, si `type==='google-sheets'` y segundos ≥ 3, "Google Sheets suele tardar entre 5 y 20 segundos." Los segundos salen de un hook local `useElapsedSeconds(startedAt)` (`setInterval` de 250 ms en un `useEffect`, limpia al desmontar). Texto de etapa: `waiting-lock` → "Esperando que termine una sincronización en curso…"; `pulling` → `Pidiendo productos, stock y clientes a ${host}…` (`host` = `new URL(url).host` del campo de URL del tipo, con try/catch → la URL cruda). Resultado ok: "Conexión OK: N productos, M clientes." failed: `<p role="alert">` con el mensaje. cancelled: "Prueba cancelada."
  - `local-data`: con `async==='flushing'`: `<p role="status"><Spinner /> Enviando N eventos pendientes a {host actual}…</p>` (N de `localDataSignal.pendingOutbox`). Con `confirming-wipe`: la tarjeta de confirmación actual (`ConfirmationCard` con `wipeSummarySignal`, texto "Se van a borrar: …" y lo no enviado destacado). Si no: dos `<button class="wizard-option" aria-pressed>` (`Mantener los datos locales` / `Borrar los datos locales`, `onClick` → `setLocalChoice`) con explicación; con `keep` y `model.originChanged` y `pendingOutbox > 0`: "N eventos sin enviar se van a mandar a la conexión nueva."
  - `review`: lista de los pasos con su resumen, y la frase de qué va a pasar según `model.applyAction`: `save-terminal` → "Se guarda la sucursal, el punto de venta y el locale."; `apply-connection keep` → `Se conecta a ${host} y se conservan ${sales} ventas.` (o "…y se conservan los datos locales." si `sales === 0`); `wipe` → `Se conecta a ${host} y se borran los datos locales.`. Con `async==='applying'`: `<p role="status"><Spinner /> Aplicando…</p>`. Error de `configErrorSignal` en `role="alert"`.
  - Slot de error común (altura fija) debajo del contenido para `configErrorSignal` en los pasos 1–3.
- `Footer`: ayuda de atajos a la izquierda (`Enter siguiente · Alt+1…6 ir a un paso · Alt+← atrás · Ctrl+Enter avanzar hasta donde falte` + `· Esc cancelar` si no es requerido), botones a la derecha según estado:
  - `confirming-wipe`: `Volver (Esc)` → `backFromWipeConfirmation`, `Borrar y cambiar (Enter)` → `confirmWipe`.
  - `probing`: `Cancelar prueba (Esc)` → `handleWizardEscape`.
  - `probe` con failed/cancelled: `Corregir datos (Alt+3)` → `jumpToStep('connector')`, `Reintentar (Enter)` → `retryProbe`.
  - resto: `Cancelar (Esc)` si `!required` → `handleWizardEscape`; `Atrás (Alt+←)` (deshabilitado en el paso 1) → `goBack`; `Aplicar (Enter)` en `review` → `applyWizard`, si no `Siguiente (Enter)` → `advance`.
  - Todo botón deshabilitado mientras `async` es `flushing` o `applying`.

- [ ] **Step 6: Correr** — `pnpm vitest run src/ui/screens/config-screen.test.tsx src/ui/hooks` → PASS; `pnpm typecheck && pnpm lint`.

- [ ] **Step 7: Revisión visual** — `pnpm build && pnpm preview`, abrir en el navegador del panel,
borrar `localStorage` para ver el modo requerido, y capturar el wizard a 600, 1024 y 1440px de ancho
(`resize_window`). Confirmar: ningún texto se superpone, la columna de pasos y el pie quedan fijos, el
contenido scrollea por dentro. Corregir lo que haga falta.

- [ ] **Step 8: Commit** — `feat(ui): /CONFIG como wizard de instalación (#97)`.

---

### Task 9: `/RESUMEN` al handler compartido

**Files:**
- Modify: `src/ui/screens/cash-summary-screen.tsx`
- Test: `src/ui/screens/cash-summary-screen.test.tsx`

- [ ] **Step 1: Test que falla**

```typescript
it('el botón del medio no se cancela (autoscroll)', () => {
  renderSummary(); // helper que ya use el archivo para montar la pantalla
  const title = screen.getByRole('heading');
  const event = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true });
  title.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
```

- [ ] **Step 2: Correr** → FAIL.
- [ ] **Step 3: Implementación** — borrar `handleMouseDown` local y usar
`onMouseDown={keepFocusOnMouseDown}`; mover el comentario explicativo al handler compartido (ya
está) y dejar una línea: `// Patrón teclado + mouse: ver ui/hooks/use-mouse-keeps-focus.ts.`
- [ ] **Step 4: Correr** — `pnpm vitest run src/ui/screens/cash-summary-screen.test.tsx` → PASS.
- [ ] **Step 5: Commit** — `refactor(ui): /RESUMEN usa keepFocusOnMouseDown (#97)`.

---

### Task 10: Comandos habilitados y preselección

**Files:**
- Modify: `src/ui/keyboard/commands.ts`
- Modify: `src/ui/state/command-bar.ts`
- Modify: `src/ui/keyboard/command-bar-controller.ts`
- Test: `src/ui/state/command-bar.test.ts`, `src/ui/keyboard/command-bar-controller.test.ts`

**Interfaces:**
- Produces:

```typescript
// commands.ts
export type CommandAvailability = { enabled: true } | { enabled: false; reason: string };
export type CommandInfo = { name: string; description: string; availability?: () => CommandAvailability };
export function disabledCommandMessage(name: string, reason: string): string; // `/${name} no está disponible: ${reason}.`
// command-bar.ts
export type CommandResult = CommandInfo & { availability: CommandAvailability }; // reemplaza el tipo de commandResultsSignal
export const commandResultsSignal: ReadonlySignal<CommandResult[]>;
export const defaultCommandIndexSignal: ReadonlySignal<number | null>;
export const effectiveCommandIndexSignal: ReadonlySignal<number | null>;
```

Nota de tipo: `availability` es opcional y función en `CommandInfo`, obligatoria y valor en
`CommandResult` — como las dos usan el mismo nombre, definir `CommandResult` como
`Omit<CommandInfo, 'availability'> & { availability: CommandAvailability }`.

- [ ] **Step 1: Tests que fallan** — en `command-bar-controller.test.ts` (seguir su setup):

```typescript
describe('comandos habilitados', () => {
  it('con carrito vacío y sin cliente, "/" no preselecciona /COBRAR y Enter no hace nada', () => {
    updateCommandBarBuffer('/');
    expect(commandResultsSignal.value[0]).toMatchObject({ name: 'COBRAR', availability: { enabled: false } });
    expect(effectiveCommandIndexSignal.value).toBeNull();
    submitCommandBar();
    expect(activeScreenSignal.value).toBe('sale');
    expect(commandBarErrorSignal.value).toBeNull();
  });

  it('"/COBRAR" completo + Enter muestra el motivo', () => {
    updateCommandBarBuffer('/COBRAR');
    submitCommandBar();
    expect(commandBarErrorSignal.value).toBe('/COBRAR no está disponible: sin artículos ni cliente.');
  });

  it('↓ saltea los deshabilitados', () => {
    updateCommandBarBuffer('/');
    moveSelection(1);
    expect(commandResultsSignal.value[effectiveCommandIndexSignal.value ?? -1]?.name).toBe('CAJA');
  });

  it('con un artículo, /COBRAR vuelve a preseleccionarse', () => {
    cartSignal.value = { lines: [freeformLine] };
    updateCommandBarBuffer('/');
    expect(effectiveCommandIndexSignal.value).toBe(0);
  });

  it('con cliente y sin artículos, /COBRAR está habilitado', () => {
    attachedCustomerSignal.value = someCustomer;
    updateCommandBarBuffer('/');
    expect(commandResultsSignal.value[0]?.availability.enabled).toBe(true);
  });

  it('Ctrl+Enter (triggerCheckout) con /COBRAR deshabilitado muestra el motivo', async () => {
    await triggerCheckout();
    expect(commandBarErrorSignal.value).toBe('/COBRAR no está disponible: sin artículos ni cliente.');
  });
});
```

(`freeformLine`/`someCustomer`: construirlos con los helpers que ya use el archivo; revisar que los
tests existentes de `/COBRAR` agreguen un artículo o cliente antes — si no, actualizarlos.)

- [ ] **Step 2: Correr** → FAIL.

- [ ] **Step 3: Implementación**

`commands.ts`:

```typescript
export type CommandAvailability = { enabled: true } | { enabled: false; reason: string };

export type CommandInfo = {
  name: string;
  description: string;
  /**
   * Etapa 2 de #94: un comando puede estar deshabilitado según el estado de la
   * venta. Se deriva de signals (se lee dentro de `commandResultsSignal`).
   * Ausente = siempre habilitado.
   */
  availability?: () => CommandAvailability;
};

const ENABLED: CommandAvailability = { enabled: true };

function checkoutAvailability(): CommandAvailability {
  return cartSignal.value.lines.length > 0 || attachedCustomerSignal.value !== null
    ? ENABLED
    : { enabled: false, reason: 'sin artículos ni cliente' };
}

export function disabledCommandMessage(name: string, reason: string): string {
  return `/${name} no está disponible: ${reason}.`;
}

/** Disponibilidad actual de un comando por nombre (para Ctrl+Enter, que no pasa por el menú). */
export function commandAvailability(name: string): CommandAvailability {
  return availableCommands().find((command) => command.name === name)?.availability?.() ?? ENABLED;
}
```

y en `CORE_COMMANDS`: `{ name: 'COBRAR', description: …, availability: checkoutAvailability }`.
(Verificar el nombre real del signal de cliente adjunto en `ui/state/customer.ts`.)

`command-bar.ts`:

```typescript
export type CommandResult = Omit<CommandInfo, 'availability'> & { availability: CommandAvailability };

export const commandResultsSignal = computed<CommandResult[]>(() => {
  const parsed = parsedSignal.value;
  if (parsed.kind !== 'command') return [];
  return availableCommands()
    .filter((command) => command.name.startsWith(parsed.name))
    .map(({ availability, ...command }) => ({ ...command, availability: availability?.() ?? { enabled: true } }));
});

/**
 * Preselección del menú de "/" (issue #40, refinada en la Etapa 2 de #94): la
 * fila 0 solo si está habilitada — si no, nada, y Enter no ejecuta nada hasta
 * que el usuario elija. Así "/" con el carrito vacío no deja /COBRAR a un Enter.
 */
export const defaultCommandIndexSignal = computed<number | null>(() =>
  commandResultsSignal.value[0]?.availability.enabled === true ? 0 : null,
);

/** La fila que Enter ejecutaría: la elegida con ↑/↓ o click, o la preselección. */
export const effectiveCommandIndexSignal = computed<number | null>(
  () => commandSelectionIndexSignal.value ?? defaultCommandIndexSignal.value,
);
```

`command-bar-controller.ts`:
- En `submitCommandBar`, rama `command`:

```typescript
    case 'command': {
      const results = commandResultsSignal.value;
      const index = effectiveCommandIndexSignal.value;
      const selected = index === null ? undefined : results[index];
      if (selected === undefined) {
        const exact = results.find((command) => command.name === parsed.name);
        if (exact !== undefined && !exact.availability.enabled) {
          commandBarErrorSignal.value = disabledCommandMessage(exact.name, exact.availability.reason);
          return;
        }
        if (results.length === 0) {
          commandBarErrorSignal.value = `Comando desconocido: /${parsed.name}`;
        }
        return;
      }
      if (!selected.availability.enabled) {
        commandBarErrorSignal.value = disabledCommandMessage(selected.name, selected.availability.reason);
        return;
      }
      runCommand(selected.name, parsed.args);
      return;
    }
```

- En `moveSelection`, rama `command`, reemplazar por:

```typescript
  if (parsed.kind === 'command') {
    moveCommandSelection(direction);
    return;
  }
```

con:

```typescript
/** ↑/↓ en el menú de "/": saltea los comandos deshabilitados; sin otro habilitado, no se mueve. */
function moveCommandSelection(direction: 1 | -1): void {
  const results = commandResultsSignal.value;
  const start = effectiveCommandIndexSignal.value ?? (direction === 1 ? -1 : results.length);
  for (let i = start + direction; i >= 0 && i < results.length; i += direction) {
    if (results[i]?.availability.enabled === true) {
      commandSelectionIndexSignal.value = i;
      return;
    }
  }
}
```

- En `triggerCheckout`, antes del chequeo de turno:

```typescript
  const availability = commandAvailability('COBRAR');
  if (!availability.enabled) {
    commandBarErrorSignal.value = disabledCommandMessage('COBRAR', availability.reason);
    return;
  }
```

- `identityOfCommandResult`/`reindexByIdentity`: sigue funcionando con `CommandResult` (usa `name`).

- [ ] **Step 4: Correr** — `pnpm vitest run src/ui` → PASS (actualizar tests existentes de `/COBRAR`
o del menú que asumían preselección con carrito vacío).

- [ ] **Step 5: Commit** — `feat(ui): comandos habilitados y preselección del menú de "/" (#97)`.

---

### Task 11: Mouse en la pantalla de venta

**Files:**
- Modify: `src/ui/keyboard/command-bar-controller.ts` (`activateCommandBarRow`)
- Modify: `src/ui/components/CommandBarInput.tsx`
- Modify: `src/ui/screens/sale-screen.tsx`
- Modify: `src/ui/tokens.css` (hover de filas)
- Test: `src/ui/components/CommandBarInput.test.tsx`, `src/ui/keyboard/command-bar-controller.test.ts`

**Interfaces:**
- Consumes: `keepFocusOnMouseDown` (Task 8), `effectiveCommandIndexSignal` (Task 10).
- Produces: `activateCommandBarRow(list: 'command' | 'customer' | 'search', index: number): void`

- [ ] **Step 1: Tests que fallan** — en `command-bar-controller.test.ts`:

```typescript
describe('activateCommandBarRow', () => {
  it('comando: ejecuta la fila clickeada', () => {
    updateCommandBarBuffer('/');
    const index = commandResultsSignal.value.findIndex((c) => c.name === 'DIAGNOSTICO');
    activateCommandBarRow('command', index);
    expect(activeScreenSignal.value).toBe('diagnostico');
  });
  it('comando deshabilitado: no hace nada', () => {
    updateCommandBarBuffer('/');
    activateCommandBarRow('command', 0); // COBRAR con carrito vacío
    expect(activeScreenSignal.value).toBe('sale');
  });
  it('cliente: adjunta el clickeado; la fila de Consumidor Final desadjunta', () => {
    // sembrar dos clientes en el repositorio como hace el archivo
    updateCommandBarBuffer('@');
    activateCommandBarRow('customer', 1);
    expect(attachedCustomerSignal.value).not.toBeNull();
    updateCommandBarBuffer('@');
    activateCommandBarRow('customer', 0);
    expect(attachedCustomerSignal.value).toBeNull();
  });
  it('artículo: agrega el producto clickeado', async () => {
    updateCommandBarBuffer('arr');
    activateCommandBarRow('search', 0);
    await vi.waitFor(() => expect(cartSignal.value.lines).toHaveLength(1));
  });
});
```

En `CommandBarInput.test.tsx`:

```typescript
it('click en una fila del overlay ejecuta y el input conserva el foco', async () => {
  render(<CommandBarInput />);
  const input = screen.getByLabelText('Barra de comandos');
  fireEvent.input(input, { target: { value: '/DIAG' } });
  const row = screen.getByText('/DIAGNOSTICO').closest('li');
  const down = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
  row?.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  fireEvent.click(row as Element);
  expect(activeScreenSignal.value).toBe('diagnostico');
});
```

Y en un test de `SaleScreen` (crear `src/ui/screens/sale-screen.test.tsx` si no existe, con el setup
mínimo de repositorios que usa `CommandBarInput.test.tsx`):

```typescript
it('click fuera del overlay lo cierra sin tocar el buffer', () => {
  render(<SaleScreen />);
  fireEvent.input(screen.getByLabelText('Barra de comandos'), { target: { value: '/' } });
  fireEvent.mouseDown(screen.getByText(/CLIENTE/i));
  expect(overlayDismissedSignal.value).toBe(true);
  expect(commandBarBufferSignal.value).toBe('/');
});
```

- [ ] **Step 2: Correr** → FAIL.

- [ ] **Step 3: Implementación**

Controller:

```typescript
/**
 * Click en una fila de un overlay de la barra (Etapa 2 de #94): lo mismo que
 * llevar la selección ahí y apretar Enter — mismo camino (`submitCommandBar`,
 * con `pendingBarOperation`). Ejecuta de una. Un comando deshabilitado no hace
 * nada. En clientes, un índice igual al largo de la lista es "+ Crear cliente".
 */
export function activateCommandBarRow(list: 'command' | 'customer' | 'search', index: number): void {
  switch (list) {
    case 'command':
      if (commandResultsSignal.value[index]?.availability.enabled !== true) return;
      commandSelectionIndexSignal.value = index;
      break;
    case 'customer':
      customerSelectionIndexSignal.value = index;
      break;
    case 'search':
      searchSelectionIndexSignal.value = index;
      break;
  }
  submitCommandBar();
}
```

`CommandBarInput.tsx`:
- El `div` absoluto del overlay suma `data-command-bar-overlay`.
- `selectedCommandIndex = effectiveCommandIndexSignal.value` (ya no `?? 0`).
- Cada `<li>` de las tres listas: `class="command-bar-row"`, `onClick={() => activateCommandBarRow(<lista>, index)}`. La fila "+ Crear cliente" usa `activateCommandBarRow('customer', customerResults.length)`.
- Fila de comando deshabilitada: `aria-disabled="true"`, `style` con `opacity: 0.5`, y a la derecha el motivo en `subtextStyle(false)`: `— {command.availability.reason}`; nunca con el fondo de selección.

`tokens.css`:

```css
/* Hover decorativo (Etapa 2 de #94): nunca mueve la selección — Enter sigue ejecutando la fila resaltada. */
.command-bar-row { cursor: pointer; }
.command-bar-row:hover:not([aria-disabled='true']) { box-shadow: inset 0 0 0 1px var(--color-chrome-border); }
.command-bar-row[aria-disabled='true'] { cursor: default; }
```

`sale-screen.tsx` — en la raíz:

```tsx
  // Teclado + mouse (Etapa 2 de #94): ningún click le saca el foco a la barra
  // de comandos, y un click fuera del overlay lo cierra como Esc (#28), sin
  // tocar lo tipeado. Solo el botón izquierdo: rueda y autoscroll siguen.
  const handleMouseDown = (event: MouseEvent) => {
    keepFocusOnMouseDown(event);
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-command-bar-overlay], .command-bar-input') === null) {
      dismissCommandBarOverlay();
    }
  };
```

y `onMouseDown={handleMouseDown}` en el `div` raíz.

- [ ] **Step 4: Correr** — `pnpm vitest run src/ui` → PASS.
- [ ] **Step 5: Commit** — `feat(ui): mouse en la barra de comandos y sus overlays (#97)`.

---

### Task 12: Mouse y botones en `/ANULAR`, comprobante, `/DIAGNOSTICO`, `/DEMO_RESET`

**Files:**
- Modify: `src/ui/keyboard/void-controller.ts` (`activateVoidRow`)
- Modify: `src/ui/screens/void-sale-screen.tsx`, `receipt-screen.tsx`, `diagnostico-screen.tsx`, `demo-reset-screen.tsx`
- Test: los `*.test.tsx` de cada pantalla, `void-controller.test.ts`

**Interfaces:**
- Produces: `activateVoidRow(index: number): void` (selecciona y pasa a confirmación)

- [ ] **Step 1: Tests que fallan**

`void-controller.test.ts`:

```typescript
it('activateVoidRow selecciona y pide confirmación', async () => {
  await db.sales.bulkPut([closedSale('a'), closedSale('b')]);
  await loadVoidableSales();
  activateVoidRow(1);
  expect(voidSelectionIndexSignal.value).toBe(1);
  expect(voidConfirmingSignal.value).toBe(true);
});
```

`void-sale-screen.test.tsx`:

```typescript
it('con mouse: click en una venta, después "Anular (Enter)"', async () => {
  // sembrar una venta cerrada como el archivo
  render(<VoidSaleScreen />);
  const row = await screen.findByText(formatMoney(100));
  fireEvent.click(row.closest('li') as Element);
  fireEvent.click(screen.getByRole('button', { name: 'Anular (Enter)' }));
  await waitFor(() => expect(/* la venta quedó anulada, como verifica el test de teclado existente */).toBe(true));
});
it('"Volver a la venta (Esc)" sale', () => {
  render(<VoidSaleScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Volver a la venta (Esc)' }));
  expect(activeScreenSignal.value).toBe('sale');
});
```

`diagnostico-screen.test.tsx`:

```typescript
it('"Cerrar (Esc)" vuelve a la venta', () => {
  render(<DiagnosticoScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar (Esc)' }));
  expect(activeScreenSignal.value).toBe('sale');
});
```

`demo-reset-screen.test.tsx` (crear si no existe, mockeando `confirmDemoReset`/`exitDemoResetScreen`
con `vi.mock('../keyboard/demo-reset-controller.ts')`):

```typescript
it('botones de confirmar y cancelar', () => {
  render(<DemoResetScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Reiniciar demo (Enter)' }));
  expect(confirmDemoReset).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar (Esc)' }));
  expect(exitDemoResetScreen).toHaveBeenCalled();
});
```

Y en cada una de las cuatro pantallas, un test de que un `mousedown` izquierdo sobre el título queda
`defaultPrevented` (mismo patrón que la Task 9).

- [ ] **Step 2: Correr** → FAIL.

- [ ] **Step 3: Implementación**
- `void-controller.ts`:

```typescript
/** Click en una venta de la lista: lo mismo que ↑/↓ hasta ella + Enter. */
export function activateVoidRow(index: number): void {
  if (index < 0 || index >= voidableSalesSignal.value.length) return;
  voidSelectionIndexSignal.value = index;
  selectForVoid();
}
```

- `void-sale-screen.tsx`: `onMouseDown={keepFocusOnMouseDown}` en el contenedor; cada `<li>` con
  `onClick={() => activateVoidRow(index)}`, `cursor: pointer`; en la confirmación, botones
  `Volver (Esc)` → `cancelVoidConfirmation` y `Anular (Enter)` → `void confirmVoid()`; reemplazar el
  texto final "Esc para volver a la venta." por el botón `Volver a la venta (Esc)` → `exitVoidScreen`
  (visible fuera de la confirmación).
- `receipt-screen.tsx`: `onMouseDown={keepFocusOnMouseDown}` en el contenedor con el `onKeyDown`.
- `diagnostico-screen.tsx`: `onMouseDown={keepFocusOnMouseDown}` y botón `Cerrar (Esc)` →
  `exitDiagnosticoScreen` en el encabezado (mismo estilo que el "Cerrar" de `/RESUMEN`).
- `demo-reset-screen.tsx`: `onMouseDown={keepFocusOnMouseDown}`; botones `Cancelar (Esc)` →
  `exitDemoResetScreen` y `Reiniciar demo (Enter)` → `void confirmDemoReset()` (deshabilitado mientras
  `demoResetInProgressSignal`); el texto "¿Reiniciar la demo? Enter confirma, Esc cancela." queda.

- [ ] **Step 4: Correr** — `pnpm test && pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5: Commit** — `feat(ui): teclado y mouse en /ANULAR, comprobante, /DIAGNOSTICO y /DEMO_RESET (#97)`.

---

### Task 13: e2e

**Files:**
- Rewrite: `e2e/connection-lifecycle.spec.ts`, `e2e/config-connector.spec.ts`
- Modify: `e2e/minibackend-sync.spec.ts`, `e2e/keyboard-only.spec.ts`, `e2e/helpers.ts`
- Create: `e2e/terminal-identity.spec.ts`, `e2e/mouse.spec.ts`

**Interfaces:**
- Produces: `e2e/helpers.ts::completeWizardRest(page, params: { baseUrl: string; branch?: string; pointOfSale?: string; type?: 'rest' | 'rest-demo' }): Promise<void>` — recorre el wizard con teclado hasta Revisar y aplica.

- [ ] **Step 1: Helper**

```typescript
/** Recorre el wizard de /CONFIG solo con teclado (Etapa 2, #97) y aplica. */
export async function completeWizardRest(
  page: Page,
  params: { baseUrl: string; branch?: string; pointOfSale?: string; type?: 'rest' | 'rest-demo' },
): Promise<void> {
  await page.getByLabel('Sucursal').fill(params.branch ?? 'Casa central');
  await page.getByLabel('Punto de venta').fill(params.pointOfSale ?? 'Caja 1');
  await page.keyboard.press('Enter');
  const label = params.type === 'rest-demo' ? 'REST (minibackend de demo)' : 'REST genérico';
  await page.getByRole('button', { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')}`) }).click();
  await page.getByLabel('URL base del backend').fill(params.baseUrl);
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Conexión OK/)).toBeVisible({ timeout: 25_000 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Aplicar (Enter)' })).toBeVisible();
  await page.keyboard.press('Enter');
}
```

(El label exacto del campo URL sale de `connectors/rest/config.ts`.)

- [ ] **Step 2: `connection-lifecycle.spec.ts`** — casos (con `@playwright/test` a secas y el
backend REST mockeado con `page.route` como ya hace el archivo):
  1. Sin config: abre el wizard en Terminal, sin "Cancelar (Esc)"; Esc no sale.
  2. Prueba fallida: en Probar se ve el error con `Reintentar (Enter)`; `localStorage` no tiene config.
  3. Config `active` sin sucursal (sembrada con `verifiedAt` y sin `branch`): abre en Terminal
     precargado; completar sucursal/punto de venta + Ctrl+Enter + Enter guarda sin request a
     `/sync/pull` (contar requests con `page.route`) y llega a la venta.
  4. Cambiar de origen con una venta local: Datos locales aparece con "Mantener" elegido; Enter →
     Revisar → Enter: la venta sigue en IndexedDB y el catálogo es el nuevo.
  5. Cambiar de origen eligiendo Borrar: confirmación con conteos; Enter borra; IndexedDB sin ventas.
  6. Esc en la confirmación de borrado vuelve a las opciones sin borrar.
- [ ] **Step 3: `config-connector.spec.ts`** — Google Sheets solo con teclado: ↓ hasta "Google Sheets"
  en el paso 2, Enter, instrucciones visibles (texto "termina en /exec"), URL inválida → error en el
  campo al Enter; con la prueba mockeada OK, aplicar y reabrir `/CONFIG`: abre en Revisar con el
  resumen precargado (secreto como `•••`). "Esc cancela sin guardar" se mantiene.
- [ ] **Step 4: `minibackend-sync.spec.ts`** — reemplazar el llenado del formulario viejo por
  `completeWizardRest(page, { baseUrl: 'http://localhost:4000', type: 'rest-demo' })`.
- [ ] **Step 5: `terminal-identity.spec.ts`** (con el `test` de `./fixtures.ts`):

```typescript
test('sin id de dispositivo: borra lo local y abre el wizard con el aviso, precargado', async ({ page }) => {
  await page.goto('/');
  await seedCatalog(page); // helper existente
  await page.evaluate(() => localStorage.removeItem('offline-pos:device-id'));
  // El fixture vuelve a sembrar la config en cada navegación: queda la config
  // activa pero la identidad falta, que es justo el caso.
  await page.reload();
  await expect(page.getByText('Esta terminal no tenía identidad')).toBeVisible();
  await expect(page.getByLabel('Sucursal')).toHaveValue('Casa central');
  expect(await countRows(page, 'products')).toBe(0); // helper de e2e/indexed-db.ts
});
```

  Ojo: el `addInitScript` del fixture reescribe la config **con** `verifiedAt` en cada navegación, pero
  `resolveDeviceIdentity` corre después y la guarda sin `verifiedAt` — verificar que el orden sea ese
  (init script antes del bundle). Si `seedCatalog`/`countRows` tienen otros nombres, usar los reales.
- [ ] **Step 6: `mouse.spec.ts`**:
  1. Wizard solo con clicks (sin config): llenar con `fill` los inputs y avanzar siempre con
     `getByRole('button', …).click()`: `Siguiente (Enter)`, opción `REST genérico`, `Siguiente (Enter)`,
     esperar "Conexión OK", `Siguiente (Enter)`, `Aplicar (Enter)` → llega a la venta.
  2. Venta (fixture activo + `seedCatalog`): tipear `arr`, click en la primera fila del overlay → el
     carrito tiene 1 línea y `document.activeElement` es la barra de comandos.
  3. "/" con carrito vacío: la fila `/COBRAR` tiene `aria-disabled="true"`; click en ella no cambia de
     pantalla.
  4. Click en la tarjeta de Cliente con el overlay abierto lo cierra y la barra conserva el texto y el foco.
- [ ] **Step 7: `keyboard-only.spec.ts`** — el caso `/CONFIG → Esc` sigue (con la terminal activa
  abre en Revisar); sumar uno: `/ANULAR` → click en "Volver a la venta (Esc)" → la barra recupera el foco.
- [ ] **Step 8: Correr** — `pnpm build && pnpm test:e2e` → PASS. Correr los specs nuevos con
  `--repeat-each=3` para descartar carreras.
- [ ] **Step 9: Commit** — `test(e2e): wizard de /CONFIG, identidad perdida y mouse (#97)`.

---

### Task 14: Documentación

**Files:**
- Modify: `docs/connector-api.openapi.yaml`
- Modify: `CLAUDE.md`

- [ ] **Step 1: OpenAPI** — buscar `grep -n "97\|tolerad" docs/connector-api.openapi.yaml` y reemplazar
  cada nota de transición por: "El POS los manda siempre desde la Etapa 2 de #94. Un evento encolado
  antes puede llegar sin ellos: el backend lo guarda con el valor vacío." Versión sin cambios.
- [ ] **Step 2: CLAUDE.md** —
  - "Ciclo de vida de la conexión": reescribir para el wizard (6 pasos, modelo puro, mantener/borrar a
    elección con Mantener preseleccionada, `incomplete`, camino solo-terminal, lotes conservados con
    el mismo origen, salvaguarda de tabla vacía solo con el mismo origen, spinner y progreso de la
    prueba).
  - "Patrón outbox": el párrafo de identidad — `resolveDeviceIdentity` al arrancar, `getDeviceId` no
    crea, sucursal/punto de venta obligatorios.
  - Sección nueva "Teclado y mouse" (después de "UX keyboard-first"): `keepFocusOnMouseDown`, la
    convención (botón = misma función del controller, atajo en la etiqueta, hover decorativo), y qué
    pantallas lo aplican; click en overlays = Enter, click fuera = Esc.
  - "Menú de /": comandos habilitados, preselección solo si la fila 0 está habilitada.
  - `/CONFIG` en la lista de comandos: wizard.
  - Ciclo 10: la frase "Las demás pantallas siguen sin mouse a propósito" → "reemplazado por el patrón
    de la Etapa 2 de #94 (ver 'Teclado y mouse')".
  - "Utilidades de consola": `pos.deviceId()` devuelve `null` antes del arranque.
  - "Estado del proyecto": entrada de la Etapa 2 de #94.
- [ ] **Step 3: Commit** — `docs: identidad de terminal, wizard de /CONFIG y teclado + mouse (#97)`.

---

### Task 15: Verificación final y prueba en navegador

- [ ] **Step 1:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`
  — todo verde; pegar el resumen de cada uno en el reporte.
- [ ] **Step 2:** Levantar `pnpm dev` (app + minibackend) y recorrer en el navegador del panel, con
  capturas:
  1. Instalación desde cero (sin `localStorage`): wizard en Terminal → … → "Conexión OK" → Aplicar.
  2. `/CONFIG` → abre en Revisar → cambiar solo la sucursal → Aplicar sin prueba; hacer una venta y ver
     en el panel `/_demo` la sucursal nueva.
  3. Con una venta sin enviar (minibackend detenido o "Demorar lotes"), cambiar la URL a otro origen →
     Datos locales con Mantener → la venta sigue; con Borrar → confirmación con conteos.
  4. Borrar `offline-pos:device-id` en DevTools y recargar → aviso y datos vacíos, config precargada.
  5. Venta con mouse: click en filas de `/`, `@`, artículos; `/COBRAR` atenuado con carrito vacío;
     click fuera cierra el overlay; la barra nunca pierde el foco.
  6. `/ANULAR`, comprobante, `/DIAGNOSTICO`, `/DEMO_RESET` con mouse.
  7. Ventana a 600px: el wizard entra y se lee.
- [ ] **Step 3:** Reporte final para el usuario con pasos de prueba manual (app + minibackend) y lo
  que no se pudo verificar en navegador, si hay algo.
