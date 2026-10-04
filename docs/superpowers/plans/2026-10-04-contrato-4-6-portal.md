# Contrato 4.6.0: capacidad `portal`, 429 y 503 — plan de implementación

> **Para agentes:** se ejecuta **inline** con `superpowers:executing-plans`, tarea por tarea con
> checkpoints (convención del repo, `AGENTS.md` → "Cómo trabajamos"). Los pasos usan checkboxes
> (`- [ ]`).

**Objetivo:** publicar el contrato 4.6.0 (capacidad `portal` con `POST /portal-links`, `ErrorBody`,
el 503 de mantenimiento y el 429/503 de `/demo-sessions`), con el demo-backend como referencia
ejecutable y mensajes claros en el POS para los errores de la demo.

**Arquitectura:** el contrato es aditivo (piso 4.0.0). El POS solo sube su versión y traduce los
errores nuevos de `POST /demo-sessions` en `sync/demo-session.ts`; el portal en el POS es P6 (#179).
El demo-backend suma un cierre por mantenimiento en el router, un modo simulado para
`/demo-sessions` y el portal (tabla `portal_links`, emisión y canje).

**Stack:** TypeScript estricto, Zod, Vitest; demo-backend en Node 24 con `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-10-04-contrato-4-6-portal-design.md`

## Restricciones globales

- Todo en español: código, comentarios, commits, docs.
- `any` prohibido; `unknown` solo en el borde y validado con Zod en la línea siguiente.
- Funciones de negocio devuelven `Result<T>`; `try/catch` solo en adaptadores.
- `POS_CONTRACT_VERSION = '4.6.0'`; `MIN_BACKEND_CONTRACT` sigue `'4.0.0'`.
- Capacidad: `portal`; objeto `portal: { command, label }`; `command` con `^[A-Z0-9_]{2,16}$`.
- Endpoint: `POST /portal-links` → `201 { url, expiresAt? }`; la URL nunca lleva la key.
- `ErrorBody { code, message? }`; códigos `maintenance`, `rate-limited`, `demo-capacity`.
- Demo-backend: comando `PANEL`, texto `Panel del backend`, link de un solo uso que vence a los
  60 s, `Retry-After: 30` en mantenimiento y `Retry-After: 600` en el 429 simulado.
- Verificación local antes de cada commit: `pnpm lint && pnpm typecheck && pnpm test`; en las
  tareas del demo-backend, además `pnpm test:backend && pnpm typecheck:backend` (su Vitest es aparte:
  `vite.config.ts` excluye `demo-backend/**`). `pnpm build` y `pnpm test:e2e` en la verificación
  final.
- Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Tarea 1: el POS habla 4.6.0

**Archivos:**
- Modificar: `src/domain/contract-version.ts`
- Tests: `src/domain/contract-version.test.ts`, `src/sync/demo-session.test.ts:37`,
  `src/connectors/rest/rest-fetch-connector.test.ts:404,426,452`,
  `src/connectors/google-sheets/bridge-client.test.ts:190`,
  `src/connectors/google-sheets/google-sheets-connector.test.ts:375`,
  `src/sync/connection.test.ts:338`

**Interfaces:** produce `POS_CONTRACT_VERSION === '4.6.0'`.

- [ ] **Paso 1: test que falla.** En `contract-version.test.ts`:

```ts
  it('el piso es 4.0.0 y el POS habla 4.6.0', () => {
    expect(MIN_BACKEND_CONTRACT).toBe('4.0.0');
    expect(POS_CONTRACT_VERSION).toBe('4.6.0');
  });
```

- [ ] **Paso 2:** `pnpm vitest run src/domain/contract-version.test.ts` → FALLA (`'4.5.0'`).
- [ ] **Paso 3: implementar.** En `contract-version.ts`, cerrar el comentario con "…, 4.5.0 desde
  #193 (`company` opcional en `GET /info`), 4.6.0 desde #178 (capacidad `portal` con
  `POST /portal-links`, `ErrorBody`, el 503 de mantenimiento y el 429/503 de `/demo-sessions`)." y
  `export const POS_CONTRACT_VERSION = '4.6.0';`.
- [ ] **Paso 4:** cambiar a `'4.6.0'` los literales que representan la versión **del POS** en los
  tests de la lista (el header `X-POS-Contract-Version`, `meta.pos`, el `contractVersion` que manda
  el puente). No tocar los que simulan la respuesta de un backend (`contractVersion` de `/info`).
- [ ] **Paso 5:** `pnpm test` → todo PASA. Si falla otro test por la versión, aplicar el mismo
  criterio del paso 4.
- [ ] **Paso 6:** `pnpm lint && pnpm typecheck`, y commit:

```bash
git add -A src
git commit -m "feat(contrato): el POS habla 4.6.0 (#178)"
```

---

### Tarea 2: mensajes claros para el 429 y el 503 de `POST /demo-sessions`

**Archivos:**
- Modificar: `src/domain/result.ts` (bloque `// sync/demo-session.ts`), `src/sync/demo-session.ts`,
  `src/ui/errors.ts`
- Tests: `src/sync/demo-session.test.ts`, `src/ui/errors.test.ts`, `src/ui/onboarding.test.ts`

**Interfaces:**
- Produce `ErrorMeta['demo/rate-limited'] = { retryAfterSeconds?: number }`,
  `ErrorMeta['demo/capacity'] = undefined`, y `parseRetryAfter(value: string | null): number | undefined`
  exportada de `sync/demo-session.ts`.
- Reusa `sync/backend-maintenance` (`{ message?: string }`).

- [ ] **Paso 1: tests de `requestDemoSession` que fallan.** En `demo-session.test.ts`, el helper
  pasa a aceptar headers:

```ts
function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status text',
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
  } as Response;
}
```

y, dentro del `describe`:

