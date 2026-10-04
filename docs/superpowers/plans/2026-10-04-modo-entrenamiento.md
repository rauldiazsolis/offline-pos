# Modo entrenamiento — plan de implementación

> **Para agentes:** se ejecuta **inline** con `superpowers:executing-plans`, tarea por tarea con
> checkpoints (convención del repo, `AGENTS.md` → "Cómo trabajamos"). Los pasos usan `- [ ]`.

**Objetivo:** un modo entrenamiento (#177) que usa el catálogo, el stock y los clientes reales, no
envía nada al backend y al salir descarta todo lo hecho.

**Arquitectura:** una base de Dexie aparte (`<namespace>#entrenamiento`) que se abre al cargar si la
marca `storageKey('training')` está prendida. Entrar copia lo maestro a esa base, prende la marca y
recarga; salir apaga la marca y recarga, y el arranque borra la base huérfana. El estado operativo
del motor (cursores, lotes, limpieza, contadores) usa `operationalKey`, que en entrenamiento agrega
`training:`. El push se corta en `pushPendingLot`, el único que llama a `connector.pushBatch`.

**Stack:** Preact + signals, Dexie, Zod, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-modo-entrenamiento-design.md`

## Restricciones globales

- Todo en español: textos, commits, comentarios.
- Sin `any`; `unknown` solo en el borde y validado con Zod en la línea siguiente.
- Chequeo local por tarea: `pnpm lint && pnpm typecheck && pnpm test` (y `pnpm build` antes de cada
  commit que toque `src/`); `pnpm test:e2e` en la Tarea 9.
- Commits chicos con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` al final.
- Nombre de la base: `${STORAGE_NAMESPACE}#entrenamiento` (en `/`: `offline-pos#entrenamiento`).
- Marca: `storageKey('training')` = `{ "startedAt": "<ISO>" }`. Claves operativas:
  `sync-cursor:products`, `sync-cursor:customers`, `sync:last-full`, `sync:push-lot`,
  `sync:push-lot-awaiting`, `cleanup:last-run`, `ticket-counter`, `receipt-counter`.
- Textos fijos: franja "MODO ENTRENAMIENTO · nada se envía al backend · todo se borra al salir";
  botón "Salir del entrenamiento (/ENTRENAMIENTO)"; título "ENTRENAMIENTO · <título>"; marca del
  ticket "ENTRENAMIENTO"; aviso al volver "Saliste del entrenamiento."; motivo de los comandos
  cortados "en entrenamiento; salí con /ENTRENAMIENTO".
- El contrato no cambia (4.6.0), ni el demo-backend, ni el puente de Sheets.

---

### Tarea 1: la marca, el nombre de la base y las claves operativas

**Archivos:**
- Crear: `src/storage/training-mode.ts`, `src/storage/training-mode.test.ts`
- Modificar: `src/storage/db.ts`, `src/sync/cursor.ts`, `src/sync/push-lot.ts`,
  `src/sync/cleanup-schedule.ts`, `src/sync/ticket-counter.ts`, `src/sync/receipt-counter.ts`,
  `src/storage/storage-keys.test.ts`

**Interfaces que produce:**
- `type TrainingMark = { startedAt: string }`
- `readTrainingMark(storage?: Pick<Storage, 'getItem'>): TrainingMark | null`
- `isTrainingMode(): boolean`, `trainingMark(): TrainingMark | null`
- `setTrainingModeForTests(mark: TrainingMark | null): void`
- `TRAINING_MARK_KEY = storageKey('training')`, `TRAINING_KEY_PREFIX = storageKey('training:')`
- `trainingDatabaseName(namespace: string): string`
- `operationalKeyFor(name: string, training: boolean): string`, `operationalKey(name: string): string`
- `export class PosDatabase` (recibe `name`), `db`

- [ ] **Paso 1: test que falla** (`src/storage/training-mode.test.ts`)

```ts
import { afterEach, describe, expect, it } from 'vitest';
import {
  TRAINING_MARK_KEY,
  operationalKeyFor,
  readTrainingMark,
  trainingDatabaseName,
} from './training-mode.ts';

function storageWith(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: () => value };
}

afterEach(() => {
  localStorage.clear();
});

describe('modo entrenamiento: la marca (#177)', () => {
  it('sin marca, o rota, está apagado', () => {
    expect(readTrainingMark(storageWith(null))).toBeNull();
    expect(readTrainingMark(storageWith('no es json'))).toBeNull();
    expect(readTrainingMark(storageWith('{"startedAt":3}'))).toBeNull();
  });

  it('con la marca válida, devuelve cuándo empezó', () => {
    const mark = readTrainingMark(storageWith('{"startedAt":"2026-10-04T12:00:00.000Z"}'));
    expect(mark).toEqual({ startedAt: '2026-10-04T12:00:00.000Z' });
  });

  it('la clave es la de la carpeta', () => {
    expect(TRAINING_MARK_KEY).toBe('offline-pos:training');
  });
});

describe('modo entrenamiento: nombres', () => {
  it('la base de entrenamiento es aparte, también en una carpeta', () => {
    expect(trainingDatabaseName('offline-pos')).toBe('offline-pos#entrenamiento');
    expect(trainingDatabaseName('offline-pos@/v4/')).toBe('offline-pos@/v4/#entrenamiento');
  });

  it('las claves operativas se separan solo en entrenamiento', () => {
    expect(operationalKeyFor('ticket-counter', false)).toBe('offline-pos:ticket-counter');
    expect(operationalKeyFor('ticket-counter', true)).toBe('offline-pos:training:ticket-counter');
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/storage/training-mode.test.ts` → FALLA (no existe el módulo).

- [ ] **Paso 3: implementación** (`src/storage/training-mode.ts`)

```ts
import { z } from 'zod';
import { storageKey } from './storage-namespace.ts';

/**
 * Modo entrenamiento (#177): con la marca prendida la app abre una base de Dexie aparte y el motor
 * nunca empuja. Se lee **una vez al cargar**, como `STORAGE_NAMESPACE`: entrar y salir recargan.
 */
export type TrainingMark = { startedAt: string };

export const TRAINING_MARK_KEY = storageKey('training');
/** Prefijo de las claves operativas del entrenamiento: se borran todas al salir. */
export const TRAINING_KEY_PREFIX = storageKey('training:');

const trainingMarkSchema = z.object({ startedAt: z.iso.datetime() });

export function readTrainingMark(
  storage: Pick<Storage, 'getItem'> = localStorage,
): TrainingMark | null {
  try {
    const raw = storage.getItem(TRAINING_MARK_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = trainingMarkSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

let current: TrainingMark | null = readTrainingMark();

export function trainingMark(): TrainingMark | null {
  return current;
}

export function isTrainingMode(): boolean {
  return current !== null;
}

export function setTrainingModeForTests(mark: TrainingMark | null): void {
  current = mark;
}

export function trainingDatabaseName(namespace: string): string {
  return `${namespace}#entrenamiento`;
}

/** Estado operativo del motor que no se puede mezclar con el real (cursores, lotes, contadores). */
export function operationalKeyFor(name: string, training: boolean): string {
  return training ? storageKey(`training:${name}`) : storageKey(name);
}

export function operationalKey(name: string): string {
  return operationalKeyFor(name, isTrainingMode());
}
```

Si `z.iso.datetime()` no existe en la versión de Zod del repo, usar `z.string().datetime()`
(revisar cómo valida fechas otro schema, por ejemplo `sync/wipe-key.ts`).

- [ ] **Paso 4: `db.ts`.** Exportar la clase con el nombre como parámetro y elegirlo con la marca:

```ts
import { isTrainingMode, trainingDatabaseName } from './training-mode.ts';
// …
export class PosDatabase extends Dexie {
  // … (las mismas tablas)
  constructor(name: string) {
    super(name);
    // … (las mismas versiones, sin cambios)
  }
}

/** #177: con la marca de entrenamiento, la base aparte (se borra al salir). */
export const DATABASE_NAME = isTrainingMode()
  ? trainingDatabaseName(STORAGE_NAMESPACE)
  : STORAGE_NAMESPACE;

export const db = new PosDatabase(DATABASE_NAME);
```

Ajustar el comentario de la clase: "El nombre de la base depende de la carpeta (#148) y del modo
entrenamiento (#177)."

- [ ] **Paso 5: claves operativas.** En `cursor.ts`, `push-lot.ts`, `cleanup-schedule.ts`,
  `ticket-counter.ts` y `receipt-counter.ts`, reemplazar `storageKey('<nombre>')` por
  `operationalKey('<nombre>')` (import de `../storage/training-mode.ts`), con un comentario de una
  línea en cada uno: `// #177: en entrenamiento, claves propias (training:…).`

