# Una sola pestaña del POS — plan de implementación

> **Para quien ejecuta:** se ejecuta **inline** con `superpowers:executing-plans`, tarea por tarea,
> frenando después de cada una con un resumen corto hasta el visto bueno del usuario (ver "Cómo
> trabajamos" en `AGENTS.md`). Los pasos usan checkboxes (`- [ ]`). Si algo del plan no coincide con
> el código, se avisa **antes** de desviarse.

**Objetivo:** que una sola pestaña por almacenamiento (origen + carpeta) opere el POS; las demás
muestran un aviso con "Usar esta pestaña" (#175, etapa P2 del epic #182).

**Arquitectura:** `navigator.locks` decide qué pestaña manda (cerrojo `<namespace>:tab`, retenido
mientras viva la página); `BroadcastChannel` con el mismo nombre lleva el pedido de traspaso. La
coordinación (`ui/tab-leadership.ts`) recibe todo inyectado y se testea con fakes; `main.tsx` la usa
antes de `bootstrap()`. La original suelta sin cortar a medias: pausa el sync, toma el cerrojo de
sync, espera las escrituras de IndexedDB (contador en un middleware de Dexie) y se recarga.

**Stack:** Preact, `@preact/signals`, Dexie 4 (middleware `dbcore`), Zod 4, Vitest + Testing Library,
Playwright (Chromium).

**Spec:** `docs/superpowers/specs/2026-10-02-una-sola-pestana-design.md`

## Restricciones globales

- Todo en español: textos de UI, comentarios, commits.
- TypeScript estricto: sin `any`, sin `!` (`no-non-null-assertion` en error); `unknown` solo en la
  firma de algo externo validado con Zod en la línea siguiente.
- `try/catch` solo en adaptadores (acá: `sessionStorage`).
- Nombre del cerrojo y del canal: `storageKey('tab')` (`offline-pos:tab` en `/`,
  `offline-pos@/0.1.0/:tab` en `/0.1.0/`).
- Tiempos: `STEAL_AFTER_MS = 5000` (la segunda), `RELEASE_WAIT_MS = 4000` (la original).
- Textos exactos: título "El POS está abierto en otra pestaña"; texto "Este navegador ya lo está
  usando en otra pestaña o ventana. Volvé a esa, o usalo acá: la otra se recarga y queda sin usar.";
  aviso de desplazada "Se empezó a usar el POS en otra pestaña."; botón "Usar esta pestaña (Enter)" /
  "Tomando el control…"; `document.title` de la segunda "POS en otra pestaña".
- Marca de desplazada: `sessionStorage`, clave `storageKey('tab-displaced')`.
- Sin `navigator.locks`: la app arranca como hoy.
- Commits chicos, cada uno con `pnpm lint && pnpm typecheck && pnpm test` en verde (más `pnpm build`
  y `pnpm test:e2e` donde se indica), terminados en
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Archivos

| Archivo | Qué hace |
|---|---|
| `src/storage/transaction-tracker.ts` (nuevo) | Middleware de Dexie que cuenta las escrituras abiertas; `waitForIdleWriteTransactions` |
| `src/storage/db.ts` | Instala el contador en `db` |
| `src/storage/storage-namespace.ts` | `tabLockNameFor`, `TAB_LOCK_NAME` |
| `src/storage/tab-displaced.ts` (nuevo) | Marca de desplazada en `sessionStorage` |
| `src/ui/tab-leadership.ts` (nuevo) | Coordinación: `claimTab`, traspaso, `steal`, escucha del canal; puertos `TabLocks`/`TabChannel` |
| `src/test/fake-tab-locks.ts` (nuevo) | `navigator.locks` y `BroadcastChannel` falsos para los tests |
| `src/ui/tab-release.ts` (nuevo) | `prepareTabRelease`: pausa el sync, toma su cerrojo, espera las escrituras |
| `src/ui/tab-browser.ts` (nuevo) | Adaptadores reales (`navigator.locks`, `BroadcastChannel`, `location.reload`) |
| `src/ui/screens/secondary-tab-screen.tsx` (nuevo) | La pantalla de la segunda pestaña |
| `src/main.tsx` | Pide el cerrojo antes de todo; muestra la segunda o arranca la app |
| `e2e/single-tab.spec.ts` (nuevo) | Dos páginas del mismo contexto, y una tercera en otra carpeta |
| Docs | `AGENTS.md`, `src/ui/AGENTS.md`, `src/storage/AGENTS.md`, `e2e/AGENTS.md`, `docs/historia.md` |

---

### Tarea 0: entorno en verde

- [ ] **Paso 1:** `pnpm install`
- [ ] **Paso 2:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → todo en verde. Si algo
  falla en `main` sin tocar nada, frenar y avisar (no arreglarlo de paso).

Sin commit.

---

### Tarea 1: contador de escrituras de IndexedDB

**Archivos:**
- Crear: `src/storage/transaction-tracker.ts`, `src/storage/transaction-tracker.test.ts`
- Modificar: `src/storage/db.ts` (al final)

**Interfaces:**
- Produce: `trackWriteTransactions(database: Dexie): void`, `openWriteTransactionCount(): number`,
  `waitForIdleWriteTransactions(timeoutMs: number): Promise<boolean>` (`true` si quedó en 0, `false`
  si venció).

- [ ] **Paso 1: test que falla** — `src/storage/transaction-tracker.test.ts`:

```ts
import 'fake-indexeddb/auto';
import Dexie, { type EntityTable } from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import {
  openWriteTransactionCount,
  trackWriteTransactions,
  waitForIdleWriteTransactions,
} from './transaction-tracker.ts';

class TrackedDb extends Dexie {
  items!: EntityTable<{ id: string }, 'id'>;

  constructor() {
    super('transaction-tracker-test');
    this.version(1).stores({ items: 'id' });
  }
}

const trackedDb = new TrackedDb();
trackWriteTransactions(trackedDb);

/** Una escritura que queda abierta hasta llamar a `finish` (`Dexie.waitFor` la mantiene viva). */
function openWrite(id: string): { finish: () => void; done: Promise<void> } {
  let finish: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const done = trackedDb.transaction('rw', trackedDb.items, async () => {
    await trackedDb.items.put({ id });
    await Dexie.waitFor(gate);
  });
  return { finish, done };
}

describe('contador de escrituras (#175)', () => {
  it('cuenta una escritura abierta y vuelve a 0 al terminar', async () => {
    const write = openWrite('a');
    await vi.waitFor(() => expect(openWriteTransactionCount()).toBe(1));
    write.finish();
    await write.done;
    await vi.waitFor(() => expect(openWriteTransactionCount()).toBe(0));
  });

  it('una lectura no cuenta', async () => {
    let inside = -1;
    await trackedDb.transaction('r', trackedDb.items, async () => {
      inside = openWriteTransactionCount();
      await trackedDb.items.get('a');
    });
    expect(inside).toBe(0);
  });

  it('una escritura abortada también descuenta', async () => {
    await expect(
      trackedDb.transaction('rw', trackedDb.items, async () => {
        await trackedDb.items.put({ id: 'b' });
        throw new Error('falla a propósito');
      }),
    ).rejects.toThrow('falla a propósito');
    await vi.waitFor(() => expect(openWriteTransactionCount()).toBe(0));
  });

  it('waitForIdleWriteTransactions resuelve true cuando termina la escritura en curso', async () => {
    const write = openWrite('c');
    await vi.waitFor(() => expect(openWriteTransactionCount()).toBe(1));
    const idle = waitForIdleWriteTransactions(2000);
    write.finish();
    await write.done;
    await expect(idle).resolves.toBe(true);
  });

  it('waitForIdleWriteTransactions vence con false si la escritura no termina', async () => {
    const write = openWrite('d');
    await vi.waitFor(() => expect(openWriteTransactionCount()).toBe(1));
    await expect(waitForIdleWriteTransactions(30)).resolves.toBe(false);
    write.finish();
    await write.done;
  });

  it('sin escrituras abiertas resuelve true enseguida', async () => {
    await vi.waitFor(() => expect(openWriteTransactionCount()).toBe(0));
    await expect(waitForIdleWriteTransactions(0)).resolves.toBe(true);
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/storage/transaction-tracker.test.ts` → falla (el módulo no
  existe).
- [ ] **Paso 3: implementación** — `src/storage/transaction-tracker.ts`:

```ts
import type Dexie from 'dexie';

/**
 * Escrituras de IndexedDB abiertas en esta pestaña (#175): antes de soltar el control, la pestaña que
 * manda espera a que lleguen a 0, así un cobro o un movimiento de caja que se está guardando nunca se
 * corta a medias. Un middleware de Dexie (capa `dbcore`) cuenta todas las transacciones `readwrite`,
 * así una tabla o un repositorio futuro queda cubierto sin acordarse. Las lecturas no cuentan: cortar
 * una no deja nada a medias.
 */
let openWrites = 0;
const idleWaiters = new Set<() => void>();

function finishWrite(): void {
  openWrites -= 1;
  if (openWrites === 0) {
    for (const notify of idleWaiters) {
      notify();
    }
    idleWaiters.clear();
  }
}

export function trackWriteTransactions(database: Dexie): void {
  database.use({
    stack: 'dbcore',
    name: 'write-transaction-tracker',
    create: (down) => ({
      ...down,
      transaction: (stores, mode, options) => {
        const transaction = down.transaction(stores, mode, options);
        // Sobre IndexedDB, la transacción de `dbcore` es la `IDBTransaction` misma.
        if (mode === 'readwrite' && transaction instanceof IDBTransaction) {
          openWrites += 1;
          let finished = false;
          const finish = (): void => {
            if (!finished) {
              finished = true;
              finishWrite();
            }
          };
          transaction.addEventListener('complete', finish);
          transaction.addEventListener('abort', finish);
        }
        return transaction;
      },
    }),
  });
}

export function openWriteTransactionCount(): number {
  return openWrites;
}

/** `true` cuando no queda ninguna escritura abierta; `false` si pasaron `timeoutMs` antes. */
export function waitForIdleWriteTransactions(timeoutMs: number): Promise<boolean> {
  if (openWrites === 0) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const onIdle = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      idleWaiters.delete(onIdle);
      resolve(false);
    }, timeoutMs);
    idleWaiters.add(onIdle);
  });
}
```

  Si el tipo de `down.transaction` de la versión instalada de Dexie no acepta `(stores, mode,
  options)`, ajustar a su firma (`node_modules/dexie/dist/dexie.d.ts`, `DBCore.transaction`) y
  contarlo en el resumen de la tarea.

- [ ] **Paso 4:** en `src/storage/db.ts`, después de `export const db = new PosDatabase();`:

```ts
// #175: la pestaña que suelta el control espera a que no quede ninguna escritura abierta.
trackWriteTransactions(db);
```

  con `import { trackWriteTransactions } from './transaction-tracker.ts';` arriba.

- [ ] **Paso 5:** `pnpm vitest run src/storage` → pasa todo (los tests de Dexie existentes siguen
  andando con el middleware puesto).
- [ ] **Paso 6:** `pnpm lint && pnpm typecheck && pnpm test` en verde, y commit:

```bash
git add src/storage/transaction-tracker.ts src/storage/transaction-tracker.test.ts src/storage/db.ts
git commit -m "feat(pestaña): contador de escrituras abiertas de IndexedDB (#175)"
```

---

### Tarea 2: nombre del cerrojo por carpeta y marca de desplazada

**Archivos:**
- Modificar: `src/storage/storage-namespace.ts`, `src/storage/storage-namespace.test.ts`
- Crear: `src/storage/tab-displaced.ts`, `src/storage/tab-displaced.test.ts`

**Interfaces:**
- Produce: `tabLockNameFor(pathname: string): string`, `TAB_LOCK_NAME: string`,
  `markTabDisplaced(): void`, `consumeTabDisplaced(): boolean`.

- [ ] **Paso 1: tests que fallan** — agregar a `storage-namespace.test.ts` (sumando `tabLockNameFor` y
  `TAB_LOCK_NAME` al import):

```ts
describe('tabLockNameFor (#175)', () => {
  it('en la raíz y en cada carpeta es un nombre propio: dos carpetas nunca se bloquean', () => {
    expect(tabLockNameFor('/')).toBe('offline-pos:tab');
    expect(tabLockNameFor('/0.1.0/')).toBe('offline-pos@/0.1.0/:tab');
    expect(tabLockNameFor('/0.1.0/index.html')).toBe('offline-pos@/0.1.0/:tab');
    expect(tabLockNameFor('/0.2.0/')).not.toBe(tabLockNameFor('/0.1.0/'));
  });

  it('TAB_LOCK_NAME es la clave "tab" de esta carpeta', () => {
    expect(TAB_LOCK_NAME).toBe(storageKey('tab'));
  });
});
```

  y `src/storage/tab-displaced.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { storageKey } from './storage-namespace.ts';
import { consumeTabDisplaced, markTabDisplaced } from './tab-displaced.ts';

beforeEach(() => {
  sessionStorage.clear();
});

describe('marca de pestaña desplazada (#175)', () => {
  it('sin marca, no fue desplazada', () => {
    expect(consumeTabDisplaced()).toBe(false);
  });

  it('la marca se lee una sola vez', () => {
    markTabDisplaced();
    expect(sessionStorage.getItem(storageKey('tab-displaced'))).not.toBeNull();
    expect(consumeTabDisplaced()).toBe(true);
    expect(consumeTabDisplaced()).toBe(false);
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/storage/storage-namespace.test.ts src/storage/tab-displaced.test.ts`
  → falla.
- [ ] **Paso 3: implementación** — al final de `storage-namespace.ts` (después de `storageKey`, que usa
  `LOCAL_STORAGE_PREFIX`):

```ts
/**
 * Cerrojo de `navigator.locks` y canal de `BroadcastChannel` de la pestaña que manda (#175). Los dos
 * ya están separados por origen; con la carpeta, dos versiones publicadas del mismo origen tampoco se
 * bloquean entre sí.
 */
export function tabLockNameFor(pathname: string): string {
  return `${localStoragePrefixFor(pathname)}tab`;
}

export const TAB_LOCK_NAME = storageKey('tab');
```

  y `src/storage/tab-displaced.ts`:

```ts
import { storageKey } from './storage-namespace.ts';

/**
 * Marca de "a esta pestaña la desplazaron" (#175): la pone la pestaña que suelta el control justo
 * antes de recargarse, y la lee la pantalla de la segunda pestaña al cargar. `sessionStorage` es de
 * esta pestaña y sobrevive a su propio reload. Best-effort: si el navegador no deja usarlo, solo se
 * pierde el aviso.
 */
const DISPLACED_KEY = storageKey('tab-displaced');

export function markTabDisplaced(): void {
  try {
    sessionStorage.setItem(DISPLACED_KEY, '1');
  } catch {
    // Sin `sessionStorage` solo se pierde el aviso.
  }
}

/** Lee y borra la marca: el aviso se muestra una sola vez. */
export function consumeTabDisplaced(): boolean {
  try {
    const displaced = sessionStorage.getItem(DISPLACED_KEY) !== null;
    sessionStorage.removeItem(DISPLACED_KEY);
    return displaced;
  } catch {
    return false;
  }
}
```

- [ ] **Paso 4:** los tests del paso 2 pasan; `pnpm vitest run src/storage/storage-keys.test.ts` sigue
  en verde.
- [ ] **Paso 5:** `pnpm lint && pnpm typecheck && pnpm test`, commit:

```bash
git add src/storage/storage-namespace.ts src/storage/storage-namespace.test.ts src/storage/tab-displaced.ts src/storage/tab-displaced.test.ts
git commit -m "feat(pestaña): nombre del cerrojo por carpeta y marca de desplazada (#175)"
```

---

### Tarea 3: coordinación entre pestañas

**Archivos:**
- Crear: `src/ui/tab-leadership.ts`, `src/ui/tab-leadership.test.ts`, `src/test/fake-tab-locks.ts`

**Interfaces:**
- Produce (en `ui/tab-leadership.ts`):

```ts
export type TabLockOptions = { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal };
export type TabLocks = {
  request(
    name: string,
    options: TabLockOptions,
    callback: (lock: object | null) => Promise<void>,
  ): Promise<void>;
};
export type TabMessage = { type: 'release-request' };
export type TabChannel = {
  post(message: TabMessage): void;
  onMessage(handler: (message: TabMessage) => void): void;
};
export type TabLeadershipDeps = {
  locks: TabLocks | undefined;
  channel: TabChannel;
  prepareRelease: (timeoutMs: number) => Promise<void>;
  markDisplaced: () => void;
  reload: () => void;
  stealAfterMs: number;
  releaseWaitMs: number;
};
export type TabClaim = { kind: 'leader' } | { kind: 'secondary'; takeOver: () => Promise<void> };
export const STEAL_AFTER_MS = 5000;
export const RELEASE_WAIT_MS = 4000;
export function parseTabMessage(data: unknown): TabMessage | undefined;
export function claimTab(name: string, deps: TabLeadershipDeps): Promise<TabClaim>;
```

- Produce (en `src/test/fake-tab-locks.ts`): `class FakeTabLocks implements TabLocks` (un solo
  cerrojo, con `closeHolder()` para simular que se cierra la pestaña que lo tiene) y
  `createFakeTabBus(): { open: () => TabChannel; close: (channel: TabChannel) => void }`.

- [ ] **Paso 1: los fakes** — `src/test/fake-tab-locks.ts`:

```ts
import type { TabChannel, TabLockOptions, TabLocks, TabMessage } from '../ui/tab-leadership.ts';

type Entry = {
  callback: (lock: object | null) => Promise<void>;
  resolve: () => void;
  reject: (reason: DOMException) => void;
};

/**
 * `navigator.locks` de mentira para un solo cerrojo (#175), con la semántica que usa el POS:
 * `ifAvailable` (recibe `null` si está tomado), espera en cola, `signal` (abortar un pedido en espera)
 * y `steal` (a quien lo tenía se le rechaza su `request` con `AbortError`).
 */
export class FakeTabLocks implements TabLocks {
  private holder: Entry | undefined;
  private readonly queue: Entry[] = [];

  request(
    _name: string,
    options: TabLockOptions,
    callback: (lock: object | null) => Promise<void>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const entry: Entry = { callback, resolve, reject };
      if (options.steal === true) {
        const previous = this.holder;
        this.holder = undefined;
        previous?.reject(new DOMException('Se lo quitaron', 'AbortError'));
        this.grant(entry);
        return;
      }
      if (this.holder === undefined) {
        this.grant(entry);
        return;
      }
      if (options.ifAvailable === true) {
        void callback(null).then(() => {
          resolve();
        });
        return;
      }
      this.queue.push(entry);
      options.signal?.addEventListener('abort', () => {
        const index = this.queue.indexOf(entry);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new DOMException('Abortado', 'AbortError'));
        }
      });
    });
  }

  /** Simula que se cierra la pestaña que tiene el cerrojo: lo suelta y lo recibe la próxima en espera. */
  closeHolder(): void {
    this.holder = undefined;
    this.grantNext();
  }

  private grant(entry: Entry): void {
    this.holder = entry;
    void entry.callback({}).then(() => {
      if (this.holder === entry) {
        this.holder = undefined;
        entry.resolve();
        this.grantNext();
      }
    });
  }

  private grantNext(): void {
    const next = this.queue.shift();
    if (next !== undefined) {
      this.grant(next);
    }
  }
}

/**
 * `BroadcastChannel` de mentira: un mensaje llega a todos los canales abiertos menos al que lo manda.
 * `close` simula que se cerró la pestaña de ese canal: deja de recibir.
 */
export function createFakeTabBus(): {
  open: () => TabChannel;
  close: (channel: TabChannel) => void;
} {
  const handlers = new Map<TabChannel, ((message: TabMessage) => void)[]>();
  return {
    close: (channel) => {
      handlers.delete(channel);
    },
    open: () => {
      const own: ((message: TabMessage) => void)[] = [];
      const channel: TabChannel = {
        post: (message) => {
          for (const [other, otherHandlers] of handlers) {
            if (other !== channel) {
              for (const handler of otherHandlers) {
                queueMicrotask(() => {
                  handler(message);
                });
              }
            }
          }
        },
        onMessage: (handler) => {
          own.push(handler);
        },
      };
      handlers.set(channel, own);
      return channel;
    },
  };
}
```

- [ ] **Paso 2: test que falla** — `src/ui/tab-leadership.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createFakeTabBus, FakeTabLocks } from '../test/fake-tab-locks.ts';
import { claimTab, parseTabMessage, type TabLeadershipDeps } from './tab-leadership.ts';

const NAME = 'offline-pos:tab';

type Tab = {
  deps: TabLeadershipDeps;
  calls: { prepared: number[]; displaced: number; reloads: number };
};

/**
 * Una pestaña de mentira. `reload` simula lo que hace el navegador al recargar: suelta el cerrojo
 * (salvo `hung`, una pestaña colgada que nunca llega a recargarse).
 */
function openTab(
  locks: FakeTabLocks,
  bus: ReturnType<typeof createFakeTabBus>,
  options: { prepareRelease?: (ms: number) => Promise<void>; hung?: boolean } = {},
): Tab {
  const calls = { prepared: [] as number[], displaced: 0, reloads: 0 };
  const deps: TabLeadershipDeps = {
    locks,
    channel: bus.open(),
    prepareRelease: async (ms) => {
      calls.prepared.push(ms);
      await options.prepareRelease?.(ms);
    },
    markDisplaced: () => {
      calls.displaced += 1;
    },
    reload: () => {
      calls.reloads += 1;
      if (options.hung !== true) {
        locks.closeHolder();
      }
    },
    stealAfterMs: 80,
    releaseWaitMs: 40,
  };
  return { deps, calls };
}

const never = (): Promise<void> => new Promise(() => undefined);

describe('claimTab (#175)', () => {
  it('sin otra pestaña, esta manda', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    expect((await claimTab(NAME, openTab(locks, bus).deps)).kind).toBe('leader');
  });

  it('con otra que manda, queda como segunda', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    await claimTab(NAME, openTab(locks, bus).deps);
    expect((await claimTab(NAME, openTab(locks, bus).deps)).kind).toBe('secondary');
  });

  it('sin navigator.locks manda siempre (la app arranca como antes)', async () => {
    const bus = createFakeTabBus();
    const tab = openTab(new FakeTabLocks(), bus);
    expect((await claimTab(NAME, { ...tab.deps, locks: undefined })).kind).toBe('leader');
    expect((await claimTab(NAME, { ...tab.deps, locks: undefined })).kind).toBe('leader');
  });
});

describe('Usar esta pestaña (#175)', () => {
  it('la original prepara, se marca desplazada y se recarga; la segunda pasa a mandar', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    const original = openTab(locks, bus);
    await claimTab(NAME, original.deps);
    const second = await claimTab(NAME, openTab(locks, bus).deps);
    if (second.kind !== 'secondary') throw new Error('se esperaba una segunda pestaña');

    await second.takeOver();

    expect(original.calls).toEqual({ prepared: [40], displaced: 1, reloads: 1 });
    expect((await claimTab(NAME, openTab(locks, bus).deps)).kind).toBe('secondary');
  });

  it('un pedido repetido mientras suelta no la prepara dos veces', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    const original = openTab(locks, bus, { prepareRelease: never });
    await claimTab(NAME, original.deps);
    const other = bus.open();
    other.post({ type: 'release-request' });
    other.post({ type: 'release-request' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(original.calls.prepared).toEqual([40]);
  });

  it('si la original no contesta, la segunda le quita el cerrojo y la original se recarga', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    const original = openTab(locks, bus, { prepareRelease: never, hung: true });
    await claimTab(NAME, original.deps);
    const second = await claimTab(NAME, openTab(locks, bus).deps);
    if (second.kind !== 'secondary') throw new Error('se esperaba una segunda pestaña');

    await second.takeOver();

    expect(original.calls.displaced).toBe(1);
    expect(original.calls.reloads).toBe(1);
    expect((await claimTab(NAME, openTab(locks, bus).deps)).kind).toBe('secondary');
  });

  it('con la original cerrada, toma el control enseguida (sin esperar el tope)', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    const original = openTab(locks, bus);
    await claimTab(NAME, original.deps);
    const second = await claimTab(NAME, openTab(locks, bus).deps);
    if (second.kind !== 'secondary') throw new Error('se esperaba una segunda pestaña');
    // Cerrar la pestaña: deja de escuchar el canal y suelta el cerrojo.
    bus.close(original.deps.channel);
    locks.closeHolder();

    const started = Date.now();
    await second.takeOver();

    expect(Date.now() - started).toBeLessThan(80);
    expect(original.calls.displaced).toBe(0);
  });

  it('la que tomó el control también suelta cuando se lo piden', async () => {
    const locks = new FakeTabLocks();
    const bus = createFakeTabBus();
    await claimTab(NAME, openTab(locks, bus).deps);
    const middle = openTab(locks, bus);
    const middleClaim = await claimTab(NAME, middle.deps);
    if (middleClaim.kind !== 'secondary') throw new Error('se esperaba una segunda pestaña');
    await middleClaim.takeOver();
    const last = await claimTab(NAME, openTab(locks, bus).deps);
    if (last.kind !== 'secondary') throw new Error('se esperaba una segunda pestaña');

    await last.takeOver();

    expect(middle.calls).toEqual({ prepared: [40], displaced: 1, reloads: 1 });
  });
});

describe('parseTabMessage', () => {
  it('acepta el pedido de traspaso e ignora cualquier otra cosa', () => {
    expect(parseTabMessage({ type: 'release-request' })).toEqual({ type: 'release-request' });
    expect(parseTabMessage({ type: 'otra-cosa' })).toBeUndefined();
    expect(parseTabMessage('release-request')).toBeUndefined();
  });
});
```

- [ ] **Paso 3:** `pnpm vitest run src/ui/tab-leadership.test.ts` → falla (el módulo no existe).
- [ ] **Paso 4: implementación** — `src/ui/tab-leadership.ts`:

```ts
import { z } from 'zod';

/**
 * Una sola pestaña del POS por almacenamiento (#175, spec
 * `docs/superpowers/specs/2026-10-02-una-sola-pestana-design.md`). `navigator.locks` decide qué
 * pestaña manda: la que tiene el cerrojo lo retiene mientras viva la página. `BroadcastChannel` solo
 * lleva el pedido de traspaso ("Usar esta pestaña"). Todo llega inyectado (`TabLeadershipDeps`): los
 * adaptadores reales están en `ui/tab-browser.ts`, los de mentira en `test/fake-tab-locks.ts`.
 */

export type TabLockOptions = { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal };

/** Lo que el POS usa de `navigator.locks`. */
export type TabLocks = {
  request(
    name: string,
    options: TabLockOptions,
    callback: (lock: object | null) => Promise<void>,
  ): Promise<void>;
};

const tabMessageSchema = z.object({ type: z.literal('release-request') });
export type TabMessage = z.infer<typeof tabMessageSchema>;

/** Valida lo que llega por el canal (otra pestaña, quizás de otra versión del POS). */
export function parseTabMessage(data: unknown): TabMessage | undefined {
  const parsed = tabMessageSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

export type TabChannel = {
  post(message: TabMessage): void;
  onMessage(handler: (message: TabMessage) => void): void;
};

export type TabLeadershipDeps = {
  /** `undefined` sin `navigator.locks` (contexto no seguro): la pestaña manda siempre. */
  locks: TabLocks | undefined;
  channel: TabChannel;
  /** Deja de operar sin cortar nada a medias, con tope (`ui/tab-release.ts`). */
  prepareRelease: (timeoutMs: number) => Promise<void>;
  markDisplaced: () => void;
  reload: () => void;
  stealAfterMs: number;
  releaseWaitMs: number;
};

export type TabClaim = { kind: 'leader' } | { kind: 'secondary'; takeOver: () => Promise<void> };

/** La segunda espera esto a que la original suelte; después le quita el cerrojo. */
export const STEAL_AFTER_MS = 5000;
/** Tope de la original para terminar lo que no se puede cortar (menor que `STEAL_AFTER_MS`). */
export const RELEASE_WAIT_MS = 4000;

type Hold = { granted: Promise<boolean>; isHeld: () => boolean };

/**
 * Pide el cerrojo y, si lo recibe, lo retiene mientras viva la página. `granted` resuelve `true` al
 * recibirlo, o `false` si `ifAvailable` lo encontró tomado o si el pedido se abortó antes. Si después
 * de tenerlo se lo quitan (`steal` desde otra pestaña), se marca desplazada y se recarga.
 */
function requestHold(
  locks: TabLocks,
  name: string,
  options: TabLockOptions,
  deps: TabLeadershipDeps,
): Hold {
  let held = false;
  const granted = new Promise<boolean>((resolve) => {
    locks
      .request(name, options, (lock) => {
        if (lock === null) {
          resolve(false);
          return Promise.resolve();
        }
        held = true;
        resolve(true);
        return new Promise<void>(() => undefined);
      })
      .catch(() => {
        if (held) {
          deps.markDisplaced();
          deps.reload();
        } else {
          resolve(false);
        }
      });
  });
  return { granted, isHeld: () => held };
}

/** La pestaña que manda atiende un pedido de traspaso (uno solo: los repetidos se ignoran). */
function listenForReleaseRequests(deps: TabLeadershipDeps): void {
  let releasing = false;
  deps.channel.onMessage((message) => {
    if (message.type !== 'release-request' || releasing) {
      return;
    }
    releasing = true;
    void deps
      .prepareRelease(deps.releaseWaitMs)
      .catch(() => undefined)
      .then(() => {
        deps.markDisplaced();
        deps.reload();
      });
  });
}

/** "Usar esta pestaña": pide el traspaso, espera el cerrojo y, si la original no contesta, se lo quita. */
async function takeOver(locks: TabLocks, name: string, deps: TabLeadershipDeps): Promise<void> {
  const waiting = new AbortController();
  const hold = requestHold(locks, name, { signal: waiting.signal }, deps);
  deps.channel.post({ type: 'release-request' });
  await Promise.race([
    hold.granted,
    new Promise<void>((resolve) => setTimeout(resolve, deps.stealAfterMs)),
  ]);
  // `isHeld` se lee sincrónicamente: si el cerrojo todavía no llegó, abortar saca el pedido de la
  // cola antes de que pueda llegar, y nunca se le quita el cerrojo a esta misma pestaña.
  if (!hold.isHeld()) {
    waiting.abort();
    await requestHold(locks, name, { steal: true }, deps).granted;
  }
  listenForReleaseRequests(deps);
}

/** Se llama una vez al cargar, antes de `bootstrap()`. */
export async function claimTab(name: string, deps: TabLeadershipDeps): Promise<TabClaim> {
  const { locks } = deps;
  if (locks === undefined) {
    return { kind: 'leader' };
  }
  if (await requestHold(locks, name, { ifAvailable: true }, deps).granted) {
    listenForReleaseRequests(deps);
    return { kind: 'leader' };
  }
  return { kind: 'secondary', takeOver: () => takeOver(locks, name, deps) };
}
```

- [ ] **Paso 5:** `pnpm vitest run src/ui/tab-leadership.test.ts` → pasa. Correrlo 5 veces seguidas
  (`for i in 1 2 3 4 5; do pnpm vitest run src/ui/tab-leadership.test.ts || break; done`): los tiempos
  son reales y no puede haber flake.
- [ ] **Paso 6:** `pnpm lint && pnpm typecheck && pnpm test`, commit:

```bash
git add src/ui/tab-leadership.ts src/ui/tab-leadership.test.ts src/test/fake-tab-locks.ts
git commit -m "feat(pestaña): coordinación entre pestañas con navigator.locks (#175)"
```

---

### Tarea 4: soltar sin cortar a medias

**Archivos:**
- Crear: `src/ui/tab-release.ts`, `src/ui/tab-release.test.ts`

**Interfaces:**
- Consume: `acquireSyncLockWaiting(waitMs)` y `tryAcquireSyncLock()` de `sync/engine.ts`;
  `setSyncPaused` de `ui/state/sync.ts`; `waitForIdleWriteTransactions` (Tarea 1).
- Produce: `prepareTabRelease(timeoutMs: number): Promise<void>` (cumple
  `TabLeadershipDeps['prepareRelease']`).

- [ ] **Paso 1: test que falla** — `src/ui/tab-release.test.ts`. El cerrojo de sync es estado del
  módulo y `prepareTabRelease` lo deja tomado a propósito, así que cada test importa módulos frescos
  (`vi.resetModules()`):

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

async function load() {
  const engine = await import('../sync/engine.ts');
  const syncState = await import('./state/sync.ts');
  const { db } = await import('../storage/db.ts');
  const { prepareTabRelease } = await import('./tab-release.ts');
  return { engine, syncState, db, prepareTabRelease };
}

describe('prepareTabRelease (#175)', () => {
  it('pausa el sync, espera a que termine el ciclo en curso y se queda con el cerrojo', async () => {
    const { engine, syncState, prepareTabRelease } = await load();
    const releaseCycle = engine.tryAcquireSyncLock();
    if (releaseCycle === undefined) throw new Error('el cerrojo debería estar libre');
    let done = false;
    const release = prepareTabRelease(2000).then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(syncState.syncPausedSignal.value).toBe(true);
    expect(done).toBe(false);

    releaseCycle();
    await release;
    expect(engine.isSyncLockHeld()).toBe(true);
  });

  it('espera a que termine una escritura en IndexedDB', async () => {
    const { db, prepareTabRelease } = await load();
    const { default: Dexie } = await import('dexie');
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let written = false;
    const write = db.transaction('rw', db.draftCart, async () => {
      await db.draftCart.put({ id: 'current', cart: { lines: [] } });
      await Dexie.waitFor(gate);
      written = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    let done = false;
    const release = prepareTabRelease(2000).then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(done).toBe(false);

    finish();
    await write;
    await release;
    expect(written).toBe(true);
  });

  it('nunca espera más que el tope', async () => {
    const { engine, prepareTabRelease } = await load();
    engine.tryAcquireSyncLock();
    const started = Date.now();
    await prepareTabRelease(80);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
```

  Si `{ id: 'current', cart: { lines: [] } }` no cumple el tipo `Cart` de `domain/cart.ts`, usar el
  carrito vacío que exporte ese módulo (o el que use `draft-cart-repository.test.ts`).

- [ ] **Paso 2:** `pnpm vitest run src/ui/tab-release.test.ts` → falla.
- [ ] **Paso 3: implementación** — `src/ui/tab-release.ts`:

```ts
import { waitForIdleWriteTransactions } from '../storage/transaction-tracker.ts';
import { acquireSyncLockWaiting } from '../sync/engine.ts';
import { setSyncPaused } from './state/sync.ts';

/**
 * Lo que hace la pestaña que manda antes de soltar el control (#175), sin cortar nada a medias y
 * con un tope: pausa el sync (no arranca ningún ciclo nuevo), espera el cerrojo de sync (así termina
 * el push o pull en vuelo, aplicar una conexión o `pos.reset()`) y se queda con él, y espera a que no
 * quede ninguna escritura de IndexedDB abierta (un cobro que se está guardando). El cerrojo de sync
 * nunca se suelta: después de esto la pestaña se recarga.
 */
export async function prepareTabRelease(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  setSyncPaused(true);
  await acquireSyncLockWaiting(timeoutMs);
  await waitForIdleWriteTransactions(Math.max(0, deadline - Date.now()));
}
```

- [ ] **Paso 4:** el test pasa.
- [ ] **Paso 5:** `pnpm lint && pnpm typecheck && pnpm test`, commit:

```bash
git add src/ui/tab-release.ts src/ui/tab-release.test.ts
git commit -m "feat(pestaña): la original suelta sin cortar un sync ni una escritura (#175)"
```

---

### Tarea 5: la pantalla de la segunda pestaña

**Archivos:**
- Crear: `src/ui/screens/secondary-tab-screen.tsx`, `src/ui/screens/secondary-tab-screen.test.tsx`

**Interfaces:**
- Produce: `SecondaryTabScreen(props: { displaced: boolean; onTakeOver: () => Promise<void> })`.

- [ ] **Paso 1: test que falla** — `src/ui/screens/secondary-tab-screen.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { SecondaryTabScreen } from './secondary-tab-screen.tsx';

const BUTTON = 'Usar esta pestaña (Enter)';

describe('SecondaryTabScreen (#175)', () => {
  it('avisa que el POS está en otra pestaña, con el botón enfocado', () => {
    render(<SecondaryTabScreen displaced={false} onTakeOver={() => Promise.resolve()} />);
    expect(
      screen.getByRole('heading', { name: 'El POS está abierto en otra pestaña' }),
    ).not.toBeNull();
    expect(
      screen.getByText(
        'Este navegador ya lo está usando en otra pestaña o ventana. Volvé a esa, o usalo acá: la otra se recarga y queda sin usar.',
      ),
    ).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: BUTTON }));
    expect(screen.queryByText('Se empezó a usar el POS en otra pestaña.')).toBeNull();
  });

  it('si la desplazaron, lo dice', () => {
    render(<SecondaryTabScreen displaced onTakeOver={() => Promise.resolve()} />);
    expect(screen.getByText('Se empezó a usar el POS en otra pestaña.')).not.toBeNull();
  });

  it('el botón pide el traspaso una sola vez y muestra que está tomando el control', () => {
    const onTakeOver = vi.fn(() => new Promise<void>(() => undefined));
    render(<SecondaryTabScreen displaced={false} onTakeOver={onTakeOver} />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    const taking = screen.getByRole('button', { name: 'Tomando el control…' });
    expect(taking.hasAttribute('disabled')).toBe(true);
    fireEvent.click(taking);
    expect(onTakeOver).toHaveBeenCalledTimes(1);
  });

  it('un mousedown sobre el texto no le saca el foco al botón', () => {
    render(<SecondaryTabScreen displaced={false} onTakeOver={() => Promise.resolve()} />);
    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    screen.getByRole('heading').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/ui/screens/secondary-tab-screen.test.tsx` → falla.
- [ ] **Paso 3: implementación** — `src/ui/screens/secondary-tab-screen.tsx`:

```tsx
import { useState } from 'preact/hooks';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';

type Props = {
  /** A esta pestaña la desplazaron desde otra (marca de `storage/tab-displaced.ts`). */
  displaced: boolean;
  onTakeOver: () => Promise<void>;
};

/**
 * Lo que ve una pestaña que no manda (#175): nada de la app está inicializado (ni signals, ni
 * Dexie, ni sync), así que la pantalla no depende de nada de eso. No hay link a la otra pestaña:
 * Chromium no deja traerla al frente (verificado en la spec). El botón tiene el foco, así que Enter
 * lo activa de forma nativa, igual que un click.
 */
export function SecondaryTabScreen({ displaced, onTakeOver }: Props) {
  const buttonRef = useFocusOnMount<HTMLButtonElement>();
  const [taking, setTaking] = useState(false);

  const takeOver = (): void => {
    if (taking) {
      return;
    }
    setTaking(true);
    void onTakeOver();
  };

  return (
    <div
      onMouseDown={keepFocusOnMouseDown}
      style={{
        height: '100svh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        textAlign: 'center',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {displaced && (
        <p role="status" style={{ margin: 0, fontWeight: 'bold' }}>
          Se empezó a usar el POS en otra pestaña.
        </p>
      )}
      <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>
        El POS está abierto en otra pestaña
      </h1>
      <p style={{ margin: 0, color: 'var(--color-text-muted)', maxWidth: '480px' }}>
        Este navegador ya lo está usando en otra pestaña o ventana. Volvé a esa, o usalo acá: la otra
        se recarga y queda sin usar.
      </p>
      <button
        ref={buttonRef}
        type="button"
        class="btn btn-primary"
        onClick={takeOver}
        disabled={taking}
      >
        {taking ? 'Tomando el control…' : 'Usar esta pestaña (Enter)'}
      </button>
    </div>
  );
}
```

  Si el texto del párrafo queda partido en dos nodos de texto por el salto de línea de JSX y
  `getByText` no lo encuentra, juntarlo en una sola línea (con `{'…'}` si supera el ancho del formatter).

- [ ] **Paso 4:** el test pasa.
- [ ] **Paso 5:** `pnpm lint && pnpm typecheck && pnpm test`, commit:

```bash
git add src/ui/screens/secondary-tab-screen.tsx src/ui/screens/secondary-tab-screen.test.tsx
git commit -m "feat(pestaña): pantalla de la segunda pestaña (#175)"
```

---

### Tarea 6: conectarlo al arranque

**Archivos:**
- Crear: `src/ui/tab-browser.ts`
- Modificar: `src/main.tsx`

**Interfaces:**
- Consume: todo lo anterior.
- Produce: `browserTabLeadershipDeps(): TabLeadershipDeps`.

No hay unit test: son adaptadores y cableado (como `main.tsx` hoy). Lo cubre el e2e de la Tarea 7.

- [ ] **Paso 1:** `src/ui/tab-browser.ts`:

```ts
import { TAB_LOCK_NAME } from '../storage/storage-namespace.ts';
import { markTabDisplaced } from '../storage/tab-displaced.ts';
import {
  parseTabMessage,
  RELEASE_WAIT_MS,
  STEAL_AFTER_MS,
  type TabChannel,
  type TabLeadershipDeps,
  type TabLocks,
} from './tab-leadership.ts';
import { prepareTabRelease } from './tab-release.ts';

/** `navigator.locks` existe solo en un contexto seguro (`https:` o `localhost`). */
function browserLocks(): TabLocks | undefined {
  if (!('locks' in navigator)) {
    return undefined;
  }
  return {
    request: (name, options, callback) =>
      navigator.locks.request(name, options, callback).then(() => undefined),
  };
}

function browserChannel(): TabChannel {
  const broadcast = new BroadcastChannel(TAB_LOCK_NAME);
  return {
    post: (message) => {
      broadcast.postMessage(message);
    },
    onMessage: (handler) => {
      broadcast.addEventListener('message', (event: MessageEvent<unknown>) => {
        const message = parseTabMessage(event.data);
        if (message !== undefined) {
          handler(message);
        }
      });
    },
  };
}

/** Los adaptadores reales de `ui/tab-leadership.ts` (#175). */
export function browserTabLeadershipDeps(): TabLeadershipDeps {
  return {
    locks: browserLocks(),
    channel: browserChannel(),
    prepareRelease: prepareTabRelease,
    markDisplaced: markTabDisplaced,
    reload: () => {
      window.location.reload();
    },
    stealAfterMs: STEAL_AFTER_MS,
    releaseWaitMs: RELEASE_WAIT_MS,
  };
}
```

  Si el `typecheck` no acepta `'locks' in navigator` (por ejemplo, porque lo da siempre por cierto y
  `no-unnecessary-condition` se queja) o la firma de `navigator.locks.request` de la lib DOM instalada,
  ajustar el adaptador sin cambiar el puerto `TabLocks`, y contarlo en el resumen.

- [ ] **Paso 2:** reemplazar el bloque final de `src/main.tsx` (desde `startViewportTracking();` hasta
  el final) por:

```tsx
startViewportTracking();

const APP_TITLE = document.title;
const SECONDARY_TITLE = 'POS en otra pestaña';

/** Lo de siempre: la consola `pos.*` antes de `bootstrap()` (sirve aunque el arranque falle) y el render. */
function startApp(container: HTMLElement): void {
  installPosConsole();
  bootstrap()
    .then(() => {
      // "Preparando…" de `index.html` (#128), o la pantalla de la segunda pestaña (#175): se ve
      // mientras `bootstrap` espera.
      render(null, container);
      container.replaceChildren();
      render(
        <ErrorBoundary>
          <App />
        </ErrorBoundary>,
        container,
      );
    })
    .catch((error: unknown) => {
      renderFatalError(error);
    });
}

/**
 * Una sola pestaña por almacenamiento (#175): antes de todo, el cerrojo de la pestaña que manda. Sin
 * él no arranca nada (ni identidad, ni onboarding, ni sync): la URL queda intacta y un `?demo=…` o un
 * `#connect=…` se procesa cuando esta pestaña toma el control.
 */
async function start(container: HTMLElement): Promise<void> {
  // Se lee siempre: una marca vieja no tiene que aparecer en un arranque posterior.
  const displaced = consumeTabDisplaced();
  const claim = await claimTab(TAB_LOCK_NAME, browserTabLeadershipDeps());
  if (claim.kind === 'leader') {
    startApp(container);
    return;
  }
  document.title = SECONDARY_TITLE;
  render(
    <SecondaryTabScreen
      displaced={displaced}
      onTakeOver={async () => {
        await claim.takeOver();
        document.title = APP_TITLE;
        startApp(container);
      }}
    />,
    container,
  );
}

const container = document.getElementById('app');
if (!container) {
  renderFatalError(new Error('#app element not found'));
} else {
  start(container).catch((error: unknown) => {
    renderFatalError(error);
  });
}
```

  y sacar `installPosConsole();` de la línea suelta donde estaba (ahora vive en `startApp`). Imports
  nuevos: `TAB_LOCK_NAME` (`./storage/storage-namespace.ts`), `consumeTabDisplaced`
  (`./storage/tab-displaced.ts`), `claimTab` (`./ui/tab-leadership.ts`),
  `browserTabLeadershipDeps` (`./ui/tab-browser.ts`), `SecondaryTabScreen`
  (`./ui/screens/secondary-tab-screen.tsx`).

- [ ] **Paso 3:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde.
- [ ] **Paso 4:** la suite e2e existente sigue en verde con el arranque nuevo: `pnpm test:e2e`. Si
  algún spec falla, frenar y avisar antes de tocarlo.
- [ ] **Paso 5:** commit:

```bash
git add src/ui/tab-browser.ts src/main.tsx
git commit -m "feat(pestaña): el arranque pide el cerrojo y muestra la segunda pestaña (#175)"
```

---

### Tarea 7: e2e con dos pestañas y otra carpeta

**Archivos:**
- Crear: `e2e/single-tab.spec.ts`

- [ ] **Paso 1: verificar el truco de la otra carpeta antes de escribir el spec**: un test mínimo con
  `context.route` (el del paso 2, test 4) solo con `goto('/otra-carpeta/')` y la barra o el wizard
  visibles. Si la app no arranca así (assets que no resuelven, `vite preview` que responde distinto),
  frenar y avisar con lo que se vio, antes de cambiar de enfoque.
- [ ] **Paso 2:** `e2e/single-tab.spec.ts`:

```ts
import { expect, test } from './fixtures.ts';
import { seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

/**
 * Una sola pestaña del POS por almacenamiento (#175): páginas del mismo contexto de Playwright
 * comparten `localStorage`, IndexedDB, `navigator.locks` y `BroadcastChannel`, como dos pestañas de
 * un navegador. Solo la primera página siembra la conexión (`fixtures.ts`): las demás comparten su
 * almacenamiento.
 */
const SECONDARY_HEADING = 'El POS está abierto en otra pestaña';
const TAKE_OVER = 'Usar esta pestaña (Enter)';

test('una segunda pestaña muestra el aviso y no opera', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();

  const second = await page.context().newPage();
  await second.goto('/');

  await expect(second.getByRole('heading', { name: SECONDARY_HEADING })).toBeVisible();
  await expect(second.getByLabel('Barra de comandos')).toHaveCount(0);
  await expect(second.getByRole('button', { name: TAKE_OVER })).toBeFocused();
  await expect(second).toHaveTitle('POS en otra pestaña');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
});

test('"Usar esta pestaña" se lleva la venta en curso y deja la original como segunda', async ({
  page,
}) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();
  await seedCatalog(page);
  await commandBar.fill('arroz');
  await commandBar.press('Enter');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await expect
    .poll(
      async () =>
        (await getAllFromStore<{ cart: { lines: unknown[] } }>(page, 'draftCart'))[0]?.cart.lines
          .length,
    )
    .toBe(1);

  const second = await page.context().newPage();
  await second.goto('/');
  await second.getByRole('button', { name: TAKE_OVER }).press('Enter');

  await expect(second.getByLabel('Barra de comandos')).toBeVisible();
  await expect(second.getByText('Arroz 1kg')).toBeVisible();
  await expect(page.getByRole('heading', { name: SECONDARY_HEADING })).toBeVisible();
  await expect(page.getByText('Se empezó a usar el POS en otra pestaña.')).toBeVisible();
  await expect(page.getByLabel('Barra de comandos')).toHaveCount(0);
});

test('con la original cerrada, "Usar esta pestaña" toma el control enseguida', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  const second = await page.context().newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: SECONDARY_HEADING })).toBeVisible();

  await page.close();
  await second.getByRole('button', { name: TAKE_OVER }).click();

  // Menos que los 5 s después de los cuales le quitaría el cerrojo a una original colgada.
  await expect(second.getByLabel('Barra de comandos')).toBeVisible({ timeout: 3000 });
});

test('otra carpeta del mismo origen tiene su propia pestaña que manda', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();

  // El build real servido en otra carpeta del mismo origen: la app usa rutas relativas, así que
  // `/otra-carpeta/assets/…` es el mismo asset de `/assets/…`.
  const context = page.context();
  await context.route('**/otra-carpeta/**', async (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace('/otra-carpeta/', '/');
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
  });
  const other = await context.newPage();
  await other.goto('/otra-carpeta/');

  // Sin config en su almacenamiento: `/CONFIG` requerido, no el aviso de otra pestaña.
  await expect(other.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();
  await expect(other.getByRole('heading', { name: SECONDARY_HEADING })).toHaveCount(0);
  const databases = await other.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name),
  );
  expect(databases).toContain('offline-pos@/otra-carpeta/');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
});
```

- [ ] **Paso 3:** `pnpm build && pnpm test:e2e e2e/single-tab.spec.ts` → pasa. Después
  `pnpm test:e2e e2e/single-tab.spec.ts --repeat-each 5` (no puede haber flake).
- [ ] **Paso 4:** `pnpm lint && pnpm typecheck` (los specs se lintean), commit:

```bash
git add e2e/single-tab.spec.ts
git commit -m "test(pestaña): e2e con dos pestañas y otra carpeta del mismo origen (#175)"
```

---

### Tarea 8: docs y chequeo final

**Archivos:**
- Modificar: `AGENTS.md`, `src/ui/AGENTS.md`, `src/storage/AGENTS.md`, `e2e/AGENTS.md`,
  `docs/historia.md`

- [ ] **Paso 1: `AGENTS.md` (raíz)**:
  - Índice "Cómo están organizadas": fila nueva "Una sola pestaña: cerrojo, traspaso, segunda
    pestaña" → `src/ui/AGENTS.md`; el nombre por carpeta y el contador, en `src/storage/AGENTS.md`.
  - Sección nueva corta "Una sola pestaña (#175)", después de "Publicación": una sola pestaña por
    almacenamiento (origen + carpeta) opera; la segunda muestra un aviso y "Usar esta pestaña", nunca
    toma el control sola; la original suelta sin cortar a medias; no hay forma de traer la original al
    frente en Chromium (verificado, spec); sin `navigator.locks` arranca como antes.
  - "Estado del proyecto": fila `#175` con "Una sola pestaña por almacenamiento" y "PR pendiente" (se
    completa con el número al abrir el PR); en "Siguiente", sacar #175 de lo que falta antes del hito 1.
- [ ] **Paso 2: `src/ui/AGENTS.md`**: sección "Una sola pestaña (#175)" con `ui/tab-leadership.ts`
  (puertos, `claimTab`, traspaso, `steal`, tiempos), `ui/tab-release.ts`, `ui/tab-browser.ts`,
  `SecondaryTabScreen` (textos, foco, título) y el arranque de `main.tsx`; en "Utilidades de consola
  `pos.*`", que la consola se instala solo en la pestaña que manda (sigue antes de `bootstrap()`).
- [ ] **Paso 3: `src/storage/AGENTS.md`**: en "Almacenamiento por carpeta", `TAB_LOCK_NAME`
  (`storageKey('tab')`) y la marca `tab-displaced` en `sessionStorage`; sección corta "Contador de
  escrituras" (`transaction-tracker.ts`: middleware `dbcore`, solo `readwrite`, para qué sirve).
- [ ] **Paso 4: `e2e/AGENTS.md`**: párrafo sobre `single-tab.spec.ts` (páginas del mismo contexto =
  pestañas del mismo navegador; solo la primera siembra; la otra carpeta con `context.route` sobre el
  build de 4173 porque el sitio de `site:preview` tiene una sola carpeta de versión).
- [ ] **Paso 5: `docs/historia.md`**: párrafo "**Una sola pestaña (#175)**" después del de la
  impresión (#174): qué se hizo, la verificación en Chromium (la tabla resumida y por qué hubo que
  usar CDP crudo: la emulación de foco de Playwright hacía `visible` a las dos pestañas) y las
  decisiones (botón en vez de toma automática por el F5; soltar sin cortar a medias).
- [ ] **Paso 6:** chequeo final completo:
  `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` en verde.
- [ ] **Paso 7:** commit:

```bash
git add AGENTS.md src/ui/AGENTS.md src/storage/AGENTS.md e2e/AGENTS.md docs/historia.md
git commit -m "docs: una sola pestaña del POS (#175)"
```

- [ ] **Paso 8:** informe final con la prueba manual paso a paso (AGENTS.md). **No abrir el PR**
  hasta que el usuario haga la prueba y lo apruebe.