```ts
  it('429 → demo/rate-limited con los segundos de Retry-After (4.6.0)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: 'rate-limited' }, 429, { 'Retry-After': '600' }),
        ),
    );
    expect(await requestDemoSession('https://b.x')).toEqual(
      err('demo/rate-limited', { retryAfterSeconds: 600 }),
    );
  });

  it('429 sin Retry-After, o con una fecha HTTP → demo/rate-limited sin segundos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(undefined, 429)));
    expect(await requestDemoSession('https://b.x')).toEqual(err('demo/rate-limited', {}));

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(undefined, 429, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }),
        ),
    );
    expect(await requestDemoSession('https://b.x')).toEqual(err('demo/rate-limited', {}));
  });

  it('503 demo-capacity → demo/capacity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 'demo-capacity', message: 'lleno' }, 503)),
    );
    expect(await requestDemoSession('https://b.x')).toEqual(err('demo/capacity', undefined));
  });

  it('503 maintenance → sync/backend-maintenance con su mensaje; sin cuerpo, sin mensaje', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: 'maintenance', message: 'Migrando' }, 503, { 'Retry-After': '30' }),
        ),
    );
    expect(await requestDemoSession('https://b.x')).toEqual(
      err('sync/backend-maintenance', { message: 'Migrando' }),
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(undefined, 503)));
    expect(await requestDemoSession('https://b.x')).toEqual(err('sync/backend-maintenance', {}));
  });
```

- [ ] **Paso 2:** `pnpm vitest run src/sync/demo-session.test.ts` → FALLAN (devuelven
  `sync/request-failed`). `pnpm typecheck` también falla por los códigos inexistentes: esperado.
- [ ] **Paso 3: códigos.** En `result.ts`, debajo de `'demo/not-offered': undefined;`:

```ts
  // 4.6.0 (#173): el backend frena pedidos (429) o llegó a su tope de demos (503 demo-capacity)
  'demo/rate-limited': { retryAfterSeconds?: number };
  'demo/capacity': undefined;
```

- [ ] **Paso 4: implementar en `demo-session.ts`.** Agregar el schema y el parser:

```ts
/** Cuerpo de error del contrato (4.6.0): `{ code, message? }`. */
const errorBodySchema = z.object({ code: z.string(), message: z.string().optional() });

/** `Retry-After` en segundos enteros (4.6.0); una fecha HTTP o un valor inválido cuentan como ausente. */
export function parseRetryAfter(value: string | null): number | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}
```

y en `requestDemoSession`, después de `const body = await readJson(response);` y antes del `422`:

```ts
  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers.get('Retry-After'));
    return err('demo/rate-limited', retryAfterSeconds !== undefined ? { retryAfterSeconds } : {});
  }
  if (response.status === 503) {
    const errorBody = errorBodySchema.safeParse(body);
    if (errorBody.success && errorBody.data.code === 'demo-capacity') {
      return err('demo/capacity', undefined);
    }
    // Mantenimiento, otro código o sin cuerpo: el backend no puede atender ahora (4.6.0).
    const message = errorBody.success ? errorBody.data.message : undefined;
    return err('sync/backend-maintenance', message !== undefined ? { message } : {});
  }
```

  Actualizar el JSDoc de `requestDemoSession` para nombrar los dos códigos nuevos.
- [ ] **Paso 5:** `pnpm vitest run src/sync/demo-session.test.ts` → PASA.
- [ ] **Paso 6: tests de traducción que fallan.** En `errors.test.ts`:

```ts
  it('demo/rate-limited dice cuándo volver a probar, en minutos (#173)', () => {
    expect(
      describeError({ ok: false, error: 'demo/rate-limited', meta: { retryAfterSeconds: 600 } }),
    ).toBe('se pidieron demasiadas demos desde esta conexión; probá de nuevo en 10 minutos');
    expect(
      describeError({ ok: false, error: 'demo/rate-limited', meta: { retryAfterSeconds: 30 } }),
    ).toBe('se pidieron demasiadas demos desde esta conexión; probá de nuevo en 1 minuto');
    expect(describeError({ ok: false, error: 'demo/rate-limited', meta: {} })).toBe(
      'se pidieron demasiadas demos desde esta conexión; probá de nuevo en unos minutos',
    );
  });

  it('demo/capacity (#173)', () => {
    expect(describeError({ ok: false, error: 'demo/capacity', meta: undefined })).toBe(
      'hay demasiadas demos abiertas en este momento; probá de nuevo en unos minutos',
    );
  });
```

  y en `onboarding.test.ts`, al lado de "backend sin demos (404)":

```ts
  it('backend con el tope de demos (503) → failed con el motivo, sin reintentar', async () => {
    deps.requestDemoSession.mockResolvedValue(err('demo/capacity', undefined));
    const outcome = await runOnboardingFromUrl(
      entry,
      { config: NO_CONFIG, hasUserData: false },
      deps,
    );
    expect(outcome).toEqual({
      kind: 'failed',
      notice:
        'No se pudo iniciar la demo: hay demasiadas demos abiertas en este momento; probá de nuevo en unos minutos.',
    });
    expect(deps.requestDemoSession).toHaveBeenCalledTimes(1);
    expect(deps.applyConnection).not.toHaveBeenCalled();
  });
```

- [ ] **Paso 7:** `pnpm vitest run src/ui/errors.test.ts src/ui/onboarding.test.ts` → FALLAN
  (`typecheck` también: el `switch` de `errors.ts` no es exhaustivo).
- [ ] **Paso 8: implementar en `errors.ts`**, después de `case 'demo/not-offered':`:

```ts
    case 'demo/rate-limited': {
      const seconds = failure.meta.retryAfterSeconds;
      const minutes = seconds === undefined ? undefined : Math.max(1, Math.ceil(seconds / 60));
      const when =
        minutes === undefined
          ? 'en unos minutos'
          : `en ${String(minutes)} ${minutes === 1 ? 'minuto' : 'minutos'}`;
      return `se pidieron demasiadas demos desde esta conexión; probá de nuevo ${when}`;
    }
    case 'demo/capacity':
      return 'hay demasiadas demos abiertas en este momento; probá de nuevo en unos minutos';
```

- [ ] **Paso 9:** `pnpm lint && pnpm typecheck && pnpm test` → PASA. Commit:

```bash
git add src/domain/result.ts src/sync/demo-session.ts src/sync/demo-session.test.ts src/ui/errors.ts src/ui/errors.test.ts src/ui/onboarding.test.ts
git commit -m "feat(demo): mensajes claros para el 429 y el 503 de POST /demo-sessions (#173)"
```

---

### Tarea 3: demo-backend 4.6.0 y el 503 de mantenimiento

**Archivos:**
- Modificar: `demo-backend/src/settings.ts`, `demo-backend/src/http-helpers.ts`,
  `demo-backend/src/router.ts`, `demo-backend/src/routes/sync.ts` (las dos rutas),
  `demo-backend/src/routes/account-holds.ts`, `demo-backend/src/routes/demo-sessions.ts` (la ruta
  `POST /demo-sessions`)