- [ ] **Paso 6: `storage-keys.test.ts`.** El primer test acepta las dos formas:

```ts
for (const name of LEGACY_NAMES) {
  expect(
    all.includes(`storageKey('${name}')`) || all.includes(`operationalKey('${name}')`),
  ).toBe(true);
}
```

Actualizar el comentario: "… pasa por `storageKey` (o `operationalKey`, #177, que en modo real es lo
mismo) …".

- [ ] **Paso 7:** `pnpm lint && pnpm typecheck && pnpm test` → todo PASA.

- [ ] **Paso 8: commit** `feat(storage): marca de entrenamiento, base aparte y claves operativas (#177)`

---

### Tarea 2: la copia al entrar y el borrado de la base

**Archivos:**
- Crear: `src/storage/training-copy.ts`, `src/storage/training-copy.test.ts`

**Consume:** `PosDatabase`, `trainingDatabaseName`, `operationalKeyFor`, `STORAGE_NAMESPACE`.

**Produce:**
- `prepareTrainingDatabase(source: PosDatabase, targetName: string): Promise<void>`: borra la base
  `targetName` si existe y copia lo maestro desde `source`.
- `deleteTrainingDatabase(name?: string): Promise<void>`: `Dexie.delete` de la de entrenamiento.
- `copyOperationalStateToTraining(storage?: Storage): void`: copia cursores y `sync:last-full`.
- `clearTrainingKeys(storage?: Storage): void`: borra la marca y toda clave `TRAINING_KEY_PREFIX*`.
- `TRAINING_COPIED_TABLES` (la lista).

- [ ] **Paso 1: test que falla** (`src/storage/training-copy.test.ts`)

```ts
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { PosDatabase } from './db.ts';
import {
  clearTrainingKeys,
  copyOperationalStateToTraining,
  prepareTrainingDatabase,
} from './training-copy.ts';
import { TRAINING_MARK_KEY } from './training-mode.ts';

const now = '2026-10-04T12:00:00.000Z';
const real = new PosDatabase('test-real');
const TARGET = 'test-real#entrenamiento';

afterEach(async () => {
  real.close();
  await real.delete();
  await Dexie.delete(TARGET);
  localStorage.clear();
});

async function seedReal(): Promise<void> {
  await real.open();
  await real.products.put({
    id: 'p1', sku: 'A', barcodes: [], name: 'Arroz', price: 100, taxRate: 0, category: 'x',
    tracksStock: true,
  });
  await real.stock.put({ productId: 'p1', quantity: 40, updatedAt: now });
  await real.customers.put({ id: 'c1', name: 'Ana', createdAt: now });
  await real.customerBalances.put({ customerId: 'c1', balance: 500, updatedAt: now });
  await real.sales.put({ id: 's1', lines: [], payments: [], total: 0, status: 'closed', createdAt: now });
  await real.outbox.put({
    type: 'sale', id: 's1', status: 'pending', createdAt: now,
    sale: { id: 's1', lines: [], payments: [], total: 0, status: 'closed', createdAt: now },
  });
  await real.cashCounts.put({ id: 'k1', createdAt: now, expected: 0, counted: 0 });
}

describe('copia al entrar al entrenamiento (#177)', () => {
  it('copia catálogo, stock, clientes y saldos; nunca ventas, outbox ni caja', async () => {
    await seedReal();
    await prepareTrainingDatabase(real, TARGET);

    const training = new PosDatabase(TARGET);
    await training.open();
    expect(await training.products.count()).toBe(1);
    expect((await training.stock.get('p1'))?.quantity).toBe(40);
    expect(await training.customers.count()).toBe(1);
    expect((await training.customerBalances.get('c1'))?.balance).toBe(500);
    expect(await training.sales.count()).toBe(0);
    expect(await training.outbox.count()).toBe(0);
    expect(await training.cashCounts.count()).toBe(0);
    training.close();
    // La real no se tocó.
    expect(await real.sales.count()).toBe(1);
  });

  it('borra una base de entrenamiento vieja antes de copiar', async () => {
    await seedReal();
    const old = new PosDatabase(TARGET);
    await old.open();
    await old.sales.put({ id: 'vieja', lines: [], payments: [], total: 0, status: 'closed', createdAt: now });
    old.close();

    await prepareTrainingDatabase(real, TARGET);

    const training = new PosDatabase(TARGET);
    await training.open();
    expect(await training.sales.count()).toBe(0);
    training.close();
  });
});

describe('claves del entrenamiento', () => {
  it('copia los cursores reales a sus claves de entrenamiento', () => {
    localStorage.setItem('offline-pos:sync-cursor:products', 'cp');
    localStorage.setItem('offline-pos:sync:last-full', now);
    copyOperationalStateToTraining();
    expect(localStorage.getItem('offline-pos:training:sync-cursor:products')).toBe('cp');
    expect(localStorage.getItem('offline-pos:training:sync:last-full')).toBe(now);
    expect(localStorage.getItem('offline-pos:training:sync-cursor:customers')).toBeNull();
  });

  it('al salir borra la marca y todas las training:*, sin tocar las reales', () => {
    localStorage.setItem(TRAINING_MARK_KEY, JSON.stringify({ startedAt: now }));
    localStorage.setItem('offline-pos:training:ticket-counter', '{}');
    localStorage.setItem('offline-pos:ticket-counter', 'real');
    clearTrainingKeys();
    expect(localStorage.getItem(TRAINING_MARK_KEY)).toBeNull();
    expect(localStorage.getItem('offline-pos:training:ticket-counter')).toBeNull();
    expect(localStorage.getItem('offline-pos:ticket-counter')).toBe('real');
  });
});
```

Las filas de ejemplo tienen que respetar los tipos reales: si algún campo falta o sobra
(`Product`, `Customer`, `CashCount`), corregirlo mirando `src/domain/*.ts` antes de correr.

- [ ] **Paso 2:** `pnpm vitest run src/storage/training-copy.test.ts` → FALLA.

- [ ] **Paso 3: implementación** (`src/storage/training-copy.ts`)

```ts
import Dexie from 'dexie';
import { PosDatabase } from './db.ts';
import { STORAGE_NAMESPACE } from './storage-namespace.ts';
import {
  TRAINING_KEY_PREFIX,
  TRAINING_MARK_KEY,
  operationalKeyFor,
  trainingDatabaseName,
} from './training-mode.ts';

/**
 * Lo que el entrenamiento (#177) trae de la base real al entrar: lo maestro. Ventas, cobranzas,
 * movimientos, caja, outbox y venta en curso arrancan vacíos (la caja, con saldo base 0).
 */
export const TRAINING_COPIED_TABLES = [
  'products',
  'stock',
  'customers',
  'customerAccounts',
  'customerBalances',
  'cashConcepts',
] as const;

/** Las claves que el primer pull de entrenamiento necesita para ser un delta. */
const COPIED_KEYS = ['sync-cursor:products', 'sync-cursor:customers', 'sync:last-full'];

export async function deleteTrainingDatabase(
  name: string = trainingDatabaseName(STORAGE_NAMESPACE),
): Promise<void> {
  await Dexie.delete(name);
}

/** Borra una base de entrenamiento vieja y copia lo maestro de `source`, en una transacción. */
export async function prepareTrainingDatabase(
  source: PosDatabase,
  targetName: string,
): Promise<void> {
  await deleteTrainingDatabase(targetName);
  const target = new PosDatabase(targetName);
  try {
    const rows = await Promise.all(
      TRAINING_COPIED_TABLES.map((name) => source.table(name).toArray()),
    );
    await target.transaction(
      'rw',
      TRAINING_COPIED_TABLES.map((name) => target.table(name)),
      async () => {
        await Promise.all(
          TRAINING_COPIED_TABLES.map((name, index) => target.table(name).bulkPut(rows[index] ?? [])),
        );
      },
    );
  } finally {
    target.close();
  }
}

export function copyOperationalStateToTraining(storage: Storage = localStorage): void {
  for (const name of COPIED_KEYS) {
    const value = storage.getItem(operationalKeyFor(name, false));
    if (value !== null) {
      storage.setItem(operationalKeyFor(name, true), value);
    }
  }
}

export function clearTrainingKeys(storage: Storage = localStorage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(TRAINING_KEY_PREFIX) === true) {
      keys.push(key);
    }
  }
  for (const key of keys) {
    storage.removeItem(key);
  }
  storage.removeItem(TRAINING_MARK_KEY);
}
```

