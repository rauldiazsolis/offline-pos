# El portal en el POS — plan de implementación

> **Para agentes:** se ejecuta **inline** con `superpowers:executing-plans`, tarea por tarea con
> checkpoints (convención del repo: nada de un subagente por tarea). Los pasos usan `- [ ]`.

**Objetivo:** si el backend declara la capacidad `portal` (4.6.0), el POS suma un comando
`/<command>` y un botón `<label> (/<command>)` que piden `POST /portal-links` y abren la URL en una
pestaña nueva.

**Arquitectura:** `portal` se lee en `backendInfoSchema` y se guarda como la empresa
(`sync/backend-portal.ts`, `localStorage` por carpeta + signal). El pedido vive fuera del puerto
`Connector` (`sync/portal-link.ts`, como `demo-session.ts`). Un controller de UI
(`ui/keyboard/portal-controller.ts`) abre la pestaña en el gesto, pide el link y la carga o la cierra
con el error en la barra.

**Stack:** Preact + `@preact/signals`, Zod, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-portal-en-el-pos-design.md`.

## Restricciones globales

- `command`: `^[A-Z0-9_]{2,16}$`; si choca con un nombre del POS, `PORTAL`.
- Vale solo con `"portal"` en `capabilities` **y** el objeto `portal` bien formado.
- Visible siempre que haya oferta, salvo con la demo revocada.
- La URL: `isAllowedBackendUrl` (`https:`, o `http:` a localhost). Nunca se guarda ni se loguea.
- Error en la barra: `No se pudo abrir <label>: <motivo>.` (con punto final, como la demo).
- Bloqueador: `El navegador bloqueó la pestaña nueva: permití las ventanas emergentes para este sitio.`
- Sin `any`; `unknown` solo en el borde y validado con Zod en la línea siguiente; `try/catch` solo
  en adaptadores. Todo en español (código de tests, comentarios y commits).
- Verificación local por tarea: `pnpm lint && pnpm typecheck && pnpm test`; al final además
  `pnpm build` y `pnpm test:e2e`.
- Commits que terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Archivos

| Archivo | Qué |
|---|---|
| `src/sync/connector.ts` | `portal` en `backendInfoSchema`, `BackendInfo` y `toBackendInfo` |
| `src/sync/pull-snapshot.ts`, `src/sync/connection.ts` | `ProbeSnapshot.portal` desde la `/info` de la prueba |
| `src/sync/backend-portal.ts` (nuevo) | guardar/restaurar + `portalOffer` (puro) |
| `src/ui/state/sync.ts` | `backendPortalSignal` |
| `src/sync/apply-connection.ts`, `src/sync/backend-status.ts`, `src/ui/bootstrap.ts` | escribirlo y restaurarlo |
| `src/sync/http-body.ts` (nuevo) | `errorBodySchema` y `readJson`, sacados de `demo-session.ts` |
| `src/connectors/rest/rest-fetch-connector.ts` | exportar `buildHeaders` y `failedResponse` |
| `src/sync/portal-link.ts` (nuevo) | `requestPortalLink` |
| `src/domain/result.ts`, `src/ui/errors.ts` | `portal/not-offered` |
| `src/ui/keyboard/portal-controller.ts` (nuevo) | `openPortal` |
| `src/ui/keyboard/commands.ts`, `src/ui/keyboard/command-bar-controller.ts` | el comando |
| `src/ui/components/TerminalHeader.tsx` | el botón |
| `src/ui/screens/diagnostico-screen.tsx` | la línea "Portal" |
| `e2e/demo-onboarding.spec.ts` | el e2e (en este archivo porque va en serie contra el `4001`) |
| `AGENTS.md`, `src/sync/AGENTS.md`, `src/ui/AGENTS.md` | docs |

Desvío menor respecto de la spec: `portalOffer` recibe los nombres reservados como tercer parámetro
(`sync/` no puede importar la lista de `ui/keyboard/commands.ts`).

---

### Tarea 1: `portal` en `GET /info` y en la prueba de conexión

**Archivos:** `src/sync/connector.ts`, `src/sync/pull-snapshot.ts`, `src/sync/connection.ts`;
tests en `src/sync/connector.test.ts` y `src/sync/connection.test.ts`.

**Produce:** `BackendPortal = { command: string; label: string }` (exportado de `connector.ts`),
`BackendInfo.portal?: BackendPortal`, `ProbeSnapshot.portal?: BackendPortal`.

- [ ] **Paso 1: tests que fallan** en `connector.test.ts`, al lado del de `company`:

```ts
it('portal opcional (4.6.0): se conserva; mal formado, ausente', () => {
  const base = { contractVersion: '4.6.0', status: 'ok' };
  const withPortal = backendInfoSchema.parse({
    ...base,
    portal: { command: 'PANEL', label: 'Panel del backend' },
  });
  expect(toBackendInfo(withPortal).portal).toEqual({ command: 'PANEL', label: 'Panel del backend' });
  for (const portal of [
    { command: 'panel', label: 'x' },
    { command: '/PANEL', label: 'x' },
    { command: 'P', label: 'x' },
    { command: 'A'.repeat(17), label: 'x' },
    { command: 'PANEL', label: '  ' },
    'PANEL',
  ]) {
    expect(toBackendInfo(backendInfoSchema.parse({ ...base, portal }))).not.toHaveProperty('portal');
  }
});
```

  y en `connection.test.ts`, en el caso que ya verifica `company` en la foto de la prueba, sumar
  `portal: { command: 'PANEL', label: 'Panel' }` a la `/info` falsa y esperarlo en el snapshot.

- [ ] **Paso 2:** `pnpm vitest run src/sync/connector.test.ts src/sync/connection.test.ts` → falla.
- [ ] **Paso 3: implementación.** En `connector.ts`:

```ts
/** El comando y el botón del portal (4.6.0): `command` sin la "/", que agrega el POS. */
export const backendPortalSchema = z.object({
  command: z.string().regex(/^[A-Z0-9_]{2,16}$/),
  label: z.string().trim().min(1),
});
export type BackendPortal = z.infer<typeof backendPortalSchema>;
```

  en `backendInfoSchema`: `portal: backendPortalSchema.optional().catch(undefined),`; en
  `BackendInfo`: `portal?: BackendPortal;`; en `toBackendInfo`:
  `...(data.portal !== undefined ? { portal: data.portal } : {}),`. Actualizar el comentario del
  schema con "4.6.0 (#179): `portal`; mal formado cuenta como ausente". En `pull-snapshot.ts`, el
  campo `portal?: BackendPortal` con su comentario; en `connection.ts::checkThenPull`, al lado de
  `company`: `...(info.value.portal !== undefined ? { portal: info.value.portal } : {}),`.
- [ ] **Paso 4:** los mismos tests pasan; `pnpm typecheck`.
- [ ] **Paso 5: commit** `feat(sync): leer portal de GET /info y de la prueba de conexión (#179)`.

### Tarea 2: guardar el portal y decidir la oferta

**Archivos:** crear `src/sync/backend-portal.ts` y `src/sync/backend-portal.test.ts`; modificar
`src/ui/state/sync.ts`, `src/sync/apply-connection.ts`, `src/sync/backend-status.ts`,
`src/ui/bootstrap.ts`; tests en `apply-connection.test.ts` y `backend-status.test.ts`.

**Consume:** `BackendPortal` (Tarea 1). **Produce:** `backendPortalSignal`,
`saveBackendPortal(portal: BackendPortal | undefined): void`, `restoreBackendPortal(): void`,
`CAPABILITY_PORTAL = 'portal'` (en `backend-capabilities.ts`), `PORTAL_FALLBACK_COMMAND = 'PORTAL'`,
`portalOffer(capabilities: readonly string[] | undefined, portal: BackendPortal | undefined, reserved: ReadonlySet<string>): BackendPortal | null`.

- [ ] **Paso 1: tests que fallan** (`backend-portal.test.ts`):

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { backendPortalSignal } from '../ui/state/sync.ts';
import { portalOffer, restoreBackendPortal, saveBackendPortal } from './backend-portal.ts';

const panel = { command: 'PANEL', label: 'Panel del backend' };
const reserved = new Set(['COBRAR', 'CAJA']);

beforeEach(() => {
  localStorage.clear();
  backendPortalSignal.value = undefined;
});

describe('portal del backend (4.6.0, #179)', () => {
  it('se guarda, se restaura al arrancar y se borra con undefined', () => {
    saveBackendPortal(panel);
    backendPortalSignal.value = undefined;
    restoreBackendPortal();
    expect(backendPortalSignal.value).toEqual(panel);

    saveBackendPortal(undefined);
    expect(localStorage.getItem('offline-pos:backend-portal')).toBeNull();
    expect(backendPortalSignal.value).toBeUndefined();
  });

  it('un valor guardado inválido es "sin portal"', () => {
    localStorage.setItem('offline-pos:backend-portal', '{"command":"x"}');
    restoreBackendPortal();
    expect(backendPortalSignal.value).toBeUndefined();
  });
});

describe('portalOffer', () => {
  it('necesita la capacidad y el objeto', () => {
    expect(portalOffer(['portal'], panel, reserved)).toEqual(panel);
    expect(portalOffer([], panel, reserved)).toBeNull();
    expect(portalOffer(undefined, panel, reserved)).toBeNull();
    expect(portalOffer(['portal'], undefined, reserved)).toBeNull();
  });

  it('un nombre que choca con uno del POS pasa a PORTAL', () => {
    expect(portalOffer(['portal'], { command: 'CAJA', label: 'Mi panel' }, reserved)).toEqual({
      command: 'PORTAL',
      label: 'Mi panel',
    });
  });
});
```

  En `apply-connection.test.ts`, calcado del de la empresa: "guarda el portal de la prueba; una foto
  sin él lo borra (4.6.0, #179)". En `backend-status.test.ts`, calcado del de `company`: una `/info`
  con `portal` lo guarda y una sin él lo borra.
- [ ] **Paso 2:** `pnpm vitest run src/sync/backend-portal.test.ts src/sync/apply-connection.test.ts src/sync/backend-status.test.ts` → falla.
- [ ] **Paso 3: implementación.** `ui/state/sync.ts`, al lado de `backendCompanySignal`:

```ts
/**
 * Portal del backend según su último `getInfo` exitoso (4.6.0, #179), persistido por
 * `sync/backend-portal.ts`. `undefined` = el backend no lo manda (o nunca se supo).
 */
export const backendPortalSignal = signal<BackendPortal | undefined>(undefined);
```

  (`import type { BackendPortal } from '../../sync/connector.ts';`). En `backend-capabilities.ts`:
  `export const CAPABILITY_PORTAL = 'portal';`. `sync/backend-portal.ts`:

```ts
import { backendPortalSignal } from '../ui/state/sync.ts';
import { storageKey } from '../storage/storage-namespace.ts';
import { CAPABILITY_PORTAL } from './backend-capabilities.ts';
import { backendPortalSchema, type BackendPortal } from './connector.ts';

/**
 * El portal del último `getInfo` exitoso (4.6.0, #179), en `localStorage`: una terminal que arranca
 * sin red muestra el botón igual (al usarlo, el error explica que no hay red). Estado operativo
 * best-effort, como la empresa (`backend-company.ts`).
 */
const STORAGE_KEY = storageKey('backend-portal');

/** El nombre que usa el POS si el del backend choca con uno propio. */
export const PORTAL_FALLBACK_COMMAND = 'PORTAL';

export function restoreBackendPortal(): void {
  let parsedJson: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    parsedJson = raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    parsedJson = null;
  }
  const parsed = backendPortalSchema.safeParse(parsedJson);
  backendPortalSignal.value = parsed.success ? parsed.data : undefined;
}