- Crear: `demo-backend/test/routes/maintenance.test.ts`
- Tests: `demo-backend/test/routes/info.test.ts` (versión)

**Interfaces:**
- Produce `sendJson(res, status, body, headers?: Record<string, string>)`,
  `RouteDef.closedInMaintenance?: boolean` y `MAINTENANCE_RETRY_AFTER = '30'` (en `router.ts`).
- `CONTRACT_VERSION = '4.6.0'`.

- [ ] **Paso 1: test que falla.** Crear `maintenance.test.ts` con el mismo arranque que
  `info.test.ts` (`openDb(':memory:')`, `createApp`, `listen(0)`), registrando `infoRoutes`,
  `syncRoutes`, `accountHoldRoutes` y `demoSessionRoutes`, y:

```ts
const AUTH = {
  Authorization: 'Bearer demo-token',
  'Content-Type': 'application/json',
  'X-POS-Contract-Version': '4.6.0',
};

const CLOSED: [string, RequestInit][] = [
  ['/sync/push', { method: 'POST', headers: { ...AUTH, 'Idempotency-Key': 'l1' }, body: '{"deviceId":"d1","events":[]}' }],
  ['/sync/pull', { method: 'POST', headers: AUTH, body: '{"deviceId":"d1"}' }],
  ['/account-holds', { method: 'POST', headers: AUTH, body: '{"customerId":"c1","amount":1}' }],
  ['/demo-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
];

describe('mantenimiento: 503 con Retry-After (4.6.0, #178)', () => {
  it.each(CLOSED)('%s responde 503 maintenance con el mensaje y Retry-After: 30', async (path, init) => {
    setDemoSettings(db, { maintenance: { enabled: true, message: 'Migrando' } });

    const response = await fetch(`${baseUrl}${path}`, init);

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
    expect(await response.json()).toEqual({ code: 'maintenance', message: 'Migrando' });
  });

  it('sin mensaje, el cuerpo es solo el código', async () => {
    setDemoSettings(db, { maintenance: { enabled: true, message: '' } });
    const [path, init] = CLOSED[0]!;
    const response = await fetch(`${baseUrl}${path}`, init);
    expect(await response.json()).toEqual({ code: 'maintenance' });
  });

  it('/info sigue respondiendo 200 con status maintenance', async () => {
    setDemoSettings(db, { maintenance: { enabled: true, message: 'Migrando' } });
    const response = await fetch(`${baseUrl}/info`, { headers: AUTH });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'maintenance', message: 'Migrando' });
  });
});
```

  (Si `CLOSED[0]!` choca con la regla de lint de non-null, desestructurar con un chequeo explícito.)
- [ ] **Paso 2:** `pnpm test:backend` → FALLAN (200 en vez de 503).
- [ ] **Paso 3: `http-helpers.ts`.**

```ts
export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(payload);
}
```

- [ ] **Paso 4: `router.ts`.** En `RouteDef`, después de `checksContract`:

```ts
  /**
   * Cerrada con el modo mantenimiento prendido (4.6.0, #178): responde
   * `503 { code: 'maintenance', message? }` con `Retry-After` sin procesar nada. `/info` nunca
   * cierra: es cómo el POS se entera.
   */
  closedInMaintenance?: boolean;
```

  Constante y CORS (el POS corre en otro origen: sin exponerlo, `fetch` no ve el `Retry-After`):

```ts
/** Segundos del `Retry-After` en mantenimiento (4.6.0), como mini. */
export const MAINTENANCE_RETRY_AFTER = '30';
```

  y en `CORS_HEADERS`: `'Access-Control-Expose-Headers': 'Retry-After',` (sumar al comentario que
  `Retry-After` no es un header de respuesta que el navegador deje leer sin exponerlo). En
  `handleRequest`, después del bloque de `checksContract`:

```ts
    if (route.closedInMaintenance === true) {
      const { maintenance } = getDemoSettings(db);
      if (maintenance.enabled) {
        sendJson(
          res,
          503,
          {
            code: 'maintenance',
            ...(maintenance.message !== '' ? { message: maintenance.message } : {}),
          },
          { 'Retry-After': MAINTENANCE_RETRY_AFTER },
        );
        return;
      }
    }
```

  (importar `getDemoSettings` de `./settings.ts`).
- [ ] **Paso 5:** `closedInMaintenance: true` en `POST /sync/push`, `POST /sync/pull`,
  `POST /account-holds` y `POST /demo-sessions`.
- [ ] **Paso 6: versión.** `settings.ts`: `CONTRACT_VERSION = '4.6.0'`, sumando al JSDoc
  "4.6.0 desde #178: capacidad `portal` y el 503 de mantenimiento". En `info.test.ts`, los
  `'4.5.0'` que esperan la versión del demo-backend pasan a `'4.6.0'` (y el título del `it`).
- [ ] **Paso 7:** `pnpm test:backend && pnpm typecheck:backend && pnpm lint` → PASA.
  Commit:

```bash
git add demo-backend
git commit -m "feat(demo-backend): contrato 4.6.0 y 503 con Retry-After en mantenimiento (#178)"
```

---

### Tarea 4: demo-backend — simular el 429 y el 503 de `/demo-sessions`

**Archivos:**
- Modificar: `demo-backend/src/settings.ts`, `demo-backend/src/routes/panel.ts` (PUT de
  settings), `demo-backend/src/routes/demo-sessions.ts`, `demo-backend/src/panel.html`
- Tests: `demo-backend/test/routes/demo-sessions.test.ts`, `demo-backend/test/routes/panel.test.ts`

**Interfaces:** produce `type DemoSessionsMode = 'normal' | 'rate-limited' | 'capacity'` y
`DemoSettings.demoSessions: DemoSessionsMode`.

- [ ] **Paso 1: tests que fallan.** En `demo-sessions.test.ts`:

```ts
describe('POST /demo-sessions simulando límites (4.6.0, #173)', () => {
  it('rate-limited → 429 con Retry-After: 600, sin crear la demo', async () => {
    setDemoSettings(db, { demoSessions: 'rate-limited' });
    const response = await createDemo({});
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('600');
    expect(await response.json()).toMatchObject({ code: 'rate-limited' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM demo_keys').get()).toEqual({ n: 0 });
  });

  it('capacity → 503 demo-capacity', async () => {
    setDemoSettings(db, { demoSessions: 'capacity' });
    const response = await createDemo({});
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'demo-capacity' });
  });
});
```

  En `panel.test.ts`, el `toEqual` de "los ajustes de mantenimiento y contrato…" suma un `PUT` con
  `{ demoSessions: 'capacity' }` y espera `demoSessions: 'capacity'` en el resultado.
- [ ] **Paso 2:** tests → FALLAN (201 y falta la propiedad).
- [ ] **Paso 3: `settings.ts`.**

```ts
/** Cómo responde `POST /demo-sessions` (4.6.0, #173): para ver los mensajes del POS sin un límite real. */
export type DemoSessionsMode = 'normal' | 'rate-limited' | 'capacity';
const DEMO_SESSIONS_MODES: readonly DemoSessionsMode[] = ['normal', 'rate-limited', 'capacity'];
```

  `DemoSettings` suma `demoSessions: DemoSessionsMode;`. En `getDemoSettings`:

```ts
  const demoSessions = readSetting(db, 'demoSessions');
  // ...
    demoSessions: DEMO_SESSIONS_MODES.find((mode) => mode === demoSessions) ?? 'normal',
```

  y en `setDemoSettings`:

```ts
  if (partial.demoSessions !== undefined) {
    writeSetting(db, 'demoSessions', partial.demoSessions);
  }
```

- [ ] **Paso 4: `panel.ts`.** En el `PUT /_demo/api/settings`, sumar
  `...(body?.demoSessions !== undefined ? { demoSessions: body.demoSessions } : {}),`.
- [ ] **Paso 5: `demo-sessions.ts`.** Al principio del handler de `POST /demo-sessions` (importar
  `getDemoSettings`):

```ts
      // 4.6.0 (#173): límites simulados desde el panel; un backend público los tendría de verdad.
      const { demoSessions } = getDemoSettings(ctx.db);
      if (demoSessions === 'rate-limited') {
        sendJson(
          res,
          429,
          { code: 'rate-limited', message: 'Demasiadas demos pedidas desde esta conexión' },
          { 'Retry-After': '600' },
        );
        return;
      }
      if (demoSessions === 'capacity') {
        sendJson(res, 503, { code: 'demo-capacity', message: 'No hay lugar para más demos' });
        return;
      }
```

- [ ] **Paso 6: `panel.html`.** Debajo de los botones de arriba (`revoke-status`):

```html
    <p>
      <label>POST /demo-sessions responde
        <select id="demo-sessions-mode">
          <option value="normal">normal (201)</option>
          <option value="rate-limited">429 rate-limited (Retry-After: 600)</option>
          <option value="capacity">503 demo-capacity</option>
        </select>
      </label>
    </p>
```

  y en el script, junto a los otros controles:

```js
      const demoSessionsMode = document.getElementById('demo-sessions-mode');
      demoSessionsMode.addEventListener('change', () => post('/_demo/api/settings', { demoSessions: demoSessionsMode.value }, 'PUT'));
```

  y en `refresh()`: `if (document.activeElement !== demoSessionsMode) demoSessionsMode.value = settings.demoSessions;`
- [ ] **Paso 7:** `pnpm test:backend && pnpm typecheck:backend && pnpm lint` → PASA. Commit:

```bash
git add demo-backend
git commit -m "feat(demo-backend): el panel simula el 429 y el 503 demo-capacity de /demo-sessions (#173)"
```

---

### Tarea 5: demo-backend — la capacidad `portal`

**Archivos:**
- Crear: `demo-backend/src/portal-links.ts`, `demo-backend/src/routes/portal.ts`,
  `demo-backend/test/portal-links.test.ts`, `demo-backend/test/routes/portal.test.ts`
- Modificar: `demo-backend/src/db.ts` (tabla y `SCHEMA_VERSION`), `demo-backend/src/settings.ts`
  (`CAPABILITIES`, `PORTAL`), `demo-backend/src/routes/info.ts` (`portal`, exportar `companyFor`),
  `demo-backend/src/http-helpers.ts` (mover `requestOrigin` y `escapeHtml`),
  `demo-backend/src/routes/demo-sessions.ts` (usarlos de `http-helpers`, exportar `DEMO_TERMINAL`),
  `demo-backend/src/server.ts`
- Tests: `demo-backend/test/routes/info.test.ts`

**Interfaces:**
- `PORTAL_LINK_TTL_MS = 60_000`;
  `issuePortalLink(db: DatabaseSync, apiKey: string, now: Date): { token: string; expiresAt: string }`;
  `redeemPortalLink(db: DatabaseSync, token: string, now: Date): string | undefined` (la key, o
  `undefined` si no existe, ya se usó o venció; al canjear la marca usada).
- `PORTAL = { command: 'PANEL', label: 'Panel del backend' }`; `CAPABILITIES` suma `'portal'`.
- `companyFor(db: DatabaseSync, key: string | undefined): { name: string } | undefined` (hoy
  recibe `ctx`; pasa a recibir `db` y la key para usarla también en el canje).

- [ ] **Paso 1: tests del módulo que fallan.** `portal-links.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { issuePortalLink, PORTAL_LINK_TTL_MS, redeemPortalLink } from '../src/portal-links.ts';

const NOW = new Date('2026-10-04T12:00:00.000Z');

describe('links del portal (4.6.0, #178)', () => {
  it('emite un token que vence a los 60 s y se canjea una sola vez', () => {
    const db = openDb(':memory:');
    const { token, expiresAt } = issuePortalLink(db, 'k1', NOW);

    expect(expiresAt).toBe(new Date(NOW.getTime() + PORTAL_LINK_TTL_MS).toISOString());
    expect(token).not.toContain('k1');
    expect(redeemPortalLink(db, token, NOW)).toBe('k1');
    expect(redeemPortalLink(db, token, NOW)).toBeUndefined();
  });

  it('vencido o inexistente no se canjea', () => {
    const db = openDb(':memory:');
    const { token } = issuePortalLink(db, 'k1', NOW);
    expect(redeemPortalLink(db, token, new Date(NOW.getTime() + PORTAL_LINK_TTL_MS))).toBeUndefined();
    expect(redeemPortalLink(db, 'nope', NOW)).toBeUndefined();
  });
});
```