Nota: `TRAINING_KEY_PREFIX` es `offline-pos:training:` y la marca es `offline-pos:training` (sin
`:`), así que la marca no cae en el prefijo: se borra aparte, a propósito.

- [ ] **Paso 4:** `pnpm vitest run src/storage/training-copy.test.ts` → PASA; después
  `pnpm lint && pnpm typecheck && pnpm test`.

- [ ] **Paso 5: commit** `feat(storage): copia a la base de entrenamiento y borrado de sus claves (#177)`

---

### Tarea 3: nada sale al backend en entrenamiento

**Archivos:**
- Modificar: `src/sync/engine.ts` (`pushPendingLot`, `maybeRunCleanup`),
  `src/ui/keyboard/checkout-controller.ts` (`resolveAccountReference`),
  `src/ui/state/sync.ts` (`setPendingOutboxCount`)
- Tests: `src/sync/engine.test.ts`, `src/ui/keyboard/checkout-controller.test.ts`,
  `src/ui/state/sync.test.ts`

**Consume:** `isTrainingMode`, `setTrainingModeForTests`.

- [ ] **Paso 1: tests que fallan.**

En `engine.test.ts`, un `describe` nuevo (con `afterEach(() => { setTrainingModeForTests(null); })`):

```ts
describe('modo entrenamiento (#177)', () => {
  const pendingSale = {
    type: 'sale' as const, sale, id: 'sale-1', status: 'pending' as const, createdAt: now,
  };

  it('pushPendingLot no manda nada, ni ignorando el backoff, y no arma lote', async () => {
    setTrainingModeForTests({ startedAt: now });
    await db.outbox.add(pendingSale);
    const pushBatch = vi.fn();
    const summary = await pushPendingLot(fakeConnector({ pushBatch }), now, { ignoreBackoff: true });
    expect(summary).toEqual({ attempted: 0, failed: false });
    expect(pushBatch).not.toHaveBeenCalled();
    expect(getCurrentPushLot()).toBeUndefined();
    expect((await db.outbox.get('sale-1'))?.status).toBe('pending');
  });

  it('el pull corre y reaplica lo de entrenamiento sobre el stock del backend', async () => {
    setTrainingModeForTests({ startedAt: now });
    // Mismo armado que "sin lotes: reaplica los pendientes nunca enviados": un movimiento de stock
    // pendiente de -1 sobre un producto con stock 10 en el backend → queda 9.
    // (copiar el setup de ese test, que ya existe más arriba en este archivo)
  });
});
```

El segundo test se arma copiando literal el cuerpo del test existente "sin lotes: reaplica los
pendientes nunca enviados (el pull ya no pisa ventas sin enviar)" con
`setTrainingModeForTests({ startedAt: now })` al principio: prueba que el pull no se cortó.

En `checkout-controller.test.ts`, junto a los tests de cuenta corriente que ya usan un hold aprobado:
con `setTrainingModeForTests({ startedAt: now })` y `navigator.onLine` en `true`, confirmar un cobro
con Cuenta corriente **no** llama a `requestAccountHoldNow` (el mock existente del módulo
`sync/account-hold.ts`) y cierra la venta si `canChargeOffline` alcanza (cuenta con crédito
sembrada como en el test offline existente). Copiar el armado del test offline existente de ese
archivo y cambiar solo el modo y `onLine`.

En `src/ui/state/sync.test.ts`:

```ts
it('en entrenamiento los pendientes se muestran en 0 (#177)', () => {
  setTrainingModeForTests({ startedAt: '2026-10-04T12:00:00.000Z' });
  setPendingOutboxCount(3);
  expect(pendingOutboxCountSignal.value).toBe(0);
  setTrainingModeForTests(null);
  setPendingOutboxCount(3);
  expect(pendingOutboxCountSignal.value).toBe(3);
});
```

- [ ] **Paso 2:** `pnpm vitest run src/sync/engine.test.ts src/ui/keyboard/checkout-controller.test.ts src/ui/state/sync.test.ts` → FALLAN los nuevos.

- [ ] **Paso 3: implementación.**

`engine.ts::pushPendingLot`, primera línea:

```ts
  // #177: en entrenamiento nada viaja. Es el único que llama a `pushBatch` (ciclo, /SINCRONIZAR y
  // el envío antes de borrar), así que alcanza con cortar acá.
  if (isTrainingMode()) {
    return { attempted: 0, failed: false };
  }
```

`engine.ts::maybeRunCleanup`: `if (syncPausedSignal.value || isTrainingMode()) { return; }` con el
comentario "la base de entrenamiento es efímera (#177)".

`checkout-controller.ts::resolveAccountReference`: `if (navigator.onLine && !isTrainingMode()) {`
y arriba del `if`: `// #177: la reserva es una escritura en el backend; en entrenamiento, siempre offline.`
Actualizar el comentario de la función ("Con red y fuera del entrenamiento, pide un hold…").

`ui/state/sync.ts::setPendingOutboxCount`:

```ts
export function setPendingOutboxCount(count: number): void {
  // #177: en entrenamiento nada se va a enviar.
  pendingOutboxCountSignal.value = isTrainingMode() ? 0 : count;
}
```

- [ ] **Paso 4:** los tests nuevos PASAN; `pnpm lint && pnpm typecheck && pnpm test`.

- [ ] **Paso 5: commit** `feat(sync): en entrenamiento no hay push, ni reserva de crédito, ni limpieza (#177)`

---

### Tarea 4: el ticket dice ENTRENAMIENTO

**Archivos:**
- Modificar: `src/ui/print/resolve-receipt.ts`, `src/ui/print/receipt-document.ts` (comentario)
- Test: `src/ui/print/resolve-receipt.test.ts` (crearlo si no existe; si existe, sumar casos)

- [ ] **Paso 1: test que falla.**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { setTrainingModeForTests } from '../../storage/training-mode.ts';
import { DEFAULT_PRINTER_CONFIG } from '../../storage/printer-config.ts';
import { receiptDocumentFor, sampleDocumentFor } from './resolve-receipt.ts';

const sale = { id: 's1', lines: [], payments: [], total: 0, status: 'closed' as const, createdAt: '2026-10-04T12:00:00.000Z' };

afterEach(() => {
  setTrainingModeForTests(null);
});

describe('marca ENTRENAMIENTO (#177)', () => {
  it('fuera del entrenamiento, nada nuevo', () => {
    expect(receiptDocumentFor({ kind: 'sale', sale, copy: false }, DEFAULT_PRINTER_CONFIG).marks).toEqual([]);
  });

  it('en entrenamiento, en la venta, la copia y la prueba', () => {
    setTrainingModeForTests({ startedAt: '2026-10-04T12:00:00.000Z' });
    expect(receiptDocumentFor({ kind: 'sale', sale, copy: false }, DEFAULT_PRINTER_CONFIG).marks).toEqual(['ENTRENAMIENTO']);
    expect(receiptDocumentFor({ kind: 'sale', sale, copy: true }, DEFAULT_PRINTER_CONFIG).marks).toEqual(['COPIA', 'ENTRENAMIENTO']);
    expect(sampleDocumentFor(DEFAULT_PRINTER_CONFIG).marks).toEqual(['PRUEBA', 'ENTRENAMIENTO']);
  });
});
```

Si `printer-config.ts` no exporta un default con ese nombre, usar el que exporte (o armar
`{ format: 'a6', onCheckout: 'show', header: '', footer: '' }` con el tipo `PrinterConfig`). Sumar un
caso de cobranza con la misma forma.

- [ ] **Paso 2:** `pnpm vitest run src/ui/print/resolve-receipt.test.ts` → FALLA.

- [ ] **Paso 3: implementación** en `resolve-receipt.ts`:

```ts
import { isTrainingMode } from '../../storage/training-mode.ts';

