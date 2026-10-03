# Link de demo con confirmación y demo revocada — plan de implementación

> **Para agentes:** se ejecuta **inline** con `superpowers:executing-plans`, tarea por tarea, frenando
> después de cada una con un resumen corto y esperando el visto bueno del usuario (`AGENTS.md`, "Cómo
> trabajamos"). Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** que un link de demo pida confirmación mostrando lo que se pierde (en vez de ignorarse o
borrar solo), y que una terminal con la demo revocada ofrezca empezar una nueva.

**Arquitectura:** `runOnboardingFromUrl` deja de decidir solo: aplica directo si no se pierde nada y,
si no, devuelve `confirm`. `bootstrap` abre una pantalla propia (`DemoConfirmScreen`) que hace el envío
previo, muestra lo que se pierde y, al confirmar, corre `startDemo` (lo que hoy hace `handleEntry`,
separado). La demo revocada es un 401/403 con la terminal en demo, detectado en
`noteSyncFailure`: frena el motor y la barra ofrece `/DEMO_NUEVA`, que navega al link de demo. El
demo-backend emite una key por demo y las puede revocar.

**Stack:** Preact + `@preact/signals`, Zod, Dexie, Vitest + Testing Library, Playwright; demo-backend
en Node + `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-10-02-link-de-demo-con-confirmacion-design.md`

## Restricciones globales

- Todo en español: textos, comentarios, commits.
- Funciones de negocio devuelven `Result<T>`; `try/catch` solo en adaptadores (`localStorage`, `fetch`).
- `localStorage` siempre por `storageKey('<nombre>')` (lo vigila `storage-keys.test.ts`).
- Teclado y mouse: `keepFocusOnMouseDown` en el contenedor; cada atajo con su botón y la etiqueta con
  el atajo; un botón enfocado con Tab + Enter no repite el atajo del contenedor; foco con
  `useFocusOnMount` (nunca `autoFocus`).
- La venta nunca se bloquea.
- El contrato sigue **4.4.0**: solo una aclaración de significado en el OpenAPI.
- Chequeo de cada tarea: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; en las tareas del
  demo-backend, además `pnpm test:backend && pnpm typecheck:backend`; `pnpm test:e2e` en la Tarea 7.
- Commits chicos, en español, terminados con
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de archivos

| Archivo | Qué cambia |
|---|---|
| `demo-backend/src/db.ts` | Tabla `demo_keys`, `SCHEMA_VERSION` 5 |
| `demo-backend/src/demo-keys.ts` (nuevo) | `issueDemoKey`, `revokeDemoKeys`, `isRevokedKey` |
| `demo-backend/src/routes/demo-sessions.ts` | Key propia por demo; `POST /_demo/revoke-demos` |
| `demo-backend/src/router.ts` | 401 a una key revocada |
| `demo-backend/src/panel.html` | Botón "Revocar las demos" |
| `src/sync/config.ts` | `demo.backend?` |
| `src/sync/demo-link.ts` | `buildDemoLink` |
| `src/sync/demo-revoked.ts` (nuevo) | Marca de demo revocada (persistida) y su detección |
| `src/ui/state/sync.ts` | `demoRevokedSignal` |
| `src/sync/backend-status.ts` | `noteSyncFailure` marca la demo revocada |
| `src/sync/engine.ts` | `withConnectorCycle` frena; `syncNow` borra la marca |
| `src/sync/apply-connection.ts` | Aplicar borra la marca |
| `src/ui/onboarding.ts` | `confirm`, sin `ignored`; `startDemo` exportada; guarda `demo.backend` |
| `src/ui/session-reset.ts` (nuevo) | `resetSessionAfterWipe` (compartido por arranque y pantalla) |
| `src/ui/keyboard/demo-confirm-model.ts` (nuevo) | `describeDemoLoss` (puro) |
| `src/ui/state/demo-confirm.ts` (nuevo) | `demoConfirmSignal` |
| `src/ui/keyboard/demo-confirm-controller.ts` (nuevo) | Abrir, cancelar, confirmar |
| `src/ui/screens/demo-confirm-screen.tsx` (nuevo) | La pantalla |
| `src/ui/app.tsx` | La pantalla delante de todo |
| `src/ui/bootstrap.ts` | Caso `confirm`, restaurar la marca, usar `resetSessionAfterWipe` |
| `src/ui/keyboard/onboarding-controller.ts` | `startNewDemo` |
| `src/ui/keyboard/commands.ts`, `command-bar-controller.ts` | `/DEMO_NUEVA` |
| `src/ui/components/StatusBar.tsx` | "La demo terminó" y el botón |
| `src/ui/screens/diagnostico-screen.tsx` | Demo y revocada en "Conexión" |
| `docs/connector-api.openapi.yaml`, `docs/integradores/guia.md` | Aclaración del 401 |
| `e2e/demo-onboarding.spec.ts` | Confirmar/cancelar con datos; demo revocada |
| `AGENTS.md`, `src/sync/AGENTS.md`, `src/ui/AGENTS.md`, `docs/historia.md` | Docs |

---

### Tarea 0: entorno y chequeos en verde