- [ ] **Paso 2:** → FALLA (no existe el módulo).
- [ ] **Paso 3: tabla.** En `db.ts`, al final de `SCHEMA`:

```sql
CREATE TABLE IF NOT EXISTS portal_links (
  token TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
```

  `SCHEMA_VERSION = 6`, y en el JSDoc: "`portal_links` (los links de un solo uso de
  `POST /portal-links`, 4.6.0 — #178, que `resetToSeed` no borra — `portal-links.ts`)".
- [ ] **Paso 4: `portal-links.ts`.**

```ts
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Vencimiento del link del portal (4.6.0, #178): el que recomienda el contrato y usa mini. */
export const PORTAL_LINK_TTL_MS = 60_000;

/**
 * Emite un link de un solo uso para la key que lo pide (4.6.0, #178). El token es aleatorio y
 * opaco: la key nunca viaja en la URL.
 */
export function issuePortalLink(
  db: DatabaseSync,
  apiKey: string,
  now: Date,
): { token: string; expiresAt: string } {
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(now.getTime() + PORTAL_LINK_TTL_MS).toISOString();
  db.prepare(
    'INSERT INTO portal_links (token, api_key, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(token, apiKey, now.toISOString(), expiresAt);
  return { token, expiresAt };
}

/** Canjea el link: la key que lo pidió, o `undefined` si no existe, ya se usó o venció. */
export function redeemPortalLink(db: DatabaseSync, token: string, now: Date): string | undefined {
  const nowIso = now.toISOString();
  const row = db
    .prepare(
      'SELECT api_key AS apiKey FROM portal_links WHERE token = ? AND used_at IS NULL AND expires_at > ?',
    )
    .get(token, nowIso) as { apiKey: string } | undefined;
  if (row === undefined) {
    return undefined;
  }
  db.prepare('UPDATE portal_links SET used_at = ? WHERE token = ?').run(nowIso, token);
  return row.apiKey;
}
```

- [ ] **Paso 5:** `portal-links.test.ts` → PASA.
- [ ] **Paso 6: tests de las rutas que fallan.** `routes/portal.test.ts` (arranque como
  `demo-sessions.test.ts`, con `seedIfEmpty`; registra `infoRoutes` y `portalRoutes`):

```ts
const AUTH = { Authorization: 'Bearer demo-api-key', 'X-POS-Contract-Version': '4.6.0' };

async function requestLink(headers: Record<string, string> = AUTH): Promise<Response> {
  return fetch(`${baseUrl}/portal-links`, { method: 'POST', headers });
}

describe('POST /portal-links y el canje (4.6.0, #178)', () => {
  it('sin Authorization → 401', async () => {
    expect((await requestLink({})).status).toBe(401);
  });

  it('devuelve un link de un solo uso a la página del canje, sin la key', async () => {
    const response = await requestLink();
    expect(response.status).toBe(201);
    const { url, expiresAt } = (await response.json()) as { url: string; expiresAt: string };
    expect(url).toMatch(new RegExp(`^${baseUrl}/_demo/portal/[A-Za-z0-9_-]+$`));
    expect(url).not.toContain('demo-api-key');
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(50_000);

    const first = await fetch(url);
    expect(first.status).toBe(200);
    const page = await first.text();
    expect(page).toContain('Caja 1');
    expect(page).toContain('CENTRAL');
    expect(page).toContain('del comercio');

    const second = await fetch(url);
    expect(second.status).toBe(410);
    expect(await second.text()).toContain('El link ya se usó o venció');
  });

  it('con la key de una demo, la página lo dice', async () => {
    const key = issueDemoKey(db, new Date().toISOString());
    const response = await requestLink({ ...AUTH, Authorization: `Bearer ${key}` });
    const { url } = (await response.json()) as { url: string };
    expect(await (await fetch(url)).text()).toContain('de una demo');
  });

  it('un link vencido da 410', async () => {
    const { token } = issuePortalLink(db, 'demo-api-key', new Date(Date.now() - 61_000));
    expect((await fetch(`${baseUrl}/_demo/portal/${token}`)).status).toBe(410);
  });

  it('una key revocada: 401 al pedir, y 410 al canjear un link emitido antes', async () => {
    const key = issueDemoKey(db, new Date().toISOString());
    const { url } = (await (
      await requestLink({ ...AUTH, Authorization: `Bearer ${key}` })
    ).json()) as { url: string };
    revokeDemoKeys(db, new Date().toISOString());

    expect((await requestLink({ ...AUTH, Authorization: `Bearer ${key}` })).status).toBe(401);
    expect((await fetch(url)).status).toBe(410);
  });

  it('en mantenimiento → 503', async () => {
    setDemoSettings(db, { maintenance: { enabled: true, message: '' } });
    expect((await requestLink()).status).toBe(503);
  });
});
```

  En `info.test.ts`, el `toEqual` de `/info` espera
  `capabilities: ['demo-sessions', 'customer-payment-void', 'portal']` y
  `portal: { command: 'PANEL', label: 'Panel del backend' }`.
- [ ] **Paso 7:** → FALLAN.
- [ ] **Paso 8: helpers compartidos.** Mover `requestOrigin` y `escapeHtml` de
  `routes/demo-sessions.ts` a `http-helpers.ts` (exportadas, mismo código) e importarlas desde ahí.
  Exportar `DEMO_TERMINAL` de `demo-sessions.ts`.
- [ ] **Paso 9: `settings.ts` e `info.ts`.**

```ts
/** Lo opcional del contrato que implementa (4.4.0, #128; `portal` desde 4.6.0, #178): lo informa `GET /info`. */
export const CAPABILITIES = ['demo-sessions', 'customer-payment-void', 'portal'];
/** El comando y el botón que el POS inyecta con la capacidad `portal` (4.6.0, #178). */
export const PORTAL = { command: 'PANEL', label: 'Panel del backend' };
```

  En `info.ts`, `companyFor` pasa a `export function companyFor(db: DatabaseSync, key: string | undefined)`
  (mismo cuerpo, `ctx.db` → `db`, `ctx.token` → `key`); el handler la llama con
  `companyFor(ctx.db, ctx.token)` y suma `portal: PORTAL,` después de `capabilities`. JSDoc:
  "4.6.0 (#178): también el portal".
- [ ] **Paso 10: `routes/portal.ts`.**