/** `undefined` borra: el backend no lo mandó, o se aplicó otra conexión sin él. */
export function saveBackendPortal(portal: BackendPortal | undefined): void {
  backendPortalSignal.value = portal;
  try {
    if (portal === undefined) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(portal));
    }
  } catch {
    // Best-effort: el signal ya tiene el valor de esta sesión.
  }
}

/**
 * Qué ofrece el POS (pura): nada sin la capacidad o sin el objeto (las dos, como pide el contrato);
 * un nombre que choca con uno del POS pasa a `/PORTAL`.
 */
export function portalOffer(
  capabilities: readonly string[] | undefined,
  portal: BackendPortal | undefined,
  reserved: ReadonlySet<string>,
): BackendPortal | null {
  if (portal === undefined || capabilities?.includes(CAPABILITY_PORTAL) !== true) {
    return null;
  }
  return reserved.has(portal.command) ? { ...portal, command: PORTAL_FALLBACK_COMMAND } : portal;
}
```

  `apply-connection.ts`, después de `saveBackendCompany`:
  `// 4.6.0 (#179): el portal de esta conexión.` + `saveBackendPortal(params.snapshot.portal);`.
  `backend-status.ts`, después de `saveBackendCompany(result.value.company);`:
  `saveBackendPortal(result.value.portal);`. `bootstrap.ts`: `restoreBackendPortal();` después de
  `restoreBackendCompany();` (y sumarlo al comentario: "4.6.0 (#179): también el portal").