- [ ] **Paso 1:** `pnpm install`
- [ ] **Paso 2:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → todo en verde.
- [ ] **Paso 3:** `pnpm test:backend && pnpm typecheck:backend` → en verde.
- [ ] **Paso 4:** si algo falla antes de tocar nada, frenar y avisar (puede ser un flake conocido:
  #142).

Sin commit.

---

### Tarea 1: demo-backend — una key por demo y "Revocar las demos"

**Archivos:**
- Crear: `demo-backend/src/demo-keys.ts`
- Modificar: `demo-backend/src/db.ts`, `demo-backend/src/routes/demo-sessions.ts`,
  `demo-backend/src/router.ts`, `demo-backend/src/panel.html`
- Test: `demo-backend/test/routes/demo-sessions.test.ts`, `demo-backend/test/db.test.ts` (si fija
  `SCHEMA_VERSION`)

**Interfaces:**
- Produce: `POST /demo-sessions` devuelve `apiKey: 'demo-<uuid>'`; `POST /_demo/revoke-demos` →
  `200 { revoked: number }`; cualquier ruta autenticada con una key revocada → `401 { error: 'La demo
  terminó' }`. Lo usa el e2e de la Tarea 7.

- [ ] **Paso 1: tests que fallan** — en `demo-sessions.test.ts`, registrar también `infoRoutes`
  (`beforeAll`: `registerRoutes(demoSessionRoutes); registerRoutes(infoRoutes);`) y:

```ts
async function getInfo(apiKey: string): Promise<Response> {
  return fetch(`${baseUrl}/info`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'X-POS-Contract-Version': '4.4.0' },
  });
}

describe('keys de demo y revocación (#176)', () => {
  it('cada demo emite una key propia que anda', async () => {
    const first = (await (await createDemo({})).json()) as { apiKey: string };
    const second = (await (await createDemo({})).json()) as { apiKey: string };
    expect(first.apiKey).toMatch(/^demo-/);
    expect(second.apiKey).not.toBe(first.apiKey);
    expect((await getInfo(first.apiKey)).status).toBe(200);
  });

  it('revocar las demos: sus keys dan 401, otras keys siguen andando', async () => {
    const { apiKey } = (await (await createDemo({})).json()) as { apiKey: string };
    const revoke = await fetch(`${baseUrl}/_demo/revoke-demos`, { method: 'POST' });
    expect(await revoke.json()).toEqual({ revoked: 1 });

    const response = await getInfo(apiKey);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'La demo terminó' });
    expect((await getInfo('demo-api-key')).status).toBe(200);
  });

  it('una demo nueva después de revocar anda, y re-sembrar no borra las keys', async () => {
    const { apiKey: old } = (await (await createDemo({})).json()) as { apiKey: string };
    await fetch(`${baseUrl}/_demo/revoke-demos`, { method: 'POST' });
    const { apiKey } = (await (await createDemo({})).json()) as { apiKey: string };
    expect((await getInfo(apiKey)).status).toBe(200);
    expect((await getInfo(old)).status).toBe(401);
  });
});
```

  Y en el primer test (`crea una demo con el template por defecto…`) cambiar `apiKey: 'demo-api-key'`
  por `apiKey: expect.stringMatching(/^demo-/)`.

- [ ] **Paso 2:** `pnpm test:backend` → fallan (apiKey fija, 404 en `/_demo/revoke-demos`).

- [ ] **Paso 3: schema** — en `db.ts`, al final del `SCHEMA` (antes del cierre del template), y subir
  la versión:

```sql
CREATE TABLE IF NOT EXISTS demo_keys (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
```

```ts
/** Subir cuando cambia el schema: una base vieja se recrea vacía (es una demo) y el arranque resiembra. */
export const SCHEMA_VERSION = 5;
```

  Sumar `demo_keys` al comentario de tablas del encabezado: "las keys emitidas por `POST
  /demo-sessions` (#176), que `resetToSeed` no borra".

- [ ] **Paso 4: `demo-backend/src/demo-keys.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Keys de las demos (#176): cada `POST /demo-sessions` emite una propia, y el panel las puede revocar
 * (lo que en mini hacen el reinicio total o las 24 h sin uso). Una key revocada da 401; cualquier otra
 * se sigue aceptando (la fija `demo-api-key` de los e2e y de quien lo configure a mano). Viven fuera de
 * lo que re-siembra `resetToSeed`.
 */
export function issueDemoKey(db: DatabaseSync, now: string): string {
  const key = `demo-${randomUUID()}`;
  db.prepare('INSERT INTO demo_keys (key, created_at) VALUES (?, ?)').run(key, now);
  return key;
}

/** Revoca todas las keys emitidas que todavía no lo estaban; devuelve cuántas. */
export function revokeDemoKeys(db: DatabaseSync, now: string): number {
  const result = db
    .prepare('UPDATE demo_keys SET revoked_at = ? WHERE revoked_at IS NULL')
    .run(now);
  return Number(result.changes);
}

export function isRevokedKey(db: DatabaseSync, key: string | undefined): boolean {
  if (key === undefined) {
    return false;
  }
  const row = db
    .prepare('SELECT 1 AS revoked FROM demo_keys WHERE key = ? AND revoked_at IS NOT NULL')
    .get(key);
  return row !== undefined;
}
```

- [ ] **Paso 5: rutas** — en `routes/demo-sessions.ts`: separar la key de la conexión fija
  (`DEMO_CONNECTION` queda para la página de alta, que es el comercio "real") y sumar la ruta:

```ts
/** Sucursal y punto de venta de una demo. La key es propia de cada demo (#176). */
const DEMO_TERMINAL = { branch: 'CENTRAL', pointOfSale: 'Caja 1' };
/**
 * La conexión que devuelve la página falsa de alta: la del comercio "real" que nace del alta, con
 * la key fija (el minibackend acepta cualquier token no revocado), que nunca se revoca.
 */
const DEMO_CONNECTION = { apiKey: 'demo-api-key', ...DEMO_TERMINAL };
```

  En el handler de `POST /demo-sessions`:

```ts
      const now = new Date().toISOString();
      // Base única, de un solo comercio: cada demo pisa la anterior. Las keys no se re-siembran.
      resetToSeed(ctx.db, now, requested);
      sendJson(res, 201, {
        apiKey: issueDemoKey(ctx.db, now),
        ...DEMO_TERMINAL,
        template: requested,
        onboarding: { url: `${requestOrigin(req)}/_demo/onboarding`, label: 'Crear mi comercio' },
      });
```

  Y al final de `demoSessionRoutes`:

```ts
  {
    // Panel (#176): revoca las keys de todas las demos, como el reinicio total de mini.
    method: 'POST',
    pattern: /^\/_demo\/revoke-demos$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(res, 200, { revoked: revokeDemoKeys(ctx.db, new Date().toISOString()) });
    },
  },
```

- [ ] **Paso 6: router** — en `router.ts`, extraer el token y sumar el 401:

```ts
function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') {
    return undefined;
  }
  const token = /^Bearer (.+)$/.exec(header)?.[1]?.trim();
  return token === undefined || token === '' ? undefined : token;
}
```

  `hasValidBearerToken` pasa a `bearerToken(req) !== undefined` (o se reemplaza su uso). Después del
  chequeo de `requiresAuth`:

```ts
    // Una demo revocada (#176): el POS en demo lo toma como "la demo terminó".
    if (route.requiresAuth && isRevokedKey(db, bearerToken(req))) {
      sendJson(res, 401, { error: 'La demo terminó' });
      return;
    }
```

- [ ] **Paso 7: panel** — en `panel.html`, al lado de "Reset demo":

```html
    <button id="revoke-btn">Revocar las demos</button>
    <span id="revoke-status"></span>
```

```js
      document.getElementById('revoke-btn').addEventListener('click', async () => {
        const status = document.getElementById('revoke-status');
        const response = await fetch('/_demo/revoke-demos', { method: 'POST' });
        const { revoked } = await response.json();
        status.textContent = `Revocadas: ${revoked}.`;
      });