```ts
import { isDemoKey, isRevokedKey } from '../demo-keys.ts';
import { escapeHtml, requestOrigin, sendJson } from '../http-helpers.ts';
import { issuePortalLink, redeemPortalLink } from '../portal-links.ts';
import type { RouteDef } from '../router.ts';
import { DEMO_TERMINAL } from './demo-sessions.ts';
import { companyFor } from './info.ts';

function page(status: number, content: string): { status: number; html: string } {
  return {
    status,
    html: `<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>Portal del minibackend</title></head><body><h1>Portal del minibackend</h1>${content}</body></html>`,
  };
}

/**
 * El canje (4.6.0, #178): el minibackend no tiene sesiones (su panel no tiene login), así que
 * muestra con qué caja se entró. La sesión real limitada a la caja es de mini.
 */
function renderRedeem(db: Parameters<typeof redeemPortalLink>[0], token: string): { status: number; html: string } {
  const apiKey = redeemPortalLink(db, token, new Date());
  if (apiKey === undefined || isRevokedKey(db, apiKey)) {
    return page(410, '<p>El link ya se usó o venció. Pedí otro desde el POS.</p>');
  }
  const company = companyFor(db, apiKey);
  const origin = isDemoKey(db, apiKey) ? 'de una demo' : 'del comercio';
  return page(
    200,
    `<p>Entraste con la caja ${escapeHtml(DEMO_TERMINAL.pointOfSale)} de ${escapeHtml(DEMO_TERMINAL.branch)}` +
      `${company !== undefined ? ` (${escapeHtml(company.name)})` : ''}, ${origin}.</p>` +
      '<p><a href="/_demo">Ir al panel</a></p>',
  );
}

export const portalRoutes: RouteDef[] = [
  {
    // `POST /portal-links` (4.6.0, #178): un link de un solo uso para la key que lo pide.
    method: 'POST',
    pattern: /^\/portal-links$/,
    requiresAuth: true,
    checksContract: true,
    closedInMaintenance: true,
    handler: (req, res, ctx) => {
      const { token, expiresAt } = issuePortalLink(ctx.db, ctx.token ?? '', new Date());
      sendJson(res, 201, { url: `${requestOrigin(req)}/_demo/portal/${token}`, expiresAt });
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/portal\/(?<token>[^/]+)$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      const { status, html } = renderRedeem(ctx.db, ctx.params.token ?? '');
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    },
  },
];
```

  (Si el tipo `Parameters<typeof redeemPortalLink>[0]` resulta incómodo, importar
  `type DatabaseSync` de `node:sqlite`.)
- [ ] **Paso 11:** `server.ts`: `registerRoutes(portalRoutes);` después de `demoSessionRoutes`.
- [ ] **Paso 12:** `pnpm test:backend && pnpm typecheck:backend && pnpm lint` → PASA. Commit:

```bash
git add demo-backend
git commit -m "feat(demo-backend): capacidad portal con links de un solo uso (#178)"
```

---

### Tarea 6: el OpenAPI 4.6.0

**Archivos:** modificar `docs/connector-api.openapi.yaml`. Test que lo vigila:
`site/docs.test.ts` (sin referencias internas: nada de `#178`, specs ni `AGENTS.md`).

- [ ] **Paso 1: encabezado.** `info.version: '4.6.0'` y, antes de "**4.5.0 respecto de 4.4.0**":

```yaml
    **4.6.0 respecto de 4.5.0** (aditivo):
      - Capacidad `portal`: el POS abre el backend en una pestaña nueva con
        un comando que nombra el backend. `GET /info` la declara en
        `capabilities` junto con `portal: { command, label }`, y
        `POST /portal-links` devuelve la URL que el POS abre. Ver
        "Portal" más abajo.
      - Cuerpo de error común `ErrorBody` (`{ code, message? }`) y el header
        `Retry-After`.
      - `503` de mantenimiento (`code: maintenance`) en `/sync/push`,
        `/sync/pull`, `/account-holds`, `/demo-sessions` y `/portal-links`.
      - `POST /demo-sessions` documenta `429` (`rate-limited`) y `503`
        (`demo-capacity`).
      - El piso sigue en 4.0.0: un backend 4.5 sigue siendo compatible.
```

  En "Compatibilidad del lado del POS": "el POS habla 4.6.0"; la tabla de capacidades suma la fila
  `| \`portal\` | El POS muestra el comando y el botón que declara \`portal\` y abre el backend con \`POST /portal-links\` | No aparece nada |`
  y su título pasa a "Capacidades (4.4.0 y 4.6.0)".
- [ ] **Paso 2: sección "Portal (4.6.0)"** en la descripción general, después de "Vuelta del
  onboarding":

```yaml
    **Portal (4.6.0)**: con la capacidad `portal`, el POS suma el comando
    `/<portal.command>` y un botón `<portal.label> (/<portal.command>)`.
    Al usarlos pide `POST /portal-links` con su API key y abre la `url` de
    la respuesta en una pestaña nueva, sin guardarla. **El backend decide
    qué URL devuelve según la credencial**, en cada pedido: un link con
    autorización (de un solo uso o de varios) que abre una sesión acotada a
    esa terminal, o su página de login para que entre un usuario con su
    cuenta. La sesión y sus permisos los decide el backend; el contrato no
    define roles.

      - La URL **nunca lleva la API key**: si lleva autorización, es un
        token opaco del backend. Se recomienda un solo uso y un vencimiento
        corto (por ejemplo, 60 segundos).
      - El link no viaja en el pull ni se guarda: se pide al usarlo.
      - `command`: mayúsculas, dígitos y `_`, de 2 a 16 caracteres, sin la
        `/`. Si coincide con un comando propio del POS, el POS usa
        `/PORTAL`. Con `portal` en `capabilities` pero sin el objeto, o con
        el objeto mal formado, el POS se comporta como sin la capacidad.
```

- [ ] **Paso 3: `/info`.** En la descripción: "4.6.0: `portal` (con la capacidad del mismo
  nombre) declara el comando y el botón del portal. `/info` nunca responde `503`: en mantenimiento
  responde `200` con `status: maintenance`." En `BackendInfo`, después de `company`:

```yaml
        portal:
          type: object
          required: [command, label]
          description: |
            4.6.0: el comando y el botón del portal; va junto con la capacidad
            `portal`. Ver "Portal" en la descripción general.
          properties:
            command:
              type: string
              pattern: '^[A-Z0-9_]{2,16}$'
              example: MINI
              description: 'Sin la `/`, que agrega el POS.'
            label:
              type: string
              example: Abrir mini
              description: 'Texto del botón; el POS lo muestra como `<label> (/<command>)`.'
```

  y la descripción de `capabilities` nombra `portal` (4.6.0).
- [ ] **Paso 4: `POST /portal-links`**, después de `/demo-sessions`:

```yaml
  /portal-links:
    post:
      operationId: createPortalLink
      summary: La URL para abrir el backend desde el POS (capacidad portal)
      x-pos-status: documented-not-implemented
      description: |
        Opcional (4.6.0): solo lo implementa un backend con la capacidad
        `portal`. Autenticado con la API key de la terminal, sin cuerpo. El
        backend decide qué URL devolver según la credencial (ver "Portal" en
        la descripción general). El POS la abre en una pestaña nueva y no la
        guarda.
      parameters:
        - $ref: '#/components/parameters/ContractVersion'
      responses:
        '201':
          description: La URL a abrir.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PortalLink'
        '401':
          description: |
            API key inválida o revocada. Con la terminal en demo, el POS lo
            toma como "la demo terminó", igual que en el sync.
        '404':
          description: El backend no implementa el portal.
        '409':
          $ref: '#/components/responses/IncompatibleContract'
        '503':
          $ref: '#/components/responses/Maintenance'
```

  Y en `schemas`:

```yaml
    PortalLink:
      type: object
      required: [url]
      properties:
        url:
          type: string
          format: uri
          description: |
            `https:` (o `http:` a localhost). Nunca lleva la API key; si lleva
            autorización, es un token opaco del backend.
        expiresAt:
          type: string
          format: date-time
          description: Cuándo vence el link, si vence. Informativo.

    ErrorBody:
      type: object
      required: [code]
      description: |
        4.6.0: cuerpo de los errores `429` y `503`. El POS decide por `code`
        e ignora un código que no conoce.
      properties:
        code: { type: string, example: maintenance }
        message: { type: string, description: Para mostrar en el POS. }
```

- [ ] **Paso 5: respuestas comunes** en `components`. `headers` nuevo:

```yaml
  headers:
    RetryAfter:
      description: |
        4.6.0: segundos enteros hasta que conviene volver a probar. El
        backend tiene que exponerlo por CORS
        (`Access-Control-Expose-Headers: Retry-After`): sin eso, el POS no
        lo puede leer desde otro origen.
      schema: { type: integer, minimum: 0, example: 30 }
```

  y en `responses`:

```yaml
    Maintenance:
      description: |
        4.6.0: el backend está en mantenimiento y no procesó nada (sin ack:
        un lote sigue en el outbox del POS con su mismo `idempotency_id`).
        El POS consulta `GET /info`, que responde `status: maintenance`, y
        no corre push ni pull hasta que vuelva `ok`; no adelanta nada por el
        `Retry-After`. La venta nunca se bloquea.
      headers:
        Retry-After:
          $ref: '#/components/headers/RetryAfter'
      content:
        application/json:
          schema:
            allOf:
              - $ref: '#/components/schemas/ErrorBody'
              - type: object
                properties:
                  code: { type: string, enum: [maintenance] }
```

- [ ] **Paso 6:** `'503': { $ref: '#/components/responses/Maintenance' }` en `/sync/push`,
  `/sync/pull` y `/account-holds`. En `/demo-sessions`:

```yaml
        '429':
          description: |
            4.6.0: demasiados pedidos (por ejemplo, desde la misma IP). El POS
            muestra cuándo volver a probar según `Retry-After` y no reintenta
            solo.
          headers:
            Retry-After:
              $ref: '#/components/headers/RetryAfter'
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ErrorBody'
                  - type: object
                    properties:
                      code: { type: string, enum: [rate-limited] }
        '503':
          description: |
            4.6.0: `code: demo-capacity` (el backend llegó a su tope de demos
            abiertas) o `code: maintenance` (ver la respuesta `Maintenance`).
            El POS muestra el motivo y no reintenta solo. `Retry-After`
            opcional.
          headers:
            Retry-After:
              $ref: '#/components/headers/RetryAfter'
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ErrorBody'
                  - type: object
                    properties:
                      code: { type: string, enum: [demo-capacity, maintenance] }
```

  y en la descripción de `/demo-sessions`: "Un backend público conviene que limite los pedidos por
  IP (`429`) y la cantidad de demos abiertas (`503 demo-capacity`)."
- [ ] **Paso 7:** `ContractVersion`: ejemplo `'4.6.0'` y "(4.6.0)" en su descripción;
  `BackendInfo.contractVersion` con `example: '4.6.0'`.
- [ ] **Paso 8:** `pnpm test` (incluye `site/docs.test.ts`). El repo no tiene parser de YAML:
  revisar la indentación de cada bloque nuevo contra sus vecinos y, si hay Python con PyYAML,
  `python -c "import yaml,sys; yaml.safe_load(open('docs/connector-api.openapi.yaml', encoding='utf-8'))"`.
  Commit:

```bash
git add docs/connector-api.openapi.yaml
git commit -m "docs(contrato): OpenAPI 4.6.0 con la capacidad portal, 429 y 503 (#178)"
```

---

### Tarea 7: guía para integradores y `llms.txt`

**Archivos:** modificar `docs/integradores/guia.md` y `docs/integradores/llms.txt`.