- [ ] **Paso 4:** tests de la tarea pasan; `pnpm lint && pnpm typecheck`.
- [ ] **Paso 5: commit** `feat(sync): guardar el portal del backend y decidir la oferta (#179)`.

### Tarea 3: `POST /portal-links`

**Archivos:** crear `src/sync/http-body.ts`, `src/sync/portal-link.ts`, `src/sync/portal-link.test.ts`;
modificar `src/sync/demo-session.ts`, `src/connectors/rest/rest-fetch-connector.ts`,
`src/domain/result.ts`, `src/ui/errors.ts` (y su test si existe para los `demo/*`).

**Produce:** `PortalLink = { url: string; expiresAt?: string }`,
`requestPortalLink(config: ConnectorConfig): Promise<Result<PortalLink>>`, código
`'portal/not-offered': undefined`.

- [ ] **Paso 1: tests que fallan** (`portal-link.test.ts`), con `vi.stubGlobal('fetch', fetchMock)`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestPortalLink } from './portal-link.ts';

const config = { type: 'rest' as const, baseUrl: 'https://b.x', apiKey: 'k1' };
const fetchMock = vi.fn<typeof fetch>();
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('requestPortalLink (4.6.0, #179)', () => {
  it('201: devuelve la URL; manda la key y la versión, sin cuerpo', async () => {
    fetchMock.mockResolvedValue(
      json(201, { url: 'https://b.x/p/abc', expiresAt: '2026-10-04T12:01:00.000Z' }),
    );
    const result = await requestPortalLink(config);
    expect(result).toEqual({
      ok: true,
      value: { url: 'https://b.x/p/abc', expiresAt: '2026-10-04T12:01:00.000Z' },
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://b.x/portal-links');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer k1');
    expect(new Headers(init?.headers).get('X-POS-Contract-Version')).not.toBeNull();
  });

  it('expiresAt mal formado se ignora', async () => {
    fetchMock.mockResolvedValue(json(201, { url: 'https://b.x/p/abc', expiresAt: 3 }));
    expect(await requestPortalLink(config)).toEqual({ ok: true, value: { url: 'https://b.x/p/abc' } });
  });

  it('una URL http a otro host es inválida', async () => {
    fetchMock.mockResolvedValue(json(201, { url: 'http://otro.x/p/abc' }));
    const result = await requestPortalLink(config);
    expect(result.ok || result.error).toBe('sync/invalid-payload');
  });

  it('401 → sync/request-failed con el status', async () => {
    fetchMock.mockResolvedValue(json(401, {}));
    const result = await requestPortalLink(config);
    expect(result).toMatchObject({ ok: false, error: 'sync/request-failed', meta: { status: 401 } });
  });

  it('404 → portal/not-offered', async () => {
    fetchMock.mockResolvedValue(json(404, {}));
    expect(await requestPortalLink(config)).toMatchObject({ error: 'portal/not-offered' });
  });

  it('409 incompatible → sync/incompatible-contract', async () => {
    fetchMock.mockResolvedValue(json(409, { code: 'incompatible-contract', contractVersion: '5.0.0' }));
    expect(await requestPortalLink(config)).toMatchObject({ error: 'sync/incompatible-contract' });
  });

  it('503 → mantenimiento, con el message si vino', async () => {
    fetchMock.mockResolvedValue(json(503, { code: 'maintenance', message: 'Migrando' }));
    expect(await requestPortalLink(config)).toMatchObject({
      error: 'sync/backend-maintenance',
      meta: { message: 'Migrando' },
    });
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    expect(await requestPortalLink(config)).toMatchObject({
      error: 'sync/backend-maintenance',
      meta: {},
    });
  });

  it('sin red → sync/request-failed sin status', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await requestPortalLink(config);
    expect(result).toMatchObject({ error: 'sync/request-failed', meta: { message: 'Failed to fetch' } });
  });

  it('un conector que no es REST no ofrece el portal', async () => {
    const sheets = { type: 'google-sheets' as const, scriptUrl: 'https://script.google.com/x' };
    expect(await requestPortalLink(sheets)).toMatchObject({ error: 'portal/not-offered' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

  (Ajustar `sheets` a los campos reales de `googleSheetsConfigSchema` al escribirlo.) En el test de
  `ui/errors.ts`: `describeError(err('portal/not-offered', undefined))` →
  `'este backend no ofrece el portal'`.
- [ ] **Paso 2:** `pnpm vitest run src/sync/portal-link.test.ts` → falla.
- [ ] **Paso 3: implementación.**
  - `sync/http-body.ts`: mover tal cual `errorBodySchema` y `readJson` de `demo-session.ts`
    (exportados, con su comentario) e importarlos desde `demo-session.ts`.
  - `rest-fetch-connector.ts`: `export function buildHeaders` y `export async function failedResponse`.
  - `domain/result.ts`, al lado de los `demo/*`: `'portal/not-offered': undefined;`.
  - `ui/errors.ts`: `case 'portal/not-offered': return 'este backend no ofrece el portal';`.
  - `sync/portal-link.ts`:

```ts
import { z } from 'zod';
import { err, ok, type Result } from '../domain/result.ts';
import { toZodIssues } from '../domain/zod-issues.ts';
import { buildHeaders, failedResponse } from '../connectors/rest/rest-fetch-connector.ts';
import type { ConnectorConfig } from './connector-registry.ts';
import { isAllowedBackendUrl } from './demo-link.ts';
import { errorBodySchema, readJson } from './http-body.ts';

/** Lo que devuelve `POST /portal-links` (4.6.0). Nunca se guarda: si lleva autorización, es un secreto. */
export type PortalLink = { url: string; expiresAt?: string };

const portalLinkSchema = z.object({
  url: z.url().refine(isAllowedBackendUrl, 'Tiene que ser https (o http a localhost)'),
  expiresAt: z.string().optional().catch(undefined),
});

/**
 * `POST /portal-links` (4.6.0, #179): el link que el backend decide para la key de esta terminal.
 * No pasa por el puerto `Connector`: solo existe en backends REST. Adaptador HTTP: los únicos
 * try/catch son `fetch` y `json()`. Sin reintentos.
 */
export async function requestPortalLink(config: ConnectorConfig): Promise<Result<PortalLink>> {
  if (config.type !== 'rest' && config.type !== 'rest-demo') {
    return err('portal/not-offered', undefined);
  }
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/portal-links`, {
      method: 'POST',
      headers: buildHeaders(config),
    });
  } catch (error) {
    return err('sync/request-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (response.status === 404) {
    return err('portal/not-offered', undefined);
  }
  if (response.status === 503) {
    const errorBody = errorBodySchema.safeParse(await readJson(response));
    const message = errorBody.success ? errorBody.data.message : undefined;
    return err('sync/backend-maintenance', message !== undefined ? { message } : {});
  }
  if (!response.ok) {
    return failedResponse(response);
  }
  const parsed = portalLinkSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    return err('sync/invalid-payload', { issues: toZodIssues(parsed.error) });
  }
  const { url, expiresAt } = parsed.data;
  return ok({ url, ...(expiresAt !== undefined ? { expiresAt } : {}) });
}
```

  (`buildHeaders` agrega `Content-Type: application/json`; sin cuerpo no molesta. Si
  `sync/` → `connectors/` arma un ciclo de imports, mover `buildHeaders`/`failedResponse` a
  `connectors/rest/http.ts` y que el conector los importe de ahí.)
- [ ] **Paso 4:** `pnpm vitest run src/sync` y `src/ui/errors*` pasan; `pnpm lint && pnpm typecheck`.
- [ ] **Paso 5: commit** `feat(sync): pedir el link del portal con POST /portal-links (#179)`.

### Tarea 4: abrir la pestaña (`openPortal`)

**Archivos:** crear `src/ui/keyboard/portal-controller.ts` y su test.

**Consume:** `requestPortalLink`, `PortalLink`, `isDemoRevokedFailure`, `markDemoRevoked`,
`loadSyncConfig`, `describeError`, `commandBarErrorSignal`. **Produce:**
`openPortal(label: string, deps?: PortalDeps): Promise<void>` y
`PortalTab = { closed: boolean; close(): void; location: { replace(url: string): void }; document: Document; opener: unknown }`.

- [ ] **Paso 1: tests que fallan** (`portal-controller.test.ts`), con una pestaña falsa:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../domain/result.ts';
import { commandBarErrorSignal } from '../state/command-bar.ts';
import { demoRevokedSignal } from '../state/sync.ts';
import { openPortal, type PortalDeps, type PortalTab } from './portal-controller.ts';

function fakeTab(): PortalTab & { replace: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  const replace = vi.fn();
  const tab = {
    closed: false,
    close: vi.fn(() => { tab.closed = true; }),
    location: { replace },
    document: document.implementation.createHTMLDocument(''),
    opener: {},
    replace,
  };
  return tab;
}

const restConfig = { type: 'rest' as const, baseUrl: 'https://b.x', apiKey: 'k' };

function deps(over: Partial<PortalDeps> = {}): PortalDeps {
  return {
    openTab: () => fakeTab(),
    request: () => Promise.resolve(ok({ url: 'https://b.x/p/abc' })),
    loadConfig: () => ok(restConfig),
    now: () => '2026-10-04T12:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  commandBarErrorSignal.value = null;
  demoRevokedSignal.value = null;
});

describe('openPortal (#179)', () => {
  it('abre la pestaña en el gesto, la deja "Abriendo…" y le carga la URL', async () => {
    const tab = fakeTab();
    const done = openPortal('Panel', deps({ openTab: () => tab }));
    expect(tab.opener).toBeNull();
    expect(tab.document.title).toBe('Abriendo Panel…');
    await done;
    expect(tab.replace).toHaveBeenCalledWith('https://b.x/p/abc');
    expect(commandBarErrorSignal.value).toBeNull();
  });

  it('un fallo cierra la pestaña y deja el motivo en la barra', async () => {
    const tab = fakeTab();
    await openPortal('Panel', deps({
      openTab: () => tab,
      request: () => Promise.resolve(err('sync/backend-maintenance', { message: 'Migrando' })),
    }));
    expect(tab.close).toHaveBeenCalled();
    expect(commandBarErrorSignal.value).toBe(
      'No se pudo abrir Panel: El backend está en mantenimiento: Migrando.',
    );
  });

  it('401 en demo marca la demo revocada y dice que terminó', async () => {
    const demoConfig = { ...restConfig, demo: { template: 'kiosco', onboarding: { url: 'https://b.x/alta', label: 'Alta' }, startedAt: '2026-10-04T10:00:00.000Z' } };
    await openPortal('Panel', deps({
      loadConfig: () => ok(demoConfig),
      request: () => Promise.resolve(err('sync/request-failed', { status: 401, message: 'Unauthorized' })),
    }));
    expect(demoRevokedSignal.value).toBe('2026-10-04T12:00:00.000Z');
    expect(commandBarErrorSignal.value).toBe('No se pudo abrir Panel: la demo terminó.');
  });

  it('con el bloqueador no pide el link', async () => {
    const request = vi.fn(() => Promise.resolve(ok({ url: 'https://b.x/p/abc' })));
    await openPortal('Panel', deps({ openTab: () => null, request }));
    expect(request).not.toHaveBeenCalled();
    expect(commandBarErrorSignal.value).toBe(
      'El navegador bloqueó la pestaña nueva: permití las ventanas emergentes para este sitio.',
    );
  });

  it('un segundo uso con un pedido en curso no abre otra pestaña', async () => {
    const openTab = vi.fn(() => fakeTab());
    const first = openPortal('Panel', deps({ openTab }));
    await openPortal('Panel', deps({ openTab }));
    await first;
    expect(openTab).toHaveBeenCalledTimes(1);
  });

  it('si el operador cerró la pestaña antes, descarta el link', async () => {
    const tab = fakeTab();
    const done = openPortal('Panel', deps({
      openTab: () => tab,
      request: () => {
        tab.closed = true; // el operador la cierra mientras se pide el link
        return Promise.resolve(ok({ url: 'https://b.x/p/abc' }));
      },
    }));
    await done;
    expect(tab.replace).not.toHaveBeenCalled();
    expect(commandBarErrorSignal.value).toBeNull();
  });
});
```

  (Ajustar el tipo de `resolve` y los campos de `demo` a `SyncConfig` al escribirlo.)
- [ ] **Paso 2:** `pnpm vitest run src/ui/keyboard/portal-controller.test.ts` → falla.
- [ ] **Paso 3: implementación.**

```ts
import type { Result } from '../../domain/result.ts';
import { loadSyncConfig, type SyncConfig } from '../../sync/config.ts';
import { isDemoRevokedFailure, markDemoRevoked } from '../../sync/demo-revoked.ts';
import { requestPortalLink, type PortalLink } from '../../sync/portal-link.ts';
import { describeError } from '../errors.ts';
import { commandBarErrorSignal } from '../state/command-bar.ts';

/** Lo que usa `openPortal` de la pestaña que abre (un `Window`, o uno falso en los tests). */
export type PortalTab = {
  closed: boolean;
  close(): void;
  location: { replace(url: string): void };
  document: Document;
  opener: unknown;
};

export type PortalDeps = {
  openTab: () => PortalTab | null;
  request: (config: SyncConfig) => Promise<Result<PortalLink>>;
  loadConfig: () => Result<SyncConfig>;
  now: () => string;
};

const defaultDeps: PortalDeps = {
  // Sin `noopener`: devolvería `null` y no se le podría cargar la URL. El `opener` se corta a mano.
  openTab: () => window.open('', '_blank'),
  request: requestPortalLink,
  loadConfig: loadSyncConfig,
  now: () => new Date().toISOString(),
};

let inFlight = false;

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * El comando y el botón del portal (#179). Abre la pestaña **en el gesto** (si no, el bloqueador de
 * pop-ups la frena), pide el link y se la carga; si falla, la cierra y deja el motivo en la barra.
 * Con la demo y un 401/403, la demo terminó: se marca como si la hubiera descubierto un ciclo.
 */
export async function openPortal(label: string, deps: PortalDeps = defaultDeps): Promise<void> {
  if (inFlight) {
    return;
  }
  const tab = deps.openTab();
  if (tab === null) {
    commandBarErrorSignal.value =
      'El navegador bloqueó la pestaña nueva: permití las ventanas emergentes para este sitio.';
    return;
  }
  tab.opener = null;
  tab.document.title = `Abriendo ${label}…`;
  tab.document.body.textContent = `Abriendo ${label}…`;
  inFlight = true;
  try {
    const config = deps.loadConfig();
    const link = config.ok ? await deps.request(config.value) : config;
    if (link.ok) {
      if (!tab.closed) {
        tab.location.replace(link.value.url);
      }
      return;
    }
    tab.close();
    if (isDemoRevokedFailure(link, config)) {
      markDemoRevoked(deps.now());
      commandBarErrorSignal.value = `No se pudo abrir ${label}: la demo terminó.`;
      return;
    }
    commandBarErrorSignal.value = sentence(`No se pudo abrir ${label}: ${describeError(link)}`);
  } finally {
    inFlight = false;
  }
}
```

  (`requestPortalLink` recibe `ConnectorConfig`; `SyncConfig` lo extiende, así que pasa directo. Si
  `tab.document.body` es `null` en `about:blank`, usar `tab.document.write`. `document.title` en el
  test sale de `createHTMLDocument`.)
- [ ] **Paso 4:** el test pasa; `pnpm lint && pnpm typecheck`.
- [ ] **Paso 5: commit** `feat(ui): abrir el portal en una pestaña nueva (#179)`.

### Tarea 5: el comando, el botón y `/DIAGNOSTICO`

**Archivos:** `src/ui/keyboard/commands.ts`, `src/ui/keyboard/command-bar-controller.ts`,
`src/ui/components/TerminalHeader.tsx`, `src/ui/screens/diagnostico-screen.tsx`; tests en `command-bar-controller.test.ts`,
`TerminalHeader.test.tsx` y el de `/DIAGNOSTICO` si verifica capacidades.

**Consume:** `portalOffer`, `backendPortalSignal`, `backendCapabilitiesSignal`, `demoRevokedSignal`,
`openPortal`. **Produce:** `RESERVED_COMMAND_NAMES: ReadonlySet<string>` y
`currentPortalOffer(): BackendPortal | null` en `commands.ts`.

- [ ] **Paso 1: tests que fallan.** En `command-bar-controller.test.ts`
  (`vi.mock('./portal-controller.ts', () => ({ openPortal: vi.fn(() => Promise.resolve()) }))`):

```ts
describe('portal (4.6.0, #179)', () => {
  beforeEach(() => {
    vi.mocked(openPortal).mockClear();
    backendCapabilitiesSignal.value = ['portal'];
    backendPortalSignal.value = { command: 'PANEL', label: 'Panel del backend' };
  });
  afterEach(() => {
    backendCapabilitiesSignal.value = undefined;
    backendPortalSignal.value = undefined;
    demoRevokedSignal.value = null;
  });

  it('con la oferta está en la lista y abre el portal', () => {
    expect(availableCommands().find((c) => c.name === 'PANEL')?.description).toBe('Panel del backend');
    updateCommandBarBuffer('/PANEL');
    submitCommandBar();
    expect(openPortal).toHaveBeenCalledWith('Panel del backend');
    expect(commandBarBufferSignal.value).toBe('');
  });

  it('sin la capacidad no aparece', () => {
    backendCapabilitiesSignal.value = [];
    expect(availableCommands().map((c) => c.name)).not.toContain('PANEL');
    updateCommandBarBuffer('/PANEL');
    submitCommandBar();
    expect(commandBarErrorSignal.value).toBe('Comando desconocido: /PANEL');
  });

  it('con la demo revocada no aparece', () => {
    demoRevokedSignal.value = '2026-10-04T12:00:00.000Z';
    expect(availableCommands().map((c) => c.name)).not.toContain('PANEL');
  });

  it('un nombre del POS (aunque no esté disponible ahora) pasa a /PORTAL', () => {
    backendPortalSignal.value = { command: 'ALTA', label: 'Mi panel' };
    expect(availableCommands().map((c) => c.name)).toContain('PORTAL');
    updateCommandBarBuffer('/PORTAL');
    submitCommandBar();
    expect(openPortal).toHaveBeenCalledWith('Mi panel');
  });
});
```

  En `TerminalHeader.test.tsx` (`vi.mock('../keyboard/portal-controller.ts', …)`): con la oferta, el
  botón `Panel del backend (/PANEL)` llama a `openPortal('Panel del backend')`; sin la capacidad o
  con la demo revocada no está; con demo activa, el de `/ALTA` sigue.
- [ ] **Paso 2:** los tests fallan.
- [ ] **Paso 3: implementación.**
  - `commands.ts`:

```ts
/**
 * Todos los nombres del POS, estén disponibles o no ahora (#179): el comando del portal que choca
 * con uno pasa a `/PORTAL`, así no cambia de nombre según el estado.
 */
export const RESERVED_COMMAND_NAMES: ReadonlySet<string> = new Set([
  ...CORE_COMMANDS.map((command) => command.name),
  'ACTUALIZAR',
  'ALTA',
  'DEMO_NUEVA',
  ...CONNECTOR_TYPES.flatMap((info) => info.commands.map((command) => command.name)),
]);

/** El portal que ofrece el POS ahora: nada con la demo revocada (la key ya no sirve). */
export function currentPortalOffer(): BackendPortal | null {
  if (demoRevokedSignal.value !== null) {
    return null;
  }
  return portalOffer(backendCapabilitiesSignal.value, backendPortalSignal.value, RESERVED_COMMAND_NAMES);
}
```

    y en `availableCommands()`: `const portal = currentPortalOffer();` y
    `...(portal !== null ? [{ name: portal.command, description: portal.label }] : [])` antes de los
    del conector. Actualizar el comentario de `availableCommands`.
  - `command-bar-controller.ts::runCommand`, al principio del `default`:

```ts
      // El comando del portal (4.6.0, #179): el nombre lo da el backend.
      const portal = currentPortalOffer();
      if (portal !== null && portal.command === name) {
        clearBuffer();
        void openPortal(portal.label);
        return;
      }
```

    `clearBuffer()` va **antes** de `openPortal`: `window.open` corre sincrónico dentro de la llamada,
    así que sigue en el gesto del Enter.
  - `TerminalHeader.tsx`: `const portal = currentPortalOffer();`, la condición de "no se muestra"
    pasa a `heading === null && demo === null && portal === null`, y antes del bloque de la demo:

```tsx
      {portal !== null && (
        <button
          type="button"
          tabIndex={-1}
          class="btn"
          onMouseDown={keepFocusOnMouseDown}
          onClick={() => void openPortal(portal.label)}
          title={`${portal.label} (/${portal.command})`}
          style={{ ...headerButtonStyle, marginLeft: 'auto' }}
        >
          {`${portal.label} (/${portal.command})`}
        </button>
      )}
```

    con `headerButtonStyle` (sacado del botón de la demo: `flexShrink: 0`, `whiteSpace: 'nowrap'`,
    borde, radio, padding, tamaño y cursor) compartido por los dos; el de la demo deja
    `marginLeft: 'auto'` solo si no hay botón del portal (así los dos quedan a la derecha, el del
    portal primero). Actualizar el comentario del componente.
  - `diagnostico-screen.tsx` (no se toca `diagnostics.ts`): debajo de "Empresa", con
    `const portal = currentPortalOffer();` importado de `commands.ts`:

```tsx
          <p style={{ margin: 0 }}>
            Portal: {portal !== null ? `/${portal.command} (${portal.label})` : 'no ofrecido'}
          </p>
```

    Muestra lo mismo que ofrecen el comando y el botón (con la demo revocada, "no ofrecido").
- [ ] **Paso 4:** `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Paso 5: commit** `feat(ui): comando y botón del portal (#179)`.

### Tarea 6: e2e contra el demo-backend

**Archivos:** `e2e/demo-onboarding.spec.ts` (va en serie contra el `4001`: un archivo nuevo en
paralelo se pisaría con el re-sembrado de `POST /demo-sessions`).

- [ ] **Paso 1: el test.**

```ts
test('portal (#179): el comando y el botón abren el backend en esta caja', async ({ page, context }) => {
  await page.goto(DEMO_LINK);
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();
  const button = page.getByRole('button', { name: 'Panel del backend (/PANEL)' });
  await expect(button).toBeVisible();

  const [fromCommand] = await Promise.all([
    context.waitForEvent('page'),
    (async () => {
      await commandBar.fill('/PANEL');
      await commandBar.press('Enter');
    })(),
  ]);
  await expect(fromCommand.getByText('Entraste como Caja 1 de CENTRAL')).toBeVisible();
  await fromCommand.close();

  const [fromButton] = await Promise.all([context.waitForEvent('page'), button.click()]);
  await expect(fromButton.getByText('Entraste como Caja 1 de CENTRAL')).toBeVisible();
  await expect(commandBar).toBeFocused();
});
```

- [ ] **Paso 2:** `pnpm build && pnpm test:e2e e2e/demo-onboarding.spec.ts` → pasa. Después la suite
  entera, `pnpm test:e2e`.
- [ ] **Paso 3: commit** `test(e2e): el portal contra el demo-backend (#179)`.

### Tarea 7: docs

**Archivos:** `src/sync/AGENTS.md`, `src/ui/AGENTS.md`, `AGENTS.md`; borrar este plan.

- [ ] `src/sync/AGENTS.md`, "Contrato 4.6.0": reemplazar "El POS todavía no la usa: el comando y el
  botón son de P6 (#179)." por los módulos: `backendInfoSchema.portal` (mal formado = ausente),
  `sync/backend-portal.ts` (como la empresa, y `portalOffer`: capacidad + objeto, choque → `PORTAL`)
  y `sync/portal-link.ts` (errores: 401/403, 404 → `portal/not-offered`, 409, 503, sin red; sin
  reintentos; la URL no se guarda ni se loguea).
- [ ] `src/ui/AGENTS.md`: sección corta "Portal (#179)": `RESERVED_COMMAND_NAMES`,
  `currentPortalOffer` (oculto con la demo revocada), `openPortal` (pestaña en el gesto, "Abriendo…",
  bloqueador, un pedido a la vez, 401 en demo), el botón en `TerminalHeader` (`.btn`, a la izquierda
  del de `/ALTA`) y la línea de `/DIAGNOSTICO`.
- [ ] `AGENTS.md` raíz: en la tabla de comandos, una fila "`/<comando del backend>`": "Solo si el
  backend declara `portal`: abre el backend en una pestaña nueva (ver `src/ui/AGENTS.md`)"; en
  "Connector API", "que tampoco va a pasar por el puerto (lo usa P6, #179)" → "que tampoco pasa por
  el puerto (`sync/portal-link.ts`)"; fila de #179 en "Estado del proyecto" (con "PR #N" al abrirlo);
  en "Siguiente", el comando del portal (#179) pasa a lo hecho; en "Issues abiertas", sacar #179 del
  epic #182 y sumar en Transversal "#205 (flake de `e2e/mouse.spec.ts`)"; la tabla del índice
  (Onboarding de demo / Contrato) suma el portal donde corresponda.
- [ ] `git rm docs/superpowers/plans/2026-10-04-portal-en-el-pos.md`.
- [ ] Verificación final: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`.
- [ ] **Commit** `docs: el portal en el POS (#179) y #205 en issues abiertas`.

### Cierre (después de la revisión del usuario)

- Informe final con la prueba manual (abajo).
- PR con "Closes #179", merge commit; comentar en #179 con el PR y tildar #179 en el epic #182.

**Prueba manual** (para el informe): `pnpm backend` + `pnpm build && pnpm preview`; abrir
`/?demo=true&backend=http://localhost:4000`; ver "Panel del backend (/PANEL)" en el encabezado;
`/PANEL` → pestaña nueva "Portal del minibackend — Entraste como Caja 1 de CENTRAL…"; recargar esa
pestaña → 410 "El link ya se usó o venció"; el botón abre otra; prender mantenimiento en el panel y
usarlo → la pestaña se cierra y la barra dice "No se pudo abrir Panel del backend: El backend está en
mantenimiento: …"; apagar el backend → "No se pudo conectar con el servidor…"; con `/CONFIG` a otro
backend sin la capacidad (o Sheets), no hay ni botón ni comando.