```

- [ ] **Paso 8:** `pnpm test:backend && pnpm typecheck:backend` → en verde (si `db.test.ts` fija
  `SCHEMA_VERSION` 4, actualizarlo).
- [ ] **Paso 9: commit** — `feat(demo-backend): una key por demo y "Revocar las demos" (#176)`.

---

### Tarea 2: `demo.backend`, `buildDemoLink` y la marca de demo revocada

**Archivos:**
- Crear: `src/sync/demo-revoked.ts`, `src/sync/demo-revoked.test.ts`
- Modificar: `src/sync/config.ts`, `src/sync/demo-link.ts`, `src/ui/state/sync.ts`,
  `src/sync/backend-status.ts`, `src/sync/engine.ts`, `src/sync/apply-connection.ts`,
  `src/ui/bootstrap.ts`
- Test: `src/sync/demo-link.test.ts`, `src/sync/backend-status.test.ts`, `src/sync/engine.test.ts`,
  `src/sync/apply-connection.test.ts`

**Interfaces:**
- Produce:
  - `DemoSessionInfo.backend?: string`.
  - `buildDemoLink(href: string, backend: string, template?: string): string` (URL absoluta).
  - `demoRevokedSignal: Signal<string | null>` (ISO de cuándo) y `setDemoRevoked(at: string | null)`
    en `ui/state/sync.ts`.
  - `sync/demo-revoked.ts`: `isDemoRevokedFailure(failure: Failure, config: Result<SyncConfig>):
    boolean`, `markDemoRevoked(at: string): void`, `clearDemoRevoked(): void`,
    `restoreDemoRevoked(): void`.

- [ ] **Paso 1: tests que fallan.**

  `demo-link.test.ts`:

```ts
describe('buildDemoLink (#176)', () => {
  it('arma el link en la misma carpeta, con backend y template', () => {
    const link = buildDemoLink('https://pos.x/0.3.0/?x=1#a', 'https://b.x/connector', 'kiosco');
    const url = new URL(link);
    expect(`${url.origin}${url.pathname}`).toBe('https://pos.x/0.3.0/');
    expect(url.searchParams.get('demo')).toBe('true');
    expect(url.searchParams.get('backend')).toBe('https://b.x/connector');
    expect(url.searchParams.get('template')).toBe('kiosco');
    expect(url.searchParams.get('x')).toBeNull();
    expect(url.hash).toBe('');
  });

  it('sin template no lo pone, y readDemoEntry lo lee de vuelta', () => {
    const link = buildDemoLink('https://pos.x/', 'https://b.x');
    expect(new URL(link).searchParams.has('template')).toBe(false);
    expect(readDemoEntry(link)).toEqual({ ok: true, value: { backend: 'https://b.x' } });
  });
});
```

  `demo-revoked.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { err, ok, type Result } from '../domain/result.ts';
import { storageKey } from '../storage/storage-namespace.ts';
import { demoRevokedSignal } from '../ui/state/sync.ts';
import type { SyncConfig } from './config.ts';
import {
  clearDemoRevoked,
  isDemoRevokedFailure,
  markDemoRevoked,
  restoreDemoRevoked,
} from './demo-revoked.ts';

const DEMO: Result<SyncConfig> = ok({
  type: 'rest',
  baseUrl: 'https://b.x',
  apiKey: 'demo-1',
  demo: { template: 'kiosco', onboarding: { url: 'https://b.x/alta', label: 'Alta' }, startedAt: 'x' },
});
const REAL: Result<SyncConfig> = ok({ type: 'rest', baseUrl: 'https://erp.x', apiKey: 'k' });

beforeEach(() => {
  localStorage.clear();
  demoRevokedSignal.value = null;
});

describe('isDemoRevokedFailure (#176)', () => {
  it('401 o 403 en demo es la demo revocada', () => {
    expect(isDemoRevokedFailure(err('sync/request-failed', { status: 401, message: 'x' }), DEMO)).toBe(true);
    expect(isDemoRevokedFailure(err('sync/request-failed', { status: 403, message: 'x' }), DEMO)).toBe(true);
  });

  it('fuera de demo, otro status o un error de red, no', () => {
    expect(isDemoRevokedFailure(err('sync/request-failed', { status: 401, message: 'x' }), REAL)).toBe(false);
    expect(isDemoRevokedFailure(err('sync/request-failed', { status: 500, message: 'x' }), DEMO)).toBe(false);
    expect(isDemoRevokedFailure(err('sync/request-failed', { message: 'x' }), DEMO)).toBe(false);
    expect(isDemoRevokedFailure(err('sync/timeout', undefined), DEMO)).toBe(false);
  });
});

describe('marca de demo revocada', () => {
  it('se guarda, se restaura y se borra', () => {
    markDemoRevoked('2026-10-02T10:00:00.000Z');
    expect(demoRevokedSignal.value).toBe('2026-10-02T10:00:00.000Z');
    demoRevokedSignal.value = null;
    restoreDemoRevoked();
    expect(demoRevokedSignal.value).toBe('2026-10-02T10:00:00.000Z');
    clearDemoRevoked();
    expect(demoRevokedSignal.value).toBeNull();
    expect(localStorage.getItem(storageKey('demo-revoked'))).toBeNull();
  });

  it('un valor mal formado se ignora', () => {
    localStorage.setItem(storageKey('demo-revoked'), '{"nope":1}');
    restoreDemoRevoked();
    expect(demoRevokedSignal.value).toBeNull();
  });
});
```

  En `backend-status.test.ts`: con una config
  en demo guardada (`saveSyncConfig`), `noteSyncFailure(err('sync/request-failed', { status: 401,
  message: 'Unauthorized' }))` deja `demoRevokedSignal.value` no nulo; con una config real, nulo. En
  `engine.test.ts`: con `demoRevokedSignal.value = 'x'`, `runPushCycle()` no llama a
  `pushBatch`/`getInfo` del conector falso; `syncNow()` borra la marca (`demoRevokedSignal.value` →
  `null`) y sí llama al conector. En `apply-connection.test.ts`: con la marca puesta,
  `applyConnection` exitoso la deja en `null`.

- [ ] **Paso 2:** `pnpm test` → fallan.

- [ ] **Paso 3: config** — en `sync/config.ts`:

```ts
/** Terminal en demo (#128): lo que devolvió `POST /demo-sessions`, para la marca, `/ALTA` y `/DEMO_NUEVA`. */
export const demoSessionInfoSchema = z.object({
  template: z.string(),
  onboarding: z.object({ url: z.url(), label: z.string() }),
  startedAt: z.string(),
  // El `backend` del link (#176), al que `/DEMO_NUEVA` le pide otra demo. Puede no ser la `baseUrl`
  // que devolvió la sesión. Ausente en una demo anterior a #176: se usa la `baseUrl`.
  backend: z.string().optional(),
});
```

- [ ] **Paso 4: `buildDemoLink`** — en `sync/demo-link.ts`, después de `returnUrlFor`:

```ts
/** El link de demo para `/DEMO_NUEVA` (#176): la misma carpeta del POS, sin query ni fragmento. */
export function buildDemoLink(href: string, backend: string, template?: string): string {
  const url = new URL(returnUrlFor(href));
  url.searchParams.set('demo', 'true');
  url.searchParams.set('backend', backend);
  if (template !== undefined) {
    url.searchParams.set('template', template);
  }
  return url.toString();
}
```

- [ ] **Paso 5: signal** — en `ui/state/sync.ts`, después de `setDemoSession`:

```ts
/**
 * Demo revocada (#176): cuándo un 401/403 con la terminal en demo mostró que su key ya no anda
 * (`null` = no). La persiste `sync/demo-revoked.ts`. Con la demo revocada no corre ningún push ni
 * pull; la barra de estado ofrece `/DEMO_NUEVA`. La venta sigue.
 */
export const demoRevokedSignal = signal<string | null>(null);

export function setDemoRevoked(at: string | null): void {
  demoRevokedSignal.value = at;
}
```

- [ ] **Paso 6: `sync/demo-revoked.ts`**

```ts
import { z } from 'zod';
import type { Failure, Result } from '../domain/result.ts';
import { storageKey } from '../storage/storage-namespace.ts';
import { setDemoRevoked } from '../ui/state/sync.ts';
import type { SyncConfig } from './config.ts';

/**
 * Demo revocada (#176). La key de una demo la dio `POST /demo-sessions` y se probó con un pull: con
 * la terminal en demo, un 401 o 403 no puede ser una key mal cargada, es una demo que el backend
 * revocó (en mini: el reinicio nocturno o 24 h sin uso). Estado operativo best-effort, como los
 * cursores: perderlo solo hace que el próximo ciclo lo vuelva a descubrir.
 */
const STORAGE_KEY = storageKey('demo-revoked');
const storedSchema = z.object({ at: z.string() });

/** Pura. */
export function isDemoRevokedFailure(failure: Failure, config: Result<SyncConfig>): boolean {
  return (
    config.ok &&
    config.value.demo !== undefined &&
    failure.error === 'sync/request-failed' &&
    (failure.meta.status === 401 || failure.meta.status === 403)
  );
}

export function markDemoRevoked(at: string): void {
  setDemoRevoked(at);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ at }));
  } catch {
    // Best-effort: el signal ya tiene el valor de esta sesión.
  }
}

export function clearDemoRevoked(): void {
  setDemoRevoked(null);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}

export function restoreDemoRevoked(): void {
  let parsedJson: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    parsedJson = raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    parsedJson = null;
  }
  const parsed = storedSchema.safeParse(parsedJson);
  setDemoRevoked(parsed.success ? parsed.data.at : null);
}
```

- [ ] **Paso 7: detección** — en `sync/backend-status.ts::noteSyncFailure`, primera línea:

```ts
  // #176: un 401/403 con la terminal en demo es la demo revocada.
  if (isDemoRevokedFailure(failure, loadSyncConfig())) {
    markDemoRevoked(new Date().toISOString());
  }
```

  (imports de `./config.ts` y `./demo-revoked.ts`; actualizar el comentario de la función).

- [ ] **Paso 8: motor** — en `sync/engine.ts::withConnectorCycle`, después del chequeo de
  `syncPausedSignal`:

```ts
  // #176: con la demo revocada no se golpea al backend con 401 cada ciclo; /SINCRONIZAR reintenta.
  if (demoRevokedSignal.value !== null) {
    return undefined;
  }
```

  Y en `syncNow`, primera línea: `clearDemoRevoked();` con un comentario ("/SINCRONIZAR vuelve a
  probar una demo revocada: si sigue dando 401, se marca de nuevo"). Actualizar el comentario de
  `withConnectorCycle`.

- [ ] **Paso 9: aplicar** — en `sync/apply-connection.ts::applyConnection`, junto a
  `setDemoSession(...)`: `clearDemoRevoked();` (comentario: "cualquier conexión aplicada deja atrás
  una demo revocada").

- [ ] **Paso 10: arranque** — en `ui/bootstrap.ts`, al lado de `restoreBackendNotices()`:
  `restoreDemoRevoked();`.

- [ ] **Paso 11:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → en verde.
- [ ] **Paso 12: commit** — `feat(sync): la demo revocada frena el sync, y el link para otra demo (#176)`.

---

### Tarea 3: el onboarding pide confirmación cuando se pierde algo

**Archivos:**
- Modificar: `src/ui/onboarding.ts`, `src/ui/bootstrap.ts` (solo lo que deja de compilar: el caso
  `ignored`)
- Test: `src/ui/onboarding.test.ts`

**Interfaces:**
- Produce:
  - `OnboardingOutcome` = `none` | `applied { notice? }` | `failed { notice }` | `review { candidate,
    notice }` | `confirm { entry: DemoEntry }`.
  - `export type DemoStartOutcome = { kind: 'applied'; notice?: string } | { kind: 'failed'; notice:
    string }`.
  - `export async function startDemo(entry: DemoEntry, config: Result<SyncConfig>, deps?:
    OnboardingDeps): Promise<DemoStartOutcome>`.
  - `export const defaultOnboardingDeps: OnboardingDeps` (el `defaultDeps` de hoy, exportado).

- [ ] **Paso 1: tests que fallan** — en `onboarding.test.ts` reemplazar los dos tests de "se ignora"
  y "ya en demo: reinicia aunque haya datos" por la matriz:

```ts
  it('ya en demo y sin datos: aplica directo', async () => {
    const outcome = await runOnboardingFromUrl(entry, { config: DEMO_CONFIG, hasUserData: false }, deps);
    expect(outcome).toEqual({ kind: 'applied' });
    expect(applied()?.local).toBe('wipe');
  });

  it.each([
    ['ya en demo con datos', DEMO_CONFIG, true],
    ['sin config con datos', NO_CONFIG, true],
    ['conexión real sin datos', REAL_CONFIG, false],
    ['conexión real con datos', REAL_CONFIG, true],
    ['config ilegible', err('sync/config-invalid', { issues: [] }) as Result<SyncConfig>, false],
  ])('%s: pide confirmación sin llamar al backend', async (_name, config, hasUserData) => {
    const outcome = await runOnboardingFromUrl(entry, { config, hasUserData }, deps);
    expect(outcome).toEqual({ kind: 'confirm', entry: { backend: 'https://b.x' } });
    expect(deps.requestDemoSession).not.toHaveBeenCalled();
    expect(deps.applyConnection).not.toHaveBeenCalled();
  });

  it('guarda el backend del link en demo.backend', async () => {
    await runOnboardingFromUrl(entry, { config: NO_CONFIG, hasUserData: false }, deps);
    expect(applied()?.candidate.demo?.backend).toBe('https://b.x');
  });
```

  Y un `describe('startDemo (#176)')` que pruebe con un `DemoEntry` directo: aplica con `wipe` y
  devuelve `{ kind: 'applied' }`; con `requestDemoSession` en `err('demo/not-offered', undefined)`
  devuelve `failed` con "No se pudo iniciar la demo: …" y no llama a `applyConnection`; con template
  desconocido reintenta y devuelve el aviso de plantilla. En el test 'entrada sin config: …' el
  `demo` esperado suma `backend: 'https://b.x'`.

- [ ] **Paso 2:** `pnpm test src/ui/onboarding.test.ts` → fallan.

- [ ] **Paso 3: implementación** — en `ui/onboarding.ts`:
  - Comentario del módulo: (a) pasa a "un link de demo **cuando no se pierde nada** (sin config o ya en
    demo, sin datos del usuario); si no, la terminal pide confirmación (`confirm`, #176)".
  - `OnboardingOutcome`: sacar `ignored`, sumar `{ kind: 'confirm'; entry: DemoEntry }`.
  - `defaultDeps` → `export const defaultOnboardingDeps`.
  - `handleEntry` queda:

```ts
/** No se pierde nada (#176): sin config, o ya en demo, y en los dos casos sin datos del usuario. */
function nothingToLose(context: OnboardingContext): boolean {
  const config = context.config;
  const noConfig = !config.ok && config.error === 'sync/config-missing';
  const inDemo = config.ok && config.value.demo !== undefined;
  return (noConfig || inDemo) && !context.hasUserData;
}

async function handleEntry(
  entry: Result<DemoEntry>,
  context: OnboardingContext,
  deps: OnboardingDeps,
): Promise<OnboardingOutcome> {
  if (!entry.ok) {
    return {
      kind: 'failed',
      notice: sentence(`No se pudo iniciar la demo: ${describeError(entry)}`),
    };
  }
  if (!nothingToLose(context)) {
    return { kind: 'confirm', entry: entry.value };
  }
  return startDemo(entry.value, context.config, deps);
}
```

  - `startDemo` es el resto del `handleEntry` de hoy (pedir la sesión, reintento sin template,
    candidato, `probeAndWipe`), con `config` en vez de `context.config`, devolviendo
    `DemoStartOutcome`, y con `backend: entry.backend` dentro de `demo`:

```ts
    demo: {
      template: session.value.template,
      onboarding: session.value.onboarding,
      startedAt: now,
      backend: entry.backend,
    },
```

- [ ] **Paso 4: `bootstrap`** — que compile: sacar `ignored` de las dos condiciones
  (`onboarding.kind === 'failed' || onboarding.kind === 'ignored'` → `onboarding.kind === 'failed'`).
  El caso `confirm` todavía no hace nada (llega en la Tarea 4): por ahora se trata como `none`, con la
  URL limpia (ya pasa: `kind !== 'none'`).

- [ ] **Paso 5:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → en verde.
- [ ] **Paso 6: commit** — `feat(onboarding): el link de demo pide confirmación si se pierde algo (#176)`.

---

### Tarea 4: la pantalla "Abrir una demo"

**Archivos:**
- Crear: `src/ui/session-reset.ts`, `src/ui/keyboard/demo-confirm-model.ts` (+ `.test.ts`),
  `src/ui/state/demo-confirm.ts`, `src/ui/keyboard/demo-confirm-controller.ts` (+ `.test.ts`),
  `src/ui/screens/demo-confirm-screen.tsx` (+ `.test.tsx`)
- Modificar: `src/ui/app.tsx`, `src/ui/bootstrap.ts`

**Interfaces:**
- Consume: `startDemo`, `defaultOnboardingDeps`, `DemoStartOutcome` (Tarea 3);
  `flushPendingBeforeWipe` (`sync/apply-connection.ts`); `summarizeLocalData`, `LocalDataSummary`
  (`storage/local-data.ts`); `runPushThenPull` (`sync/engine.ts`).
- Produce:
  - `resetSessionAfterWipe(): Promise<void>` (`ui/session-reset.ts`).
  - `DemoLoss = { pending?: string; draft?: string; history?: string; connection?: string }` y
    `describeDemoLoss(summary: LocalDataSummary, config: Result<SyncConfig>): DemoLoss`.
  - `demoConfirmSignal: Signal<DemoConfirmState | null>` con
    `DemoConfirmState = { phase: 'checking'; entry: DemoEntry } | { phase: 'confirming' | 'starting';
    entry: DemoEntry; loss: DemoLoss }`.
  - `openDemoConfirm(entry: DemoEntry, deps?: DemoConfirmDeps): Promise<void>`,
    `cancelDemoConfirm(): void`, `confirmDemo(deps?: DemoConfirmDeps): Promise<void>`.

- [ ] **Paso 1: modelo, test que falla** — `demo-confirm-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '../../domain/result.ts';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import type { SyncConfig } from '../../sync/config.ts';
import { describeDemoLoss } from './demo-confirm-model.ts';

const EMPTY: LocalDataSummary = {
  products: 10, customers: 5, sales: 0, cashMovements: 0, cashCounts: 0,
  customerPayments: 0, pendingOutbox: 0, pendingSales: 0, draftCartLines: 0,
};
const REAL: Result<SyncConfig> = ok({
  type: 'rest', baseUrl: 'https://erp.x/api', apiKey: 'k', branch: 'Centro', pointOfSale: 'Caja 2',
});
const DEMO: Result<SyncConfig> = ok({
  type: 'rest', baseUrl: 'https://b.x', apiKey: 'demo-1',
  demo: { template: 'kiosco', onboarding: { url: 'https://b.x/alta', label: 'Alta' }, startedAt: 'x' },
});

describe('describeDemoLoss (#176)', () => {
  it('lo pendiente, la venta en curso, el historial y la conexión real', () => {
    const loss = describeDemoLoss(
      { ...EMPTY, sales: 5, customerPayments: 1, cashMovements: 2, cashCounts: 1,
        pendingOutbox: 5, pendingSales: 3, draftCartLines: 4 },
      REAL,
    );
    expect(loss).toEqual({
      pending: 'Sin enviar a erp.x: 3 ventas y 2 movimientos más. Se pierden para siempre.',
      draft: 'La venta en curso (4 líneas).',
      history:
        'El historial de esta terminal (5 ventas, 1 cobranza, 2 movimientos de caja, 1 arqueo): se borra de esta terminal; lo ya enviado queda en erp.x.',
      connection: 'Conexión a erp.x · Sucursal Centro · Punto de venta Caja 2. Se reemplaza por la de la demo.',
    });
  });

  it('solo movimientos pendientes, singulares', () => {
    const loss = describeDemoLoss({ ...EMPTY, pendingOutbox: 1, draftCartLines: 1 }, REAL);
    expect(loss.pending).toBe('Sin enviar a erp.x: 1 movimiento. Se pierden para siempre.');
    expect(loss.draft).toBe('La venta en curso (1 línea).');
  });

  it('en demo: la conexión es la demo; sin nada local, solo la conexión', () => {
    expect(describeDemoLoss(EMPTY, DEMO)).toEqual({
      connection: 'Demo de kiosco en b.x. Se reemplaza por la de la demo.',
    });
  });

  it('sin config: sin conexión, y lo pendiente sin host', () => {
    const loss = describeDemoLoss({ ...EMPTY, pendingOutbox: 2, pendingSales: 2 },
      err('sync/config-missing', undefined));
    expect(loss).toEqual({
      pending: 'Sin enviar al backend: 2 ventas. Se pierden para siempre.',
    });
  });

  it('config ilegible', () => {
    const loss = describeDemoLoss(EMPTY, err('sync/config-invalid', { issues: [] }));
    expect(loss.connection).toBe('La configuración guardada, que no se puede leer. Se reemplaza por la de la demo.');
  });
});
```

- [ ] **Paso 2:** `pnpm test src/ui/keyboard/demo-confirm-model.test.ts` → falla.

- [ ] **Paso 3: `demo-confirm-model.ts`**

```ts
import type { Result } from '../../domain/result.ts';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import type { SyncConfig } from '../../sync/config.ts';
import { originKey } from '../../sync/connection.ts';

/** Lo que se pierde al abrir una demo (#176), en textos listos para la pantalla. Ausente = nada. */
export type DemoLoss = {
  pending?: string;
  draft?: string;
  history?: string;
  connection?: string;
};

function plural(count: number, singular: string, pluralForm: string): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).host : url;
}

/**
 * Pura. El catálogo y los clientes no cuentan: vuelven con cualquier pull. `pendingOutbox` incluye
 * las ventas pendientes; el resto son "movimientos" (de stock, de caja, cobranzas, clientes…).
 */
export function describeDemoLoss(summary: LocalDataSummary, config: Result<SyncConfig>): DemoLoss {
  const host = config.ok ? hostOf(originKey(config.value)) : undefined;
  const loss: DemoLoss = {};

  const others = summary.pendingOutbox - summary.pendingSales;
  const pendingParts = [
    ...(summary.pendingSales > 0 ? [plural(summary.pendingSales, 'venta', 'ventas')] : []),
    ...(others > 0
      ? [`${plural(others, 'movimiento', 'movimientos')}${summary.pendingSales > 0 ? ' más' : ''}`]
      : []),
  ];
  if (pendingParts.length > 0) {
    const target = host !== undefined ? `a ${host}` : 'al backend';
    loss.pending = `Sin enviar ${target}: ${pendingParts.join(' y ')}. Se pierden para siempre.`;
  }

  if (summary.draftCartLines > 0) {
    loss.draft = `La venta en curso (${plural(summary.draftCartLines, 'línea', 'líneas')}).`;
  }

  const historyParts = [
    ...(summary.sales > 0 ? [plural(summary.sales, 'venta', 'ventas')] : []),
    ...(summary.customerPayments > 0 ? [plural(summary.customerPayments, 'cobranza', 'cobranzas')] : []),
    ...(summary.cashMovements > 0
      ? [plural(summary.cashMovements, 'movimiento de caja', 'movimientos de caja')]
      : []),
    ...(summary.cashCounts > 0 ? [plural(summary.cashCounts, 'arqueo', 'arqueos')] : []),
  ];
  if (historyParts.length > 0) {
    const where = host ?? 'el backend';
    loss.history = `El historial de esta terminal (${historyParts.join(', ')}): se borra de esta terminal; lo ya enviado queda en ${where}.`;
  }

  const replaced = 'Se reemplaza por la de la demo.';
  if (config.ok) {
    const demo = config.value.demo;
    if (demo !== undefined) {
      loss.connection = `Demo de ${demo.template} en ${host ?? ''}. ${replaced}`;
    } else {
      const terminal = [
        ...(config.value.branch !== undefined ? [`Sucursal ${config.value.branch}`] : []),
        ...(config.value.pointOfSale !== undefined ? [`Punto de venta ${config.value.pointOfSale}`] : []),
      ];
      loss.connection = `${[`Conexión a ${host ?? ''}`, ...terminal].join(' · ')}. ${replaced}`;
    }
  } else if (config.error !== 'sync/config-missing') {
    loss.connection = `La configuración guardada, que no se puede leer. ${replaced}`;
  }
  return loss;
}
```

- [ ] **Paso 4: estado** — `ui/state/demo-confirm.ts`:

```ts
import { signal } from '@preact/signals';
import type { DemoEntry } from '../../sync/demo-link.ts';
import type { DemoLoss } from '../keyboard/demo-confirm-model.ts';

/**
 * La pantalla "Abrir una demo" (#176): `null` = cerrada. `checking` mientras manda lo pendiente y
 * cuenta; `confirming` esperando la decisión; `starting` pidiendo la demo, probándola y aplicándola.
 * `App` la muestra delante de todo, también sin conexión activa.
 */
export type DemoConfirmState =
  | { phase: 'checking'; entry: DemoEntry }
  | { phase: 'confirming' | 'starting'; entry: DemoEntry; loss: DemoLoss };

export const demoConfirmSignal = signal<DemoConfirmState | null>(null);
```

- [ ] **Paso 5: `ui/session-reset.ts`** (sale de `bootstrap`, que lo usa en el caso `applied`):

```ts
import { getCashBalance } from '../storage/cash-repository.ts';
import { cartSelectionIndexSignal, cartSignal } from './state/cart.ts';
import { lastCashCountAtSignal } from './state/cash.ts';
import { resetAttachedCustomer } from './state/customer.ts';
import { identityResetSignal } from './state/sync-config.ts';

/**
 * Después de aplicar una demo borrando lo local (#128, #176): la venta en curso y el cliente
 * adjunto en memoria ya no existen en la base, y el último arqueo tampoco (aviso "Sin arqueo en
 * 24 h"). Lo usan `bootstrap` y la pantalla "Abrir una demo".
 */
export async function resetSessionAfterWipe(): Promise<void> {
  cartSignal.value = { lines: [] };
  cartSelectionIndexSignal.value = null;
  resetAttachedCustomer();
  identityResetSignal.value = false;
  lastCashCountAtSignal.value = (await getCashBalance()).lastCountAt;
}
```

- [ ] **Paso 6: controller, tests que fallan** — `demo-confirm-controller.test.ts`, con dependencias
  inyectadas (`DemoConfirmDeps`) y signals reales:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../domain/result.ts';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import { commandBarNoticeSignal, commandBarWarningSignal } from '../state/command-bar.ts';
import { demoConfirmSignal } from '../state/demo-confirm.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { connectionStateSignal, syncPausedSignal } from '../state/sync.ts';
import { configNoticeSignal } from '../state/sync-config.ts';
import {
  cancelDemoConfirm,
  confirmDemo,
  openDemoConfirm,
  type DemoConfirmDeps,
} from './demo-confirm-controller.ts';

const SUMMARY: LocalDataSummary = {
  products: 0, customers: 0, sales: 1, cashMovements: 0, cashCounts: 0,
  customerPayments: 0, pendingOutbox: 2, pendingSales: 1, draftCartLines: 0,
};
const REAL = ok({ type: 'rest' as const, baseUrl: 'https://erp.x', apiKey: 'k' });
const ENTRY = { backend: 'https://b.x' };

function makeDeps() {
  return {
    loadConfig: vi.fn<DemoConfirmDeps['loadConfig']>(() => REAL),
    isOnline: vi.fn<DemoConfirmDeps['isOnline']>(() => true),
    flush: vi.fn<DemoConfirmDeps['flush']>(() => Promise.resolve()),
    summarize: vi.fn<DemoConfirmDeps['summarize']>(() => Promise.resolve(SUMMARY)),
    startDemo: vi.fn<DemoConfirmDeps['startDemo']>(() => Promise.resolve({ kind: 'applied' as const })),
    afterApplied: vi.fn<DemoConfirmDeps['afterApplied']>(() => Promise.resolve()),
    resumeSync: vi.fn<DemoConfirmDeps['resumeSync']>(),
  };
}

let deps: ReturnType<typeof makeDeps>;

beforeEach(() => {
  deps = makeDeps();
  demoConfirmSignal.value = null;
  syncPausedSignal.value = false;
  connectionStateSignal.value = 'active';
  activeScreenSignal.value = 'sale';
  commandBarNoticeSignal.value = null;
  commandBarWarningSignal.value = null;
  configNoticeSignal.value = null;
});

describe('openDemoConfirm (#176)', () => {
  it('pausa el sync, manda lo pendiente a la conexión actual y muestra lo que se pierde', async () => {
    const opening = openDemoConfirm(ENTRY, deps);
    expect(syncPausedSignal.value).toBe(true);
    expect(demoConfirmSignal.value?.phase).toBe('checking');
    await opening;
    expect(deps.flush).toHaveBeenCalledWith(REAL.value);
    expect(demoConfirmSignal.value).toMatchObject({ phase: 'confirming', entry: ENTRY });
  });

  it('sin red o sin config legible no intenta el envío', async () => {
    deps.isOnline.mockReturnValue(false);
    await openDemoConfirm(ENTRY, deps);
    deps.isOnline.mockReturnValue(true);
    deps.loadConfig.mockReturnValue(err('sync/config-missing', undefined));
    await openDemoConfirm(ENTRY, deps);
    expect(deps.flush).not.toHaveBeenCalled();
  });
});

describe('cancelDemoConfirm', () => {
  it('con la terminal activa: cierra, reanuda el sync y vuelve a la venta, sin pedir la demo', async () => {
    await openDemoConfirm(ENTRY, deps);
    cancelDemoConfirm(deps);
    expect(demoConfirmSignal.value).toBeNull();
    expect(deps.resumeSync).toHaveBeenCalled();
    expect(activeScreenSignal.value).toBe('sale');
    expect(deps.startDemo).not.toHaveBeenCalled();
  });

  it('sin conexión activa: cierra y deja el wizard requerido (sync pausado)', async () => {
    connectionStateSignal.value = 'unconfigured';
    await openDemoConfirm(ENTRY, deps);
    cancelDemoConfirm(deps);
    expect(demoConfirmSignal.value).toBeNull();
    expect(deps.resumeSync).not.toHaveBeenCalled();
    expect(syncPausedSignal.value).toBe(true);
  });

  it('mientras revisa no hace nada', () => {
    void openDemoConfirm(ENTRY, deps);
    cancelDemoConfirm(deps);
    expect(demoConfirmSignal.value?.phase).toBe('checking');
  });
});

describe('confirmDemo', () => {
  it('aplica la demo, limpia la sesión, reanuda y avisa la plantilla', async () => {
    deps.startDemo.mockResolvedValue({ kind: 'applied', notice: 'La plantilla x no existe; se usó kiosco.' });
    await openDemoConfirm(ENTRY, deps);
    await confirmDemo(deps);
    expect(deps.startDemo).toHaveBeenCalledWith(ENTRY, REAL);
    expect(deps.afterApplied).toHaveBeenCalled();
    expect(deps.resumeSync).toHaveBeenCalled();
    expect(demoConfirmSignal.value).toBeNull();
    expect(activeScreenSignal.value).toBe('sale');
    expect(commandBarNoticeSignal.value).toBe('La plantilla x no existe; se usó kiosco.');
  });

  it('si la demo falla con la terminal activa: nada borrado, vuelve a la venta con el aviso', async () => {
    deps.startDemo.mockResolvedValue({ kind: 'failed', notice: 'No se pudo iniciar la demo: x.' });
    await openDemoConfirm(ENTRY, deps);
    await confirmDemo(deps);
    expect(deps.afterApplied).not.toHaveBeenCalled();
    expect(commandBarWarningSignal.value).toBe('No se pudo iniciar la demo: x.');
    expect(deps.resumeSync).toHaveBeenCalled();
  });

  it('si la demo falla sin conexión activa: el aviso va al wizard', async () => {
    connectionStateSignal.value = 'unconfigured';
    deps.startDemo.mockResolvedValue({ kind: 'failed', notice: 'No se pudo iniciar la demo: x.' });
    await openDemoConfirm(ENTRY, deps);
    await confirmDemo(deps);
    expect(configNoticeSignal.value).toBe('No se pudo iniciar la demo: x.');
    expect(deps.resumeSync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Paso 7:** `pnpm test src/ui/keyboard/demo-confirm-controller.test.ts` → falla.

- [ ] **Paso 8: controller** — `ui/keyboard/demo-confirm-controller.ts`:

```ts
import type { Result } from '../../domain/result.ts';
import { summarizeLocalData, type LocalDataSummary } from '../../storage/local-data.ts';
import { flushPendingBeforeWipe } from '../../sync/apply-connection.ts';
import { loadSyncConfig, type SyncConfig } from '../../sync/config.ts';
import type { DemoEntry } from '../../sync/demo-link.ts';
import { runPushThenPull } from '../../sync/engine.ts';
import { startDemo, type DemoStartOutcome } from '../onboarding.ts';
import { resetSessionAfterWipe } from '../session-reset.ts';
import { commandBarNoticeSignal, commandBarWarningSignal } from '../state/command-bar.ts';
import { demoConfirmSignal } from '../state/demo-confirm.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { connectionStateSignal, setSyncPaused } from '../state/sync.ts';
import { configNoticeSignal } from '../state/sync-config.ts';
import { describeDemoLoss } from './demo-confirm-model.ts';

/**
 * "Abrir una demo" (#176): un link de demo con algo que perder. Primero se confirma y recién después
 * se pide la demo (cancelar nunca crea una caja de demo en el backend). Mientras está abierta, el sync
 * queda pausado como con `/CONFIG`.
 */
export type DemoConfirmDeps = {
  loadConfig: () => Result<SyncConfig>;
  isOnline: () => boolean;
  flush: (config: SyncConfig) => Promise<void>;
  summarize: () => Promise<LocalDataSummary>;
  startDemo: (entry: DemoEntry, config: Result<SyncConfig>) => Promise<DemoStartOutcome>;
  afterApplied: () => Promise<void>;
  resumeSync: () => void;
};

const defaultDeps: DemoConfirmDeps = {
  loadConfig: loadSyncConfig,
  isOnline: () => navigator.onLine,
  flush: (config) => flushPendingBeforeWipe(config),
  summarize: summarizeLocalData,
  startDemo: (entry, config) => startDemo(entry, config),
  afterApplied: resetSessionAfterWipe,
  resumeSync: () => {
    setSyncPaused(false);
    void runPushThenPull();
  },
};

/** Lo llama `bootstrap` con un `confirm`. Pausa el sync antes del primer `await`. */
export async function openDemoConfirm(
  entry: DemoEntry,
  deps: DemoConfirmDeps = defaultDeps,
): Promise<void> {
  setSyncPaused(true);
  demoConfirmSignal.value = { phase: 'checking', entry };
  // Como "Borrar" en el wizard: un último envío a la conexión actual, así "sin enviar" es real.
  const config = deps.loadConfig();
  if (config.ok && deps.isOnline()) {
    await deps.flush(config.value);
  }
  const loss = describeDemoLoss(await deps.summarize(), config);
  demoConfirmSignal.value = { phase: 'confirming', entry, loss };
}

/** Cierra la pantalla y vuelve a donde estaba: la venta, o el wizard requerido (sigue pausado). */
function leave(deps: DemoConfirmDeps): boolean {
  demoConfirmSignal.value = null;
  if (connectionStateSignal.value !== 'active') {
    return false;
  }
  activeScreenSignal.value = 'sale';
  deps.resumeSync();
  return true;
}

/** Esc o "Cancelar": no toca nada (la URL ya se limpió al arrancar). */
export function cancelDemoConfirm(deps: DemoConfirmDeps = defaultDeps): void {
  if (demoConfirmSignal.value?.phase !== 'confirming') {
    return;
  }
  leave(deps);
}

/** Enter o "Borrar y abrir la demo". Si la demo falla no se borró nada: vuelve con el motivo. */
export async function confirmDemo(deps: DemoConfirmDeps = defaultDeps): Promise<void> {
  const current = demoConfirmSignal.value;
  if (current?.phase !== 'confirming') {
    return;
  }
  demoConfirmSignal.value = { ...current, phase: 'starting' };
  const outcome = await deps.startDemo(current.entry, deps.loadConfig());
  if (outcome.kind === 'applied') {
    await deps.afterApplied();
    leave(deps);
    if (outcome.notice !== undefined) {
      commandBarNoticeSignal.value = outcome.notice;
    }
    return;
  }
  if (leave(deps)) {
    commandBarWarningSignal.value = outcome.notice;
  } else {
    configNoticeSignal.value = outcome.notice;
  }
}
```

- [ ] **Paso 9: pantalla, test que falla** — `demo-confirm-screen.test.tsx` (Testing Library, sin
  jest-dom): con `demoConfirmSignal` en `confirming` y una `loss` completa, se ven los cuatro textos,
  "Se conservan el formato de impresión (/IMPRESORA) y el formato de números." y los botones "Cancelar
  (Esc)" y "Borrar y abrir la demo (Enter)"; en `checking`, "Revisando los datos de esta terminal…" y
  los botones deshabilitados; en `starting`, "Abriendo la demo…". Mockear el controller con
  `vi.mock('../keyboard/demo-confirm-controller.ts', …)` y verificar que Enter en el contenedor llama a
  `confirmDemo`, Esc a `cancelDemoConfirm`, y Enter con un `<button>` enfocado no llama a
  `confirmDemo`.

- [ ] **Paso 10: pantalla** — `ui/screens/demo-confirm-screen.tsx`, con el mismo esqueleto que
  `demo-reset-screen.tsx` (contenedor con `useFocusOnMount`, `tabIndex={-1}`, `onKeyDown`,
  `onMouseDown={keepFocusOnMouseDown}`, mismos estilos):

```tsx
export function DemoConfirmScreen() {
  const containerRef = useFocusOnMount<HTMLDivElement>();
  const state = demoConfirmSignal.value;
  if (state === null) {
    return null;
  }
  const busy = state.phase !== 'confirming';
  const host = URL.canParse(state.entry.backend) ? new URL(state.entry.backend).host : state.entry.backend;

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    // Un botón enfocado con Tab se activa solo con Enter (nativo): no duplicar la acción.
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void confirmDemo();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelDemoConfirm();
    }
  };

  return (
    <div ref={containerRef} tabIndex={-1} onKeyDown={handleKeyDown} onMouseDown={keepFocusOnMouseDown} style={/* como demo-reset-screen */}>
      <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Abrir una demo</h1>
      <p style={{ margin: 0 }}>Se abrió un link de demo de {host}.</p>
      {state.phase === 'checking' ? (
        <p style={{ margin: 0 }}>Revisando los datos de esta terminal…</p>
      ) : (
        <LossList loss={state.loss} />
      )}
      {state.phase === 'starting' && <p style={{ margin: 0 }}>Abriendo la demo…</p>}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="button" class="btn" onClick={() => { cancelDemoConfirm(); }} disabled={busy}>
          Cancelar (Esc)
        </button>
        <button type="button" class="btn btn-danger" onClick={() => void confirmDemo()} disabled={busy}>
          Borrar y abrir la demo (Enter)
        </button>
      </div>
    </div>
  );
}
```

  `LossList`: un recuadro con borde `var(--color-danger)` y el título "Se pierde:", después los
  renglones presentes en orden (`pending` en negrita y `var(--color-danger)`, `draft`, `history`,
  `connection`), y fuera del recuadro, en `var(--color-text-muted)`, "Se conservan el formato de
  impresión (/IMPRESORA) y el formato de números." Ojo con `useFocusOnMount` antes del `return null`:
  el hook va siempre primero (regla de hooks).

- [ ] **Paso 11: `App`** — en `ui/app.tsx::ActiveScreen`, primera línea:

```tsx
  // #176: un link de demo con algo que perder se confirma antes que nada, con o sin conexión activa.
  if (demoConfirmSignal.value !== null) {
    return <DemoConfirmScreen />;
  }
```

- [ ] **Paso 12: `bootstrap`** — reemplazar el bloque del caso `applied` por
  `await resetSessionAfterWipe();` (mismo efecto) y, después del bloque que abre el wizard o pone los
  avisos y **antes** de `startSyncEngine()`:

```ts
  if (onboarding.kind === 'confirm') {
    // #176: hay algo que perder. El wizard requerido queda abajo, por si se cancela sin conexión.
    if (state !== 'active') {
      await openRequiredWizard();
    }
    void openDemoConfirm(onboarding.entry);
  }
```

  (Integrarlo en la cadena `if/else if` existente: con `confirm` y `state !== 'active'` hoy entraría a
  `else if (state !== 'active') await openRequiredWizard()`, lo que está bien; el `openDemoConfirm` va
  después de esa cadena. `openDemoConfirm` pausa el sync de forma síncrona, así `startSyncEngine` no
  corre nada.)

- [ ] **Paso 13:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → en verde.
- [ ] **Paso 14: commit** — `feat(onboarding): pantalla "Abrir una demo" con lo que se pierde (#176)`.

---

### Tarea 5: `/DEMO_NUEVA`, la barra de estado y `/DIAGNOSTICO`

**Archivos:**
- Modificar: `src/ui/keyboard/onboarding-controller.ts`, `src/ui/keyboard/commands.ts`,
  `src/ui/keyboard/command-bar-controller.ts`, `src/ui/components/StatusBar.tsx`,
  `src/ui/screens/diagnostico-screen.tsx`
- Test: `onboarding-controller.test.ts`, `command-bar-controller.test.ts` (o el de `commands`),
  `StatusBar.test.tsx`, `diagnostico-screen.test.tsx`

**Interfaces:**
- Consume: `buildDemoLink`, `demoRevokedSignal` (Tarea 2); `DemoSessionInfo.backend`.
- Produce: `startNewDemo(navigate?: (url: string) => void): void`.

- [ ] **Paso 1: tests que fallan.**
  - `onboarding-controller.test.ts`: con `demoSessionSignal` en una demo con `backend:
    'https://b.x/connector'` y `template: 'kiosco'`, `startNewDemo(navigate)` llama a `navigate` con
    una URL cuyo `searchParams` tiene `demo=true`, `backend=https://b.x/connector`,
    `template=kiosco`; sin `backend` en la demo y con una config `rest` guardada con `baseUrl:
    'https://b.x'`, usa esa; sin demo no navega.
  - Comandos: con demo, `availableCommands()` incluye `DEMO_NUEVA`; sin demo, no. `/DEMO_NUEVA` en la
    barra sin demo da "Comando desconocido: /DEMO_NUEVA".
  - `StatusBar.test.tsx`: con demo y `demoRevokedSignal.value = 'x'`: se ve "La demo terminó", el botón
    "Empezar una demo nueva (/DEMO_NUEVA)" y **no** el botón del alta; el click llama a `startNewDemo`
    (mock del módulo) y no abre `/DIAGNOSTICO`. Con demo sin revocar, lo de hoy.
  - `diagnostico-screen.test.tsx`: con una config en demo, "Demo de kiosco"; con la marca,
    "Demo de kiosco · revocada desde <hora>" (comparar con `toLocaleString()` de la fecha).

- [ ] **Paso 2:** `pnpm test` → fallan.

- [ ] **Paso 3: `startNewDemo`** — en `onboarding-controller.ts`:

```ts
/**
 * `/DEMO_NUEVA` y el botón de la demo revocada (#176): navega al link de demo armado con lo guardado,
 * así todo sigue por el arranque (directo sin datos del usuario, o la confirmación). El backend es el
 * del link original; una demo anterior a #176 no lo tiene y usa su `baseUrl`. Sin demo no hace nada.
 */
export function startNewDemo(
  navigate: (url: string) => void = (url) => {
    window.location.assign(url);
  },
): void {
  const demo = demoSessionSignal.value;
  if (demo === null) {
    return;
  }
  const config = loadSyncConfig();
  const backend =
    demo.backend ?? (config.ok && config.value.type === 'rest' ? config.value.baseUrl : undefined);
  if (backend === undefined) {
    return;
  }
  navigate(buildDemoLink(window.location.href, backend, demo.template));
}
```

- [ ] **Paso 4: comandos** — en `commands.ts::availableCommands`:

```ts
  const demoCommands: CommandInfo[] =
    demo !== null
      ? [
          { name: 'ALTA', description: `Darse de alta: ${demo.onboarding.label}` },
          { name: 'DEMO_NUEVA', description: 'Empezar una demo nueva (se borra lo de esta)' },
        ]
      : [];
  return [...CORE_COMMANDS, ...demoCommands, ...connectorCommands(activeConnectorTypeSignal.value)];
```

  (actualizar el comentario: "`/ALTA` y `/DEMO_NUEVA` si la terminal está en demo"). En
  `command-bar-controller.ts::runCommand`, después de `case 'ALTA'`:

```ts
    case 'DEMO_NUEVA':
      // Solo existe con la terminal en demo (#176).
      if (demoSessionSignal.value === null) {
        commandBarErrorSignal.value = `Comando desconocido: /${name}`;
        return;
      }
      clearBuffer();
      startNewDemo();
      return;
```

- [ ] **Paso 5: barra de estado** — en `StatusBar.tsx`:
  - `statusText()`: después de "Sin configurar", `if (demoRevokedSignal.value !== null) return 'La
    demo terminó';` y `statusColor()`: lo mismo con `var(--color-danger)`. Así queda delante del
    estado de sync (que ya no corre) pero detrás de offline.
  - En el grupo de la derecha, dentro de `demo !== null`: si `demoRevokedSignal.value !== null`, en vez
    del botón del alta, un botón igual (mismos estilos, `tabIndex={-1}`, `keepFocusOnMouseDown`,
    `stopPropagation`) con `startNewDemo()` y el texto y `title` "Empezar una demo nueva
    (/DEMO_NUEVA)".
  - Actualizar el comentario del componente.

- [ ] **Paso 6: `/DIAGNOSTICO`** — en la tarjeta "Conexión", si `configResult.value.demo` existe, un
  renglón más:

```tsx
              {configResult.value.demo !== undefined && (
                <p style={{ margin: 0 }}>
                  Demo de {configResult.value.demo.template}
                  {demoRevokedSignal.value !== null &&
                    ` · revocada desde ${new Date(demoRevokedSignal.value).toLocaleString()}`}
                </p>
              )}
```

- [ ] **Paso 7:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → en verde.
- [ ] **Paso 8: commit** — `feat(demo): /DEMO_NUEVA y la demo revocada en la barra y /DIAGNOSTICO (#176)`.

---

### Tarea 6: el contrato aclara el 401 de una demo revocada

**Archivos:**
- Modificar: `docs/connector-api.openapi.yaml`, `docs/integradores/guia.md` (si habla de las demos)

- [ ] **Paso 1:** en la descripción de `POST /demo-sessions`, al final:

```yaml
        **Revocar una demo**: el backend puede revocar la conexión de una
        demo cuando quiera (por ejemplo, al reiniciar los datos de la demo o
        tras un tiempo sin uso). Desde entonces responde `401` a todo request
        con esa API key. El POS en demo lo toma como "la demo terminó": deja
        de sincronizar y ofrece empezar una demo nueva, que es otro
        `POST /demo-sessions` al mismo backend. Fuera de una demo, un `401`
        sigue siendo una credencial inválida.
```

  Y en "Vuelta del onboarding" de la descripción general, una oración: "Una demo revocada (ver
  `POST /demo-sessions`) puede ir igual al alta: la vuelta trae una conexión nueva."

- [ ] **Paso 2:** buscar en `docs/integradores/guia.md` (y `llms.txt`) la sección de demos; si
  existe, sumar la misma aclaración en una o dos oraciones.
- [ ] **Paso 3:** `pnpm test` (corre `site/docs.test.ts`: sin referencias internas) → en verde.
- [ ] **Paso 4: commit** — `docs(contrato): un 401 a la key de una demo es la demo revocada (#176)`.

---

### Tarea 7: e2e

**Archivos:**
- Modificar: `e2e/demo-onboarding.spec.ts`

**Interfaces:**
- Consume: `POST http://localhost:4001/_demo/revoke-demos` (Tarea 1), los textos de las Tareas 4 y 5.

- [ ] **Paso 1:** reemplazar el test `con una conexión real el link se ignora y avisa` por:

```ts
fixtureTest('con datos sin enviar: el link pide confirmación; Esc no toca nada, Enter abre la demo', async ({
  page,
}) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();
  await seedCatalog(page);

  // Una venta que nunca llega: el backend del fixture es inalcanzable.
  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');
  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();
  await fillPayment(page, 'Efectivo', 1200);
  await confirmCheckout(page);
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();

  await page.goto(DEMO_LINK);
  await expect(page.getByRole('heading', { name: 'Abrir una demo' })).toBeVisible();
  await expect(page.getByText(/Sin enviar a 127\.0\.0\.1:9: 1 venta/)).toBeVisible();
  await expect(page.getByText(/Conexión a 127\.0\.0\.1:9/)).toBeVisible();
  expect(page.url()).not.toContain('demo=');

  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  expect(await getAllFromStore(page, 'sales')).toHaveLength(1);
  expect(await readConfig(page)).toMatchObject({ baseUrl: 'http://127.0.0.1:9' });

  await page.goto(DEMO_LINK);
  await expect(page.getByRole('heading', { name: 'Abrir una demo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Borrar y abrir la demo (Enter)' })).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();
  expect(await getAllFromStore(page, 'sales')).toHaveLength(0);
  expect(await readConfig(page)).toMatchObject({ baseUrl: BACKEND, demo: { backend: BACKEND } });
});

test('demo revocada: la barra lo dice y "Empezar una demo nueva" arranca otra limpia', async ({
  page,
}) => {
  await page.goto(DEMO_LINK);
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();
  const { apiKey: oldKey } = (await readConfig(page)) as { apiKey: string };

  await page.request.post(`${BACKEND}/_demo/revoke-demos`);
  await commandBar.fill('/SINCRONIZAR');
  await commandBar.press('Enter');
  await expect(page.getByText('La demo terminó')).toBeVisible();

  await page.getByRole('button', { name: 'Empezar una demo nueva (/DEMO_NUEVA)' }).click();
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();
  await expect(page.getByText('La demo terminó')).toHaveCount(0);
  const { apiKey } = (await readConfig(page)) as { apiKey: string };
  expect(apiKey).toMatch(/^demo-/);
  expect(apiKey).not.toBe(oldKey);
});
```

  Imports: `seedCatalog` de `./helpers.ts`. Ojo: el fixture vuelve a sembrar `ACTIVE_CONFIG` en cada
  navegación, por eso el último `readConfig` del primer test se hace sin navegar (la demo se aplica en
  la misma página). Si el texto de "Sin enviar" incluye "y N movimientos más" (la venta también encola
  su movimiento de stock), la regex de arriba igual coincide.

- [ ] **Paso 2:** `pnpm test:e2e e2e/demo-onboarding.spec.ts` → en verde. Si algo no coincide con el
  código, frenar y avisar antes de cambiar el diseño.
- [ ] **Paso 3:** `pnpm test:e2e` completo → en verde (los flakes conocidos, #155 y #169, se anotan si
  aparecen).
- [ ] **Paso 4: commit** — `test(onboarding): e2e del link con datos y la demo revocada (#176)`.

---

### Tarea 8: documentación y aviso al mini-erp

**Archivos:**
- Modificar: `AGENTS.md`, `src/sync/AGENTS.md`, `src/ui/AGENTS.md`, `e2e/AGENTS.md` (si cambia algo de
  los backends del e2e), `docs/historia.md`

- [ ] **Paso 1: `AGENTS.md` raíz**
  - "Ciclo de vida de la conexión": la excepción (a) pasa a "un link de demo cuando no se pierde nada
    (sin config o ya en demo, sin datos del usuario), o con la confirmación del operador (#176)".
  - "Onboarding de demo": el punto 1 dice que con algo que perder (datos del usuario, una conexión
    real u otra demo con datos) pide confirmación en "Abrir una demo" mostrando lo que se pierde, y
    que la demo se pide recién al confirmar; sumar un punto 4: demo revocada (401/403 en demo), "La
    demo terminó" y `/DEMO_NUEVA`.
  - Tabla de comandos: fila `/DEMO_NUEVA` ("Solo con la terminal en demo: empieza una demo nueva con
    el backend y la plantilla de la actual").
  - "Estado del proyecto": fila #176 (sin número de PR todavía; se completa al abrirlo) y sacar P3
    de "Siguiente".
- [ ] **Paso 2: `src/sync/AGENTS.md`**, sección "Onboarding de demo (#128)": `confirm` en vez de
  `ignored`, `startDemo`, `demo.backend`, `buildDemoLink`, y una fila para `sync/demo-revoked.ts`
  (detección en `noteSyncFailure`, frena `withConnectorCycle`, la borran `syncNow` y
  `applyConnection`). Mencionar en "Contrato 4.4.0" la aclaración del 401.
- [ ] **Paso 3: `src/ui/AGENTS.md`**: en "Barra de estado", la demo revocada; en "`/CONFIG` como
  wizard → Onboarding de demo", sacar el aviso "se ignoró el link" y apuntar a la pantalla nueva; una
  sección corta "Abrir una demo (#176)" (pantalla, controller, modelo puro, `App` la muestra delante
  de todo, patrón de teclado); en "Teclado y mouse: dónde se aplica", la pantalla y el botón de la
  barra.
- [ ] **Paso 4: `docs/historia.md`**: una entrada de #176 con las decisiones (regla única,
  confirmación antes de pedir la demo, 401 en demo sin cambio de forma, key por demo en el
  demo-backend) y cualquier desvío del plan.
- [ ] **Paso 5:** `pnpm lint && pnpm test` → en verde.
- [ ] **Paso 6: commit** — `docs: link de demo con confirmación y demo revocada (#176)`.
- [ ] **Paso 7: aviso al mini-erp (con el ok del usuario)** — proponerle el texto de un comentario en
  rauldiazsolis/mini-erp#24: el POS toma un 401 a la key de una demo como demo revocada y ofrece una
  demo nueva con otro `POST /demo-sessions` al mismo backend (el que vino en el link) y la misma
  plantilla; no hace falta ningún código propio en el 401; el `onboarding` y la vuelta con `#connect`
  no cambian. Publicarlo solo cuando lo apruebe.

---

## Al terminar

Informe final con la prueba manual paso a paso (`AGENTS.md`, "Cómo trabajamos"): link de demo sin
datos, con una venta sin enviar (cancelar y confirmar), con una conexión real, y la demo revocada
desde el panel `/_demo` del demo-backend (`pnpm backend`). **No abrir el PR** hasta que el usuario haga
la prueba y lo apruebe.