- [ ] **Paso 1: `guia.md`.**
  - "acompaña a la versión del contrato **4.6.0**".
  - Tabla de operaciones: fila `| \`POST /portal-links\` | Opcional: la URL para abrir el backend desde el POS (capacidad \`portal\`). |`.
  - Después del párrafo de CORS: "Si el backend manda `Retry-After` (en un `429` o un `503`), tiene
    que exponerlo con `Access-Control-Expose-Headers: Retry-After`; si no, el navegador no se lo deja
    leer al POS."
  - Al final de "Cómo entra un comercio", un párrafo **"Proteger las demos"**: un backend público
    que ofrece demos conviene que limite los pedidos por IP (`429` con `Retry-After` y
    `{ "code": "rate-limited" }`) y la cantidad de demos abiertas (`503` con
    `{ "code": "demo-capacity" }`). El POS muestra un mensaje claro y no reintenta solo.
  - Sección nueva **"Mantenimiento"** después de "Implementar el contrato": `GET /info` responde
    `status: maintenance`; los demás endpoints, `503` con `{ "code": "maintenance", "message"? }` y
    `Retry-After`. El POS no pierde nada (sin ack, el lote sigue en la terminal), deja de
    sincronizar y vuelve a consultar `/info` hasta que el backend vuelva; la venta nunca se bloquea.
  - En "Compatibilidad y capacidades", fila `| \`portal\` | El POS muestra un comando y un botón para abrir el backend. |`
    y una sección nueva **"Portal: entrar al backend desde el POS"**: qué se declara en `/info`
    (ejemplo JSON de la spec), que `POST /portal-links` devuelve la URL que el backend decide según
    la credencial (link con autorización de un uso o de varios, o su login), que la key nunca va en
    la URL, la recomendación de un solo uso y 60 s, y que el demo-backend lo implementa con
    `/PANEL`.
- [ ] **Paso 2: `llms.txt`.** "contrato 4.6.0", y en la línea de la guía sumar "portal,
  mantenimiento" a la lista de temas.
- [ ] **Paso 3:** `pnpm test` (`site/` tiene tests de las docs) y `pnpm lint` (prettier sobre
  markdown, si aplica). Commit:

```bash
git add docs/integradores
git commit -m "docs(integradores): portal, mantenimiento y límites de las demos (4.6.0, #178)"
```

---

### Tarea 8: `AGENTS.md`, historia y verificación final

**Archivos:** `src/sync/AGENTS.md`, `AGENTS.md`, `docs/historia.md`.

- [ ] **Paso 1: `src/sync/AGENTS.md`.** Entrada nueva arriba de "Contrato 4.5.0":

```markdown
**Contrato 4.6.0 (#178)** — aditivo (spec `docs/superpowers/specs/2026-10-04-contrato-4-6-portal-design.md`):
- **Capacidad `portal`**: `GET /info` la declara con `portal: { command, label }` y
  `POST /portal-links` devuelve `{ url, expiresAt? }`, la URL que el backend decide según la key (link
  con autorización de un uso o de varios, o su login); la key nunca va en la URL y el link nunca viaja
  en el pull. El POS todavía no la usa: el comando y el botón son de P6 (#179). El demo-backend la
  implementa con `/PANEL` (link de un solo uso, 60 s, `GET /_demo/portal/<token>`).
- **Errores** (`ErrorBody { code, message? }`, `Retry-After`): `503 maintenance` en push, pull, holds,
  demo-sessions y portal-links (el sync ya lo manejaba: no es fallo de red, consulta `/info`); en
  `/demo-sessions`, `429 rate-limited` y `503 demo-capacity`. `sync/demo-session.ts` los traduce a
  `demo/rate-limited` (con los segundos de `Retry-After`, solo enteros), `demo/capacity` y
  `sync/backend-maintenance`, sin reintentar. El demo-backend los simula desde el panel. Que
  `/account-holds` con 503 caiga a la evaluación offline sigue en #187.
```

  Y en "Onboarding de demo", la fila de `sync/demo-session.ts` suma "`demo/rate-limited` y
  `demo/capacity` (4.6.0)".
- [ ] **Paso 2: `AGENTS.md` raíz.** "Connector API": "**versión 4.6.0** desde #178 (capacidad
  `portal`, 429 y 503, spec `…2026-10-04-contrato-4-6-portal-design.md`); la 4.5.0 es de #193 …".
  En la descripción del puerto, que `POST /portal-links` (4.6.0) tampoco pasa por el puerto todavía
  (lo usará P6). Tabla "Estado del proyecto": fila `| #178 + #173 | Contrato 4.6.0: capacidad portal (demo-backend con /PANEL), 429 y 503 de mantenimiento y de demos | PR #N |`
  (el número se completa al abrir el PR). "Siguiente": P5 hecho, sigue P6 (#179). "Issues
  abiertas": sacar #173 y #178.
- [ ] **Paso 3: `docs/historia.md`.** Un párrafo como el de #193: qué trajo la etapa y las
  decisiones (un solo endpoint y la URL la decide el backend; nunca en el pull; `Retry-After`
  expuesto por CORS; el POS no reintenta).
- [ ] **Paso 4: verificación completa.**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:backend && pnpm typecheck:backend && pnpm build && pnpm test:e2e
```

  Todo PASA (si un e2e conocido como flaky falla, #155/#169, reintentarlo una vez y decirlo en el
  informe).
- [ ] **Paso 5:** commit:

```bash
git add AGENTS.md src/sync/AGENTS.md docs/historia.md
git commit -m "docs: contrato 4.6.0 en AGENTS.md y en la historia (#178)"
```

- [ ] **Paso 6: informe final con prueba manual** (para el usuario): levantar `pnpm backend` y el
  POS (`pnpm build && pnpm preview`), y en el panel `/_demo`:
  1. `POST /demo-sessions` en "429": abrir `http://localhost:4173/?demo=true&backend=http://localhost:4000`
     en una ventana limpia → "No se pudo iniciar la demo: se pidieron demasiadas demos desde esta
     conexión; probá de nuevo en 10 minutos."
  2. En "503 demo-capacity" → "…hay demasiadas demos abiertas en este momento; probá de nuevo en
     unos minutos."
  3. En "normal" con mantenimiento prendido → "…El backend está en mantenimiento…".
  4. Todo normal → la demo abre; con mantenimiento prendido, la barra de estado pasa a
     mantenimiento y nada se pierde.
  5. Portal sin UI: `curl -X POST -H "Authorization: Bearer demo-api-key" http://localhost:4000/portal-links`
     → abrir la `url` en el navegador (muestra la caja), recargarla (410), y una pedida hace más de
     60 s (410).
- [ ] **Paso 7: al cerrar la etapa** (después de la revisión del usuario y sus cambios): borrar
  este plan en el PR; abrir el PR con "Closes #178" y "Closes #173"; comentar en #187 que su punto 2
  se resolvió; abrir en rauldiazsolis/mini-erp el issue de aviso del cambio de contrato (capacidad
  `portal` con `POST /portal-links`, `ErrorBody`, 429 y 503, `Access-Control-Expose-Headers:
  Retry-After`, versión 4.6.0; qué tiene que hacer mini en M10).