/** #177: todo comprobante hecho en entrenamiento lo dice, también la copia y la prueba. */
function withTrainingMark(document: ReceiptDocument): ReceiptDocument {
  return isTrainingMode() ? { ...document, marks: [...document.marks, 'ENTRENAMIENTO'] } : document;
}
```

y envolver los tres `return` (`saleReceiptDocument`, `collectionReceiptDocument`,
`sampleReceiptDocument`) con `withTrainingMark(...)`. En `receipt-document.ts`, el comentario de
`marks` pasa a: `/** "COPIA" al reimprimir, "PRUEBA" en la prueba de impresión, "ENTRENAMIENTO" en entrenamiento (#177). */`

- [ ] **Paso 4:** PASA; `pnpm lint && pnpm typecheck && pnpm test`.

- [ ] **Paso 5: commit** `feat(ui): el comprobante de entrenamiento lleva la marca ENTRENAMIENTO (#177)`

---

### Tarea 5: entrar y salir (modelo, estado y controller)

**Archivos:**
- Crear: `src/ui/keyboard/training-model.ts` (+ `.test.ts`), `src/ui/state/training.ts`,
  `src/ui/keyboard/training-controller.ts` (+ `.test.ts`)
- Modificar: `src/ui/keyboard/app-update-controller.ts` (exportar `saleInProgress`)

**Consume:** Tareas 1 y 2; `summarizeLocalData`, `flushPendingBeforeWipe`, `prepareTabRelease`,
`setSyncPaused`, `runPushThenPull`, `commandBarWarningSignal`, `activeScreenSignal`.

**Produce:**
- `type TrainingDiscard = { lines: string[] }`;
  `describeTrainingDiscard(summary: LocalDataSummary, createdCustomers: number): TrainingDiscard`
- `trainingScreenSignal: Signal<TrainingScreenState | null>` con
  `TrainingScreenState = { mode: 'enter'; phase: 'checking' | 'ready' | 'starting'; pending: number } | { mode: 'exit'; phase: 'ready' | 'leaving'; discard: TrainingDiscard }`
- `toggleTraining(deps?)`, `confirmTraining(deps?)`, `cancelTraining(deps?)`
- `TRAINING_EXITED_KEY = storageKey('training-exited')` (`sessionStorage`),
  `consumeTrainingExited(): boolean`
- `saleInProgress(): boolean` (exportada de `app-update-controller.ts`)

- [ ] **Paso 1: test del modelo que falla** (`training-model.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import { describeTrainingDiscard } from './training-model.ts';

const empty: LocalDataSummary = {
  products: 10, customers: 3, sales: 0, cashMovements: 0, cashCounts: 0,
  customerPayments: 0, pendingOutbox: 0, pendingSales: 0, draftCartLines: 0,
};

describe('lo que se descarta al salir del entrenamiento (#177)', () => {
  it('sin nada hecho', () => {
    expect(describeTrainingDiscard(empty, 0).lines).toEqual(['No hiciste nada en el entrenamiento.']);
  });

  it('cuenta ventas, cobranzas, caja, venta en curso y clientes, en singular y plural', () => {
    const lines = describeTrainingDiscard(
      { ...empty, sales: 1, customerPayments: 2, cashMovements: 1, cashCounts: 1, draftCartLines: 2 },
      1,
    ).lines;
    expect(lines).toEqual([
      '1 venta',
      '2 cobranzas',
      '2 movimientos de caja y arqueos',
      'La venta en curso',
      '1 cliente creado',
    ]);
  });
});
```

- [ ] **Paso 2:** FALLA. **Paso 3:** implementar `training-model.ts`:

```ts
import type { LocalDataSummary } from '../../storage/local-data.ts';

/** Lo que se descarta al salir del entrenamiento (#177), contado sobre su base. Pura. */
export type TrainingDiscard = { lines: string[] };

function count(n: number, singular: string, plural: string): string | undefined {
  if (n === 0) return undefined;
  return `${String(n)} ${n === 1 ? singular : plural}`;
}

export function describeTrainingDiscard(
  summary: LocalDataSummary,
  createdCustomers: number,
): TrainingDiscard {
  const lines = [
    count(summary.sales, 'venta', 'ventas'),
    count(summary.customerPayments, 'cobranza', 'cobranzas'),
    count(
      summary.cashMovements + summary.cashCounts,
      'movimiento de caja o arqueo',
      'movimientos de caja y arqueos',
    ),
    summary.draftCartLines > 0 ? 'La venta en curso' : undefined,
    count(createdCustomers, 'cliente creado', 'clientes creados'),
  ].filter((line): line is string => line !== undefined);
  return { lines: lines.length > 0 ? lines : ['No hiciste nada en el entrenamiento.'] };
}
```

- [ ] **Paso 4: estado** (`src/ui/state/training.ts`):

```ts
import { signal } from '@preact/signals';
import type { TrainingDiscard } from '../keyboard/training-model.ts';

/**
 * La pantalla de entrenamiento (#177): `null` = cerrada. Al entrar: `checking` (cuenta lo pendiente),
 * `ready` y `starting` (envía, copia y recarga). Al salir: `ready` y `leaving` (recarga).
 */
export type TrainingScreenState =
  | { mode: 'enter'; phase: 'checking' | 'ready' | 'starting'; pending: number }
  | { mode: 'exit'; phase: 'ready' | 'leaving'; discard: TrainingDiscard };

export const trainingScreenSignal = signal<TrainingScreenState | null>(null);
```

- [ ] **Paso 5: tests del controller que fallan** (`training-controller.test.ts`), con deps falsas:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setTrainingModeForTests } from '../../storage/training-mode.ts';
import { commandBarWarningSignal } from '../state/command-bar.ts';
import { trainingScreenSignal } from '../state/training.ts';
import {
  cancelTraining,
  confirmTraining,
  toggleTraining,
  type TrainingDeps,
} from './training-controller.ts';

const summary = {
  products: 1, customers: 1, sales: 2, cashMovements: 0, cashCounts: 0,
  customerPayments: 0, pendingOutbox: 3, pendingSales: 2, draftCartLines: 0,
};

function fakeDeps(overrides: Partial<TrainingDeps> = {}): TrainingDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    hasSaleInProgress: () => false,
    summarize: () => Promise.resolve(summary),
    countCreatedCustomers: () => Promise.resolve(0),
    flushReal: () => { calls.push('flush'); return Promise.resolve(); },
    prepareTrainingData: () => { calls.push('copy'); return Promise.resolve(); },
    writeMark: () => { calls.push('mark'); },
    clearTraining: () => { calls.push('clear'); },
    noteExited: () => { calls.push('exited'); },
    pauseSync: () => { calls.push('pause'); },
    resumeSync: () => { calls.push('resume'); },
    prepareRelease: () => { calls.push('release'); return Promise.resolve(() => undefined); },
    reload: () => { calls.push('reload'); },
    now: () => '2026-10-04T12:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  setTrainingModeForTests(null);
  trainingScreenSignal.value = null;
  commandBarWarningSignal.value = null;
});

describe('entrar al entrenamiento (#177)', () => {
  it('con una venta en curso no entra y avisa', async () => {
    await toggleTraining(fakeDeps({ hasSaleInProgress: () => true }));
    expect(trainingScreenSignal.value).toBeNull();
    expect(commandBarWarningSignal.value).toBe('Terminá o descartá la venta para entrar al entrenamiento.');
  });

  it('abre la pantalla con lo pendiente y pausa el sync', async () => {
    const deps = fakeDeps();
    await toggleTraining(deps);
    expect(trainingScreenSignal.value).toEqual({ mode: 'enter', phase: 'ready', pending: 3 });
    expect(deps.calls).toEqual(['pause']);
  });

  it('confirmar: envía lo real, copia, prende la marca, suelta y recarga, en ese orden', async () => {
    const deps = fakeDeps();
    await toggleTraining(deps);
    await confirmTraining(deps);
    expect(deps.calls).toEqual(['pause', 'flush', 'copy', 'mark', 'release', 'reload']);
  });

  it('un envío que falla no impide entrar', async () => {
    const deps = fakeDeps({ flushReal: () => Promise.reject(new Error('sin red')) });
    await toggleTraining(deps);
    await confirmTraining(deps);
    expect(deps.calls).toContain('reload');
  });

  it('cancelar cierra y reanuda el sync', async () => {
    const deps = fakeDeps();
    await toggleTraining(deps);
    cancelTraining(deps);
    expect(trainingScreenSignal.value).toBeNull();
    expect(deps.calls).toEqual(['pause', 'resume']);
  });
});

describe('salir del entrenamiento (#177)', () => {
  it('muestra lo que se descarta y, al confirmar, borra las claves, avisa y recarga', async () => {
    setTrainingModeForTests({ startedAt: '2026-10-04T11:00:00.000Z' });
    const deps = fakeDeps({ hasSaleInProgress: () => true });
    await toggleTraining(deps);
    expect(trainingScreenSignal.value).toEqual({
      mode: 'exit', phase: 'ready', discard: { lines: ['2 ventas'] },
    });
    await confirmTraining(deps);
    expect(deps.calls).toEqual(['pause', 'clear', 'exited', 'release', 'reload']);
  });
});
```

Salir con venta en curso se permite (la de entrenamiento se descarta); por eso el test le pasa
`hasSaleInProgress: () => true`.

- [ ] **Paso 6:** FALLAN. **Paso 7: implementación** (`training-controller.ts`):

```ts
import { db } from '../../storage/db.ts';
import { summarizeLocalData, type LocalDataSummary } from '../../storage/local-data.ts';
import { storageKey, STORAGE_NAMESPACE } from '../../storage/storage-namespace.ts';
import {
  clearTrainingKeys,
  copyOperationalStateToTraining,
  prepareTrainingDatabase,
} from '../../storage/training-copy.ts';
import {
  TRAINING_MARK_KEY,
  isTrainingMode,
  trainingDatabaseName,
} from '../../storage/training-mode.ts';
import { flushPendingBeforeWipe } from '../../sync/apply-connection.ts';
import { loadSyncConfig } from '../../sync/config.ts';
import { runPushThenPull } from '../../sync/engine.ts';
import { commandBarWarningSignal } from '../state/command-bar.ts';
import { setSyncPaused } from '../state/sync.ts';
import { trainingScreenSignal } from '../state/training.ts';
import { RELEASE_WAIT_MS } from '../tab-leadership.ts';
import { prepareTabRelease } from '../tab-release.ts';
import { saleInProgress } from './app-update-controller.ts';
import { describeTrainingDiscard } from './training-model.ts';

/** "Saliste del entrenamiento." después de la recarga: de esta pestaña, sobrevive a su reload. */
export const TRAINING_EXITED_KEY = storageKey('training-exited');

export type TrainingDeps = {
  hasSaleInProgress: () => boolean;
  summarize: () => Promise<LocalDataSummary>;
  countCreatedCustomers: () => Promise<number>;
  flushReal: () => Promise<void>;
  prepareTrainingData: () => Promise<void>;
  writeMark: (startedAt: string) => void;
  clearTraining: () => void;
  noteExited: () => void;
  pauseSync: () => void;
  resumeSync: () => void;
  prepareRelease: (timeoutMs: number) => Promise<() => void>;
  reload: () => void;
  now: () => string;
};

const browserDeps: TrainingDeps = {
  hasSaleInProgress: saleInProgress,
  summarize: summarizeLocalData,
  countCreatedCustomers: () => db.outbox.where('type').equals('customer').count(),
  flushReal: async () => {
    const config = loadSyncConfig();
    if (config.ok && navigator.onLine) {
      await flushPendingBeforeWipe(config.value);
    }
  },
  prepareTrainingData: async () => {
    await prepareTrainingDatabase(db, trainingDatabaseName(STORAGE_NAMESPACE));
    copyOperationalStateToTraining();
  },
  writeMark: (startedAt) => {
    localStorage.setItem(TRAINING_MARK_KEY, JSON.stringify({ startedAt }));
  },
  clearTraining: () => {
    clearTrainingKeys();
  },
  noteExited: () => {
    try {
      sessionStorage.setItem(TRAINING_EXITED_KEY, '1');
    } catch {
      // Sin `sessionStorage` solo se pierde el aviso.
    }
  },
  pauseSync: () => {
    setSyncPaused(true);
  },
  resumeSync: () => {
    setSyncPaused(false);
    void runPushThenPull();
  },
  prepareRelease: prepareTabRelease,
  reload: () => {
    window.location.reload();
  },
  now: () => new Date().toISOString(),
};

/** Lee y borra el aviso de salida (lo muestra `bootstrap` una sola vez). */
export function consumeTrainingExited(): boolean {
  try {
    const exited = sessionStorage.getItem(TRAINING_EXITED_KEY) !== null;
    sessionStorage.removeItem(TRAINING_EXITED_KEY);
    return exited;
  } catch {
    return false;
  }
}

/**
 * `/ENTRENAMIENTO` y el botón de la franja (#177). Apagado, abre "Entrar al entrenamiento" (nunca con
 * una venta en curso); prendido, "Salir del entrenamiento" con lo que se descarta. Pausa el sync
 * mientras la pantalla está abierta, como "Abrir una demo".
 */
export async function toggleTraining(deps: TrainingDeps = browserDeps): Promise<void> {
  if (trainingScreenSignal.value !== null) {
    return;
  }
  if (!isTrainingMode() && deps.hasSaleInProgress()) {
    commandBarWarningSignal.value = 'Terminá o descartá la venta para entrar al entrenamiento.';
    return;
  }
  deps.pauseSync();
  if (isTrainingMode()) {
    const [summary, createdCustomers] = await Promise.all([
      deps.summarize(),
      deps.countCreatedCustomers(),
    ]);
    trainingScreenSignal.value = {
      mode: 'exit',
      phase: 'ready',
      discard: describeTrainingDiscard(summary, createdCustomers),
    };
    return;
  }
  trainingScreenSignal.value = { mode: 'enter', phase: 'checking', pending: 0 };
  const summary = await deps.summarize();
  trainingScreenSignal.value = { mode: 'enter', phase: 'ready', pending: summary.pendingOutbox };
}

/** Esc o "Cancelar" / "Seguir entrenando": no toca nada. */
export function cancelTraining(deps: TrainingDeps = browserDeps): void {
  if (trainingScreenSignal.value?.phase !== 'ready') {
    return;
  }
  trainingScreenSignal.value = null;
  deps.resumeSync();
}

/** Enter: entra (envía lo real, copia, marca) o sale (borra las claves); en los dos, recarga. */
export async function confirmTraining(deps: TrainingDeps = browserDeps): Promise<void> {
  const current = trainingScreenSignal.value;
  if (current?.phase !== 'ready') {
    return;
  }
  if (current.mode === 'enter') {
    trainingScreenSignal.value = { ...current, phase: 'starting' };
    try {
      await deps.flushReal();
    } catch {
      // Sin red o con el backend caído se entra igual: lo real sale al terminar el entrenamiento.
    }
    await deps.prepareTrainingData();
    deps.writeMark(deps.now());
  } else {
    trainingScreenSignal.value = { ...current, phase: 'leaving' };
    deps.clearTraining();
    deps.noteExited();
  }
  await deps.prepareRelease(RELEASE_WAIT_MS);
  deps.reload();
}
```

En `app-update-controller.ts`, `function saleInProgress()` pasa a `export function saleInProgress()`.

- [ ] **Paso 8:** PASAN; `pnpm lint && pnpm typecheck && pnpm test`.

- [ ] **Paso 9: commit** `feat(ui): entrar y salir del entrenamiento (#177)`

---

### Tarea 6: el comando y los comandos cortados

**Archivos:**
- Modificar: `src/ui/keyboard/commands.ts`, `src/ui/keyboard/command-bar-controller.ts`
  (`runCommand`), `src/ui/keyboard/onboarding-controller.ts`
- Tests: `src/ui/keyboard/commands.test.ts` (crearlo si no existe),
  `src/ui/keyboard/onboarding-controller.test.ts`

**Produce:** `TRAINING_BLOCKED_COMMANDS: ReadonlySet<string>`,
`TRAINING_BLOCKED_REASON = 'en entrenamiento; salí con /ENTRENAMIENTO'`.

- [ ] **Paso 1: tests que fallan** (`commands.test.ts`):

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { setTrainingModeForTests } from '../../storage/training-mode.ts';
import { availableCommands, commandAvailability } from './commands.ts';

afterEach(() => {
  setTrainingModeForTests(null);
});

describe('/ENTRENAMIENTO (#177)', () => {
  it('apagado, ofrece practicar; prendido, salir', () => {
    expect(availableCommands().find((c) => c.name === 'ENTRENAMIENTO')?.description).toBe(
      'Practicar sin enviar nada al backend',
    );
    setTrainingModeForTests({ startedAt: '2026-10-04T12:00:00.000Z' });
    expect(availableCommands().find((c) => c.name === 'ENTRENAMIENTO')?.description).toBe(
      'Salir del entrenamiento',
    );
  });

  it('en entrenamiento, /CONFIG queda deshabilitado con el motivo', () => {
    expect(commandAvailability('CONFIG')).toEqual({ enabled: true });
    setTrainingModeForTests({ startedAt: '2026-10-04T12:00:00.000Z' });
    expect(commandAvailability('CONFIG')).toEqual({
      enabled: false,
      reason: 'en entrenamiento; salí con /ENTRENAMIENTO',
    });
  });
});
```

Sumar, si el armado de la demo es fácil (`demoSessionSignal.value = …` como en otros tests), que
`/ALTA` y `/DEMO_NUEVA` también quedan deshabilitados; y con `activeConnectorTypeSignal` en
`'rest-demo'`, `/DEMO_RESET`.

En `onboarding-controller.test.ts`: en entrenamiento y con demo, `startOnboarding(navigate)` y
`startNewDemo(navigate)` no navegan y dejan
`commandBarWarningSignal.value === '/ALTA no está disponible: en entrenamiento; salí con /ENTRENAMIENTO.'`
(y el equivalente con `/DEMO_NUEVA`).

- [ ] **Paso 2:** FALLAN. **Paso 3: implementación.**

`commands.ts`:

```ts
import { isTrainingMode } from '../../storage/training-mode.ts';

/** #177: lo que en entrenamiento tocaría la conexión o borraría datos reales. */
export const TRAINING_BLOCKED_COMMANDS: ReadonlySet<string> = new Set([
  'CONFIG',
  'ALTA',
  'DEMO_NUEVA',
  'DEMO_RESET',
]);
export const TRAINING_BLOCKED_REASON = 'en entrenamiento; salí con /ENTRENAMIENTO';

function trainingCommand(): CommandInfo {
  return {
    name: 'ENTRENAMIENTO',
    description: isTrainingMode() ? 'Salir del entrenamiento' : 'Practicar sin enviar nada al backend',
  };
}

function guardForTraining(command: CommandInfo): CommandInfo {
  if (!isTrainingMode() || !TRAINING_BLOCKED_COMMANDS.has(command.name)) {
    return command;
  }
  return { ...command, availability: () => ({ enabled: false, reason: TRAINING_BLOCKED_REASON }) };
}
```

Sumar `'ENTRENAMIENTO'` a `RESERVED_COMMAND_NAMES`. En `availableCommands`, insertar
`trainingCommand()` después de `...CORE_COMMANDS` y envolver la lista final:
`return [...].map(guardForTraining);`. Actualizar el comentario de `availableCommands` con
"`/ENTRENAMIENTO` (#177) siempre; en entrenamiento, los de `TRAINING_BLOCKED_COMMANDS` deshabilitados".

`command-bar-controller.ts::runCommand`, nuevo `case` antes de `ACTUALIZAR`:

```ts
    case 'ENTRENAMIENTO':
      clearBuffer();
      void toggleTraining();
      return;
```

`onboarding-controller.ts`, al principio de `startOnboarding` y de `startNewDemo`:

```ts
  // #177: el botón del encabezado no pasa por el menú: el motivo va a la barra.
  if (isTrainingMode()) {
    commandBarWarningSignal.value = disabledCommandMessage('ALTA', TRAINING_BLOCKED_REASON);
    return;
  }
```

(`'DEMO_NUEVA'` en `startNewDemo`; imports de `../../storage/training-mode.ts`,
`../state/command-bar.ts` y `./commands.ts`.)

- [ ] **Paso 4:** PASAN; `pnpm lint && pnpm typecheck && pnpm test`.

- [ ] **Paso 5: commit** `feat(ui): /ENTRENAMIENTO y los comandos que se cortan en entrenamiento (#177)`

---

### Tarea 7: el arranque y los bordes

**Archivos:**
- Modificar: `src/ui/bootstrap.ts`, `src/sync/terminal-identity.ts`, `src/ui/state/cash.ts`,
  `src/sync/terminal-data.ts`, `src/sync/diagnostics.ts`, `src/ui/screens/diagnostico-screen.tsx`
- Tests: `src/sync/terminal-identity.test.ts`, `src/ui/state/cash.test.ts`,
  `src/sync/terminal-data.test.ts`

**Produce:** `IdentityResolution` suma `{ status: 'training-exited' }`;
`SyncDiagnostics.trainingSince: string | null`; `LocalDataDump.training: boolean`.

- [ ] **Paso 1: tests que fallan.**

`terminal-identity.test.ts`: con `setTrainingModeForTests({ startedAt })`, sin device-id y con la
marca en `localStorage`, `resolveDeviceIdentity()` devuelve `{ status: 'training-exited' }`, borra la
marca y las `training:*` (`clearTrainingKeys`) y **no** genera id ni borra tablas (una venta sembrada
en `db.sales` sigue ahí).

`cash.test.ts`: con entrenamiento prendido, `cashCountOverdueSignal.value` es `false` aunque
`lastCashCountAtSignal.value` sea `undefined`.

`terminal-data.test.ts`: `exportLocalData(now)` devuelve `training: false` fuera del modo y `true`
con `setTrainingModeForTests`; `resetTerminal()` fuera del entrenamiento llama a `deleteTrainingDatabase` (espiar el módulo
con `vi.spyOn` sobre su export, o inyectarlo si el archivo ya usa deps; si no se puede espiar un
export ESM, sumar un parámetro opcional `deleteTraining = deleteTrainingDatabase`).

- [ ] **Paso 2:** FALLAN. **Paso 3: implementación.**

`terminal-identity.ts::resolveDeviceIdentity`, después de leer `stored` y antes de borrar nada:

```ts
  // #177: sin id con la marca de entrenamiento, primero se sale del entrenamiento: el borrado de
  // siempre tiene que correr sobre la base real, no sobre la de práctica. `bootstrap` recarga.
  if (isTrainingMode()) {
    clearTrainingKeys();
    return { status: 'training-exited' };
  }
```

`bootstrap.ts`, al principio:

```ts
  const identity = await resolveDeviceIdentity();
  if (identity.status === 'training-exited') {
    window.location.reload();
    return;
  }
  identityResetSignal.value = identity.status === 'created' && identity.wipedLocalData;
  // #177: fuera del entrenamiento, una base de práctica que quedó (salida o entrada a medias) se borra.
  if (!isTrainingMode()) {
    await deleteTrainingDatabase();
  }
```

(`bootstrap` devuelve sin renderizar: la recarga corta todo. Verificar que `main.tsx` no renderice
nada raro en el medio; si hace falta, que `bootstrap` devuelva una promesa que nunca resuelve en ese
caso, con un comentario.)

En el onboarding de `bootstrap.ts`, reemplazar la llamada directa por:

```ts
  // #177: en entrenamiento un link de demo o la vuelta del alta no se procesan: borrarían o
  // cambiarían la conexión real desde la base de práctica.
  const onboarding = isTrainingMode()
    ? await skipOnboardingInTraining(window.location.href)
    : await runOnboardingFromUrl(window.location.href, {
        config: loadSyncConfig(),
        hasUserData: hasUserData(await summarizeLocalData()),
      });
```

con, en el mismo archivo:

```ts
/** En entrenamiento: si la URL trae un link, se limpia y se avisa; nunca se aplica. */
async function skipOnboardingInTraining(href: string): Promise<{ kind: 'none' }> {
  if (stripOnboardingParams(href) !== href) {
    window.history.replaceState(null, '', stripOnboardingParams(href));
    commandBarWarningSignal.value = 'Salí del entrenamiento y volvé a abrir el link.';
  }
  return Promise.resolve({ kind: 'none' });
}
```

(Comparar con `stripOnboardingParams` alcanza si devuelve la URL tal cual cuando no hay nada que
sacar; verificarlo en `sync/demo-link.ts` y, si no, usar `readDemoEntry`/`readConnectReturn`.) Al
final de `bootstrap`, antes de `startSyncEngine()`:

```ts
  if (consumeTrainingExited()) {
    commandBarNoticeSignal.value = 'Saliste del entrenamiento.';
  }
```

`ui/state/cash.ts::cashCountOverdueSignal`:

```ts
/** "Sin arqueo en 24 h" (spec de #100, §6). En entrenamiento no (#177): la caja de práctica arranca en 0. */
export const cashCountOverdueSignal = computed(
  () => !isTrainingMode() && isCashCountOverdue(lastCashCountAtSignal.value, nowMinuteSignal.value),
);
```

`terminal-data.ts`: `LocalDataDump` suma `training: boolean` (`isTrainingMode()`); `resetTerminal`,
después de borrar las claves y **solo fuera del entrenamiento**, `await deleteTrainingDatabase()`.
En entrenamiento la base abierta es la de práctica (ya vaciada por `clearAllTables`) y borrarla
abierta se bloquearía: la marca cae con el prefijo, así que el próximo arranque la borra y, sin
device-id, borra también la real. Comentario: "#177: también la base de entrenamiento".

`diagnostics.ts::collectDiagnostics`: `trainingSince: trainingMark()?.startedAt ?? null`.
`diagnostico-screen.tsx`: cerca de la línea de la demo, si `trainingSince !== null`,
`Modo entrenamiento desde ${new Date(trainingSince).toLocaleString()}`. `pos.status()` ya lee
`collectDiagnostics`.

- [ ] **Paso 4:** PASAN; `pnpm lint && pnpm typecheck && pnpm test`.

- [ ] **Paso 5: commit** `feat: el arranque y los bordes del entrenamiento (identidad, links, caja, pos.*) (#177)`

---

### Tarea 8: la pantalla, la franja y el título

**Archivos:**
- Crear: `src/ui/screens/training-screen.tsx`, `src/ui/components/TrainingBanner.tsx`,
  `src/ui/screens/training-screen.test.tsx`
- Modificar: `src/ui/app.tsx`, `src/ui/tokens.css`, `src/ui/terminal-context.ts`

- [ ] **Paso 1: test de componentes que falla** (`training-screen.test.tsx`, Testing Library, como
  los de otras pantallas):

```tsx
import { render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { trainingScreenSignal } from '../state/training.ts';
import { TrainingScreen } from './training-screen.tsx';

afterEach(() => {
  trainingScreenSignal.value = null;
});

describe('pantalla de entrenamiento (#177)', () => {
  it('al entrar explica el modo, avisa lo pendiente y ofrece entrar', () => {
    trainingScreenSignal.value = { mode: 'enter', phase: 'ready', pending: 2 };
    render(<TrainingScreen />);
    expect(screen.getByRole('heading', { name: 'Entrar al entrenamiento' })).not.toBeNull();
    expect(screen.getByText(/Hay 2 operaciones sin enviar/)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Entrar al entrenamiento (Enter)' })).not.toBeNull();
  });

  it('al salir lista lo que se descarta', () => {
    trainingScreenSignal.value = { mode: 'exit', phase: 'ready', discard: { lines: ['1 venta'] } };
    render(<TrainingScreen />);
    expect(screen.getByText('1 venta')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Descartar y salir (Enter)' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Seguir entrenando (Esc)' })).not.toBeNull();
  });
});
```

Y en `terminal-context.test.ts` (si existe; si no, en un test nuevo): `trainingTitle('Caja 1 - Centro', true)`
devuelve `'ENTRENAMIENTO · Caja 1 - Centro'` y con `false` el mismo título.

- [ ] **Paso 2:** FALLAN. **Paso 3: la pantalla** (`training-screen.tsx`), calcada de
  `demo-confirm-screen.tsx` (mismo contenedor con `useFocusOnMount`, `keepFocusOnMouseDown`,
  `onKeyDown` que ignora Enter sobre un botón enfocado):
  - **Entrar**: `<h1>Entrar al entrenamiento</h1>`; párrafos: "Vas a practicar con el catálogo, el
    stock y los clientes reales: podés vender, cobrar y usar la caja.", "Nada se envía al backend.
    Al salir se borra todo lo que hiciste." y, con `pending > 0`, "Hay {n} operaciones sin enviar: se
    intenta mandarlas ahora; si no se puede, salen al terminar el entrenamiento." (singular con 1:
    "Hay 1 operación sin enviar: …"). `checking` → "Revisando los datos de esta terminal…";
    `starting` → "Preparando…". Botones "Cancelar (Esc)" (`.btn`) y "Entrar al entrenamiento
    (Enter)" (`.btn-primary`), deshabilitados fuera de `ready`.
  - **Salir**: `<h1>Salir del entrenamiento</h1>`; recuadro con borde `--color-danger` y "Se
    descarta:" + una línea por `discard.lines`; debajo, "Vuelven el stock, los saldos y el resumen
    reales; lo pendiente real sigue guardado.". `leaving` → "Saliendo…". Botones "Seguir entrenando
    (Esc)" (`.btn`) y "Descartar y salir (Enter)" (`.btn-danger`).
  - Enter → `confirmTraining()`, Esc → `cancelTraining()`.

- [ ] **Paso 4: la franja** (`TrainingBanner.tsx`):

```tsx
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { toggleTraining } from '../keyboard/training-controller.ts';

/**
 * Franja del modo entrenamiento (#177): arriba de todas las pantallas, inconfundible (rayas ámbar y
 * negro, distinta del chrome y de las advertencias). El botón hace lo mismo que `/ENTRENAMIENTO`.
 */
export function TrainingBanner() {
  return (
    <div class="training-banner" role="status">
      <span class="training-banner__text">
        MODO ENTRENAMIENTO · nada se envía al backend · todo se borra al salir
      </span>
      <button
        type="button"
        class="btn"
        tabIndex={-1}
        onMouseDown={keepFocusOnMouseDown}
        onClick={() => void toggleTraining()}
      >
        Salir del entrenamiento (/ENTRENAMIENTO)
      </button>
    </div>
  );
}
```

`tokens.css` (cerca de `.app-zoom-wrapper`):

```css
/* Modo entrenamiento (#177): franja de alto fijo; la pantalla toma el alto que queda. */
:root {
  --color-training-a: #f59e0b;
  --color-training-b: #111827;
  --training-banner-h: calc(40px * var(--text-zoom-compensation));
}
.app-zoom-wrapper--training {
  --app-height: calc(100svh / var(--app-zoom) - var(--training-banner-h));
}
.training-banner {
  height: var(--training-banner-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 0 var(--space-3);
  background: repeating-linear-gradient(
    -45deg,
    var(--color-training-a) 0 16px,
    var(--color-training-b) 16px 32px
  );
}
.training-banner__text {
  background: var(--color-training-b);
  color: var(--color-training-a);
  font-weight: bold;
  letter-spacing: 0.05em;
  padding: 2px var(--space-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.training-banner .btn {
  white-space: nowrap;
  flex-shrink: 0;
}
```

(Revisar los nombres de tokens de espacio reales en `tokens.css` y que `--app-height` se redefina bien
dentro del wrapper; si el `zoom` del wrapper cambia el cálculo, ajustarlo mirando cómo se define en
`:root`.)

- [ ] **Paso 5: `app.tsx`.** En `ActiveScreen`, después de `demoConfirmSignal` y del chequeo de
  conexión activa: `if (trainingScreenSignal.value !== null) return <TrainingScreen />;`. En `App`:

```tsx
  const training = isTrainingMode();
  return (
    <div class={training ? 'app-zoom-wrapper app-zoom-wrapper--training' : 'app-zoom-wrapper'}>
      {training && <TrainingBanner />}
      <ActiveScreen />
    </div>
  );
```

- [ ] **Paso 6: el título.** En `terminal-context.ts`, función pura
  `trainingTitle(title: string, training: boolean): string` (`ENTRENAMIENTO · ${title}` o `title`) y
  `startTerminalTitle` la aplica: `document.title = trainingTitle(terminalTitle(…) ?? baseTitle, isTrainingMode());`.

- [ ] **Paso 7:** PASAN; `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

- [ ] **Paso 8: prueba visual rápida.** `pnpm build && pnpm preview`, abrir con el navegador del
  panel, entrar al entrenamiento con el `ACTIVE_CONFIG` del e2e sembrado y mirar la franja a 1440 y a
  600 px de ancho (que el botón no se corte, que la venta no desborde). Ajustar si hace falta.

- [ ] **Paso 9: commit** `feat(ui): pantalla de entrenamiento, franja y título (#177)`

---

### Tarea 9: e2e

**Archivos:**
- Crear: `e2e/training.spec.ts`
- Modificar: `e2e/indexed-db.ts` (parámetro opcional `dbName = 'offline-pos'` en `getAllFromStore`)

- [ ] **Paso 1: `indexed-db.ts`.** `getAllFromStore<T>(page, storeName, dbName = 'offline-pos')` y
  usar `indexedDB.open(dbName)`. Comentario: "`dbName`: la de entrenamiento es
  `offline-pos#entrenamiento` (#177)."

- [ ] **Paso 2: el spec** (`e2e/training.spec.ts`), con el `test` de `fixtures.ts` (backend
  inalcanzable en `http://127.0.0.1:9`):

```ts
import { expect, test } from './fixtures.ts';
import { confirmCheckout, fillPayment, seedCatalog } from './helpers.ts';
import { getAllFromStore } from './indexed-db.ts';

type StoredStock = { productId: string; quantity: number };
type StoredOutboxEvent = { id: string; type: string; status: string };

const ARROZ = 'e2e-ALM-001';

async function sellArroz(page: import('@playwright/test').Page): Promise<void> {
  const bar = page.getByLabel('Barra de comandos');
  await bar.fill('arroz');
  await expect(page.getByText('Arroz 1kg').first()).toBeVisible();
  await bar.press('Enter');
  await bar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();
  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
}

test('entrenamiento: vende con stock real, nada se empuja y al salir vuelve lo real (#177)', async ({ page }) => {
  const pushes: string[] = [];
  await page.route('http://127.0.0.1:9/**', async (route) => {
    if (route.request().url().includes('/sync/push')) {
      pushes.push(route.request().url());
    }
    await route.abort();
  });

  await page.goto('/');
  await seedCatalog(page);

  // Una venta real que queda pendiente (el backend no contesta).
  await sellArroz(page);
  await page.getByRole('button', { name: /Continuar/ }).click();
  const realStock = (await getAllFromStore<StoredStock>(page, 'stock')).find((s) => s.productId === ARROZ);
  expect(realStock?.quantity).toBe(39);

  // Entrar.
  const bar = page.getByLabel('Barra de comandos');
  await bar.fill('/ENTRENAMIENTO');
  await bar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Entrar al entrenamiento' })).toBeVisible();
  await expect(page.getByText(/Hay 1 operación sin enviar/)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('MODO ENTRENAMIENTO · nada se envía al backend · todo se borra al salir')).toBeVisible();
  await expect(page).toHaveTitle(/^ENTRENAMIENTO · /);
  pushes.length = 0; // el último envío de lo real, antes de entrar, sí podía intentar un push

  // Una venta de entrenamiento: descuenta en la base de práctica y el comprobante lo dice.
  await sellArroz(page);
  await expect(page.getByText('ENTRENAMIENTO', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Continuar/ }).click();
  const trainingStock = (await getAllFromStore<StoredStock>(page, 'stock', 'offline-pos#entrenamiento'))
    .find((s) => s.productId === ARROZ);
  expect(trainingStock?.quantity).toBe(38);

  // /SINCRONIZAR en entrenamiento: nunca un push.
  await bar.fill('/SINCRONIZAR');
  await bar.press('Enter');
  await page.waitForTimeout(1500);
  expect(pushes).toEqual([]);

  // Salir.
  await page.getByRole('button', { name: 'Salir del entrenamiento (/ENTRENAMIENTO)' }).click();
  await expect(page.getByRole('heading', { name: 'Salir del entrenamiento' })).toBeVisible();
  await expect(page.getByText('1 venta')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Saliste del entrenamiento.')).toBeVisible();
  await expect(page.getByText(/MODO ENTRENAMIENTO/)).toHaveCount(0);

  // Lo real, intacto: stock 39 y la venta real todavía pendiente.
  const after = (await getAllFromStore<StoredStock>(page, 'stock')).find((s) => s.productId === ARROZ);
  expect(after?.quantity).toBe(39);
  const outbox = await getAllFromStore<StoredOutboxEvent>(page, 'outbox');
  expect(outbox.filter((e) => e.type === 'sale' && e.status === 'pending')).toHaveLength(1);

  // /RESUMEN real: un solo ticket.
  await bar.fill('/RESUMEN');
  await bar.press('Enter');
  await expect(page.getByText('Ticket #1')).toBeVisible();
  await expect(page.getByText('Ticket #2')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Y lo real sale en el próximo push.
  await bar.fill('/SINCRONIZAR');
  await bar.press('Enter');
  await expect.poll(() => pushes.length).toBeGreaterThan(0);
});
```

Ajustes esperables al correrlo: el nombre real del botón "Continuar (Esc)" del comprobante (con la
config por defecto `onCheckout: 'show'` se abre el comprobante), cómo se ven los tickets en
`/RESUMEN` y la forma de esperar el `/SINCRONIZAR` (mejor `expect.poll` sobre el log que un
`waitForTimeout`; si hay un indicador de "sincronizando", esperar a que vuelva). Que el ticket de
entrenamiento sea "#1" (numeración propia) se puede verificar también en el comprobante.

- [ ] **Paso 3:** `pnpm build && pnpm test:e2e e2e/training.spec.ts` → PASA (ajustar selectores
  hasta que pase, sin debilitar lo que se prueba: ningún push en entrenamiento, stock 38/39, venta
  real pendiente, `/RESUMEN` real).

- [ ] **Paso 4:** `pnpm test:e2e` completa → PASA (en particular `keyboard-only`, `text-size` y
  `mouse`, por la franja y el comando nuevo).

- [ ] **Paso 5: commit** `test(e2e): modo entrenamiento de punta a punta (#177)`

---

### Tarea 10: documentación y cierre

**Archivos:**
- Modificar: `AGENTS.md`, `src/storage/AGENTS.md`, `src/sync/AGENTS.md`, `src/ui/AGENTS.md`,
  `e2e/AGENTS.md` (una línea sobre `training.spec.ts` y `dbName`), la spec (Estado: implementada; el
  motivo exacto de los comandos cortados)
- Borrar: este plan (`docs/superpowers/plans/2026-10-04-modo-entrenamiento.md`)

- [ ] **Paso 1: `AGENTS.md` raíz.**
  - Índice: fila "Modo entrenamiento: base aparte, claves operativas, push cortado, comando, franja y
    ticket" → `src/storage/AGENTS.md` (base y claves), `src/sync/AGENTS.md` (sync),
    `src/ui/AGENTS.md` (UI).
  - Sección nueva "## Modo entrenamiento (#177)" (después de "Una sola pestaña"): spec; el principio
    (base aparte con recarga, nada se empuja, al salir se borra y vuelve lo real, lo pendiente real
    espera); qué se corta (`/CONFIG`, `/ALTA`, `/DEMO_NUEVA`, `/DEMO_RESET`, links de demo, reserva
    de crédito).
  - Tabla de comandos: `/ENTRENAMIENTO` | "Entra o sale del modo entrenamiento: nada se envía al
    backend y al salir se descarta (ver "Modo entrenamiento")".
  - "Estado del proyecto": fila `#177` | "Modo entrenamiento: base de Dexie aparte, nada se empuja,
    franja, ENTRENAMIENTO en el ticket y aviso al salir" | "PR #N".
  - "Siguiente": el epic #182 queda completo (sacar "antes del hito 2, modo entrenamiento (#177)").
  - "Issues abiertas": sacar #177 de "MVP de mini contax"; en "Transversal", sumar
    "#207 (concurrency del CI: cancelar la corrida vieja de un PR)".
- [ ] **Paso 2: los `AGENTS.md` de carpeta.** `src/storage/AGENTS.md`: sección "Modo entrenamiento
  (#177)" con `training-mode.ts` (marca, `operationalKey`, nombre de la base), `training-copy.ts`
  (qué se copia) y el borrado de la base huérfana en el arranque. `src/sync/AGENTS.md`: en "Push",
  el corte en `pushPendingLot`; en "Limpieza", que no corre en entrenamiento; en "Cuenta corriente",
  que en entrenamiento se evalúa offline. `src/ui/AGENTS.md`: sección "Modo entrenamiento (#177)"
  con el comando, la pantalla (entrar y salir), la franja, el título, el ticket, la caja y los
  bordes (links, identidad, `pos.*`), y "Teclado y mouse: dónde se aplica" con la pantalla y la franja.
- [ ] **Paso 3:** borrar este plan; en la spec, "Estado: implementada en el PR #N" (sin la referencia
  al plan, que queda en el historial).
- [ ] **Paso 4:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` → todo
  PASA.
- [ ] **Paso 5: commit** `docs: modo entrenamiento (#177) y #207 en issues abiertas`
- [ ] **Paso 6: informe y prueba manual** para el usuario (pasos en la UI y qué se debería ver);
  esperar su revisión y sus cambios antes del PR.
- [ ] **Paso 7: PR** (después de la revisión): push de la rama, PR con "Closes #177", merge commit.
  Después del merge: comentario en #177 apuntando al PR, #177 tildado en el epic #182 y verificar
  que el issue se cerró.
