# Empresa, sucursal y caja a la vista — plan de implementación

> **Para agentes:** se ejecuta **inline** con `superpowers:executing-plans`, tarea por tarea con
> checkpoints (convención del repo, ver "Cómo trabajamos" en `AGENTS.md`). Los pasos usan `- [ ]`.

**Objetivo:** que el POS muestre en qué caja, sucursal y empresa está la terminal: la barra de estado
en dos líneas y el título de la pestaña, con la empresa que manda el backend en `GET /info` (contrato
4.5.0).

**Arquitectura:** `GET /info` suma `company: { name }` opcional. El POS lo guarda como las
capacidades (`localStorage` por carpeta + un signal) y lo actualiza con cada `/info` y al aplicar una
conexión. La sucursal y la caja salen de la config activa, en un signal propio que fijan `bootstrap`,
`applyConnection` y `applyTerminalSettings`. Un módulo puro arma el texto de contexto y el título. El
demo-backend manda el nombre de la demo con una key de demo y el del alta con la del comercio.

**Stack:** Preact + `@preact/signals`, Zod, Vitest + Testing Library, Playwright; demo-backend en Node
+ SQLite.

**Spec:** `docs/superpowers/specs/2026-10-03-empresa-sucursal-y-caja-design.md` (issue #193).

## Restricciones globales

- Contrato: `POS_CONTRACT_VERSION = '4.5.0'`; `MIN_BACKEND_CONTRACT` sigue en `'4.0.0'`.
- Campo nuevo: `company: { name: string }`, opcional, en `GET /info`. No es una capacidad.
- Un `company` mal formado o con `name` vacío se trata como ausente (reglas de evolución): nunca hace
  fallar `/info`.
- Texto de contexto: `<caja> - <sucursal> - <empresa>`, separador `' - '`; sin empresa,
  `<caja> - <sucursal>`. Título de la pestaña: `<caja> - <sucursal>`, sin la empresa; sin config
  activa, el título de siempre (`offline-pos`).
- Nombres de demo del demo-backend: `kiosco` → `Kiosco de demo`, `almacen` → `Almacén de demo`.
- El OpenAPI no lleva referencias internas (`#N`, specs, `AGENTS.md`): lo vigila `site/docs.test.ts`.
- Todo en español: código, comentarios, commits. Commits con
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verificación de cada tarea: `pnpm lint && pnpm typecheck && pnpm test` (más
  `pnpm test:backend && pnpm typecheck:backend` en la del demo-backend, y `pnpm build && pnpm test:e2e`
  en la última).

---

### Tarea 1: Contrato 4.5.0 (`company` en `GET /info`)

**Archivos:**
- Modificar: `src/sync/connector.ts` (`backendInfoSchema`, `BackendInfo`, `toBackendInfo`)
- Modificar: `src/domain/contract-version.ts` (`POS_CONTRACT_VERSION`)
- Modificar: `docs/connector-api.openapi.yaml` (versión, changelog, `BackendInfo.company`, ejemplo del
  header `ContractVersion`)
- Modificar: `docs/integradores/guia.md`, `docs/integradores/llms.txt` (4.4.0 → 4.5.0 donde nombran
  la versión vigente)
- Test: `src/sync/connector.test.ts`, y los tests que comparan el header con el literal `'4.4.0'`

**Interfaces:**
- Produce: `BackendInfo.company?: { name: string }`; `POS_CONTRACT_VERSION === '4.5.0'`.

- [ ] **Paso 1: test que falla** — en `src/sync/connector.test.ts`, dentro del `describe` de `/info`:

```ts
it('company opcional (4.5.0): se conserva; mal formada o con nombre vacío, ausente', () => {
  const withCompany = backendInfoSchema.parse({
    contractVersion: '4.5.0',
    status: 'ok',
    company: { name: 'Kiosco Pepe' },
  });
  expect(toBackendInfo(withCompany).company).toEqual({ name: 'Kiosco Pepe' });

  const malformed = backendInfoSchema.parse({ contractVersion: '4.5.0', status: 'ok', company: 3 });
  expect(toBackendInfo(malformed)).not.toHaveProperty('company');

  const blank = backendInfoSchema.parse({
    contractVersion: '4.5.0',
    status: 'ok',
    company: { name: '  ' },
  });
  expect(toBackendInfo(blank)).not.toHaveProperty('company');
});
```

- [ ] **Paso 2:** `pnpm vitest run src/sync/connector.test.ts` → FALLA (`company` no está en el esquema).

- [ ] **Paso 3: implementación** en `src/sync/connector.ts`:

```ts
/**
 * Respuesta de `GET /info` (contrato 4.0.0, #99): versión y estado del backend. 4.4.0 (#128): un
 * `status` desconocido se trata como `ok` (reglas de evolución) y `capabilities` declara lo
 * opcional que el backend implementa (ausente = ninguna). 4.5.0 (#193): `company`, el comercio de
 * la key, para mostrarlo; mal formado o con el nombre vacío cuenta como ausente.
 */
export const backendInfoSchema = z.object({
  contractVersion: z.string(),
  status: z.enum(['ok', 'maintenance']).catch('ok'),
  message: z.string().optional(),
  backend: z.object({ name: z.string(), version: z.string() }).optional(),
  capabilities: z.array(z.string()).optional(),
  company: z
    .object({ name: z.string().trim().min(1) })
    .optional()
    .catch(undefined),
});

export type BackendInfo = {
  contractVersion: string;
  status: 'ok' | 'maintenance';
  message?: string;
  backend?: { name: string; version: string };
  capabilities?: string[];
  company?: { name: string };
};
```

y en `toBackendInfo`, después de `capabilities`:

```ts
    ...(data.company !== undefined ? { company: data.company } : {}),
```

- [ ] **Paso 4:** `src/domain/contract-version.ts`: `POS_CONTRACT_VERSION = '4.5.0'` y sumar al
  comentario: `4.5.0 desde #193 (`company` opcional en `GET /info`).`

- [ ] **Paso 5: OpenAPI** (`docs/connector-api.openapi.yaml`):
  - `info.version: '4.5.0'`.
  - Al principio del changelog, antes de "4.4.0 respecto de 4.3.0":

```yaml
    **4.5.0 respecto de 4.4.0** (aditivo):
      - `GET /info` suma `company` opcional (`{ name }`): el comercio al que
        pertenece la key, para que el POS muestre en qué empresa está la
        terminal. Ausente, mal formado o con el nombre vacío, el POS no
        muestra empresa. No es una capacidad: se declara mandándolo.
      - El piso sigue en 4.0.0: un backend 4.4 sigue siendo compatible.
```

  - En `components.schemas.BackendInfo.properties`, después de `backend`:

```yaml
        company:
          type: object
          required: [name]
          description: |
            4.5.0: el comercio al que pertenece la key (por ejemplo, el nombre
            de la empresa en el backend). El POS lo muestra junto a la sucursal
            y la caja. Opcional.
          properties:
            name: { type: string, example: Kiosco Pepe }
```

  - `ContractVersion`: `example: '4.5.0'` y "Versión del contrato que habla el POS (4.5.0)".
  - "Compatibilidad del lado del POS (4.4.0)": el POS habla 4.5.0 (el piso no cambia).

- [ ] **Paso 6:** `docs/integradores/guia.md` y `llms.txt`: la versión vigente pasa a **4.5.0**.

- [ ] **Paso 7:** `pnpm test` → arreglar los tests que comparan el header
  `X-POS-Contract-Version` o `POS_CONTRACT_VERSION` con el literal `'4.4.0'`
  (`grep -rn "'4.4.0'" src site --include=*.test.ts`): solo los que representan la versión **del
  POS**; las que representan la de un backend quedan como están.

- [ ] **Paso 8:** `pnpm lint && pnpm typecheck && pnpm test` → todo verde.

- [ ] **Paso 9: commit**

```bash
git add -A src docs site
git commit -m "feat(contrato): 4.5.0, company opcional en GET /info (#193)"
```

---

### Tarea 2: el POS guarda la empresa y la muestra en `/DIAGNOSTICO`

**Archivos:**
- Crear: `src/sync/backend-company.ts`
- Crear: `src/sync/backend-company.test.ts`
- Modificar: `src/ui/state/sync.ts` (signal `backendCompanySignal`)
- Modificar: `src/sync/backend-status.ts` (`refreshBackendStatus`)
- Modificar: `src/sync/pull-snapshot.ts` (`ProbeSnapshot.company`)
- Modificar: `src/sync/connection.ts` (`checkThenPull`)
- Modificar: `src/sync/apply-connection.ts` (`applyConnection`)
- Modificar: `src/ui/bootstrap.ts` (restaurar al arrancar)
- Modificar: `src/sync/diagnostics.ts`, `src/ui/screens/diagnostico-screen.tsx`
- Test: `src/sync/backend-status.test.ts`, `src/sync/connection.test.ts`,
  `src/sync/apply-connection.test.ts`, `src/ui/screens/diagnostico-screen.test.tsx`

**Interfaces:**
- Consume: `BackendInfo.company` (Tarea 1).
- Produce: `backendCompanySignal: Signal<string | undefined>` (en `ui/state/sync.ts`);
  `saveBackendCompany(company: { name: string } | undefined): void`;
  `restoreBackendCompany(): void`; `ProbeSnapshot.company?: { name: string }`;
  `SyncDiagnostics.company: string | undefined`.

- [ ] **Paso 1: test del módulo** — `src/sync/backend-company.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { backendCompanySignal } from '../ui/state/sync.ts';
import { restoreBackendCompany, saveBackendCompany } from './backend-company.ts';

beforeEach(() => {
  localStorage.clear();
  backendCompanySignal.value = undefined;
});

describe('empresa del backend (4.5.0, #193)', () => {
  it('se guarda, se restaura al arrancar y se borra con undefined', () => {
    saveBackendCompany({ name: 'Kiosco Pepe' });
    backendCompanySignal.value = undefined;
    restoreBackendCompany();
    expect(backendCompanySignal.value).toBe('Kiosco Pepe');

    saveBackendCompany(undefined);
    expect(localStorage.getItem('offline-pos:backend-company')).toBeNull();
    expect(backendCompanySignal.value).toBeUndefined();
  });

  it('un valor guardado inválido es "sin empresa"', () => {
    localStorage.setItem('offline-pos:backend-company', '{"name":3}');
    restoreBackendCompany();
    expect(backendCompanySignal.value).toBeUndefined();
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/sync/backend-company.test.ts` → FALLA (no existe el módulo).

- [ ] **Paso 3: signal** en `src/ui/state/sync.ts`, después de `backendCapabilitiesSignal`:

```ts
/**
 * Empresa del backend según su último `getInfo` exitoso (4.5.0, #193), persistida por
 * `sync/backend-company.ts`. `undefined` = el backend no la manda (o nunca se supo).
 */
export const backendCompanySignal = signal<string | undefined>(undefined);
```

- [ ] **Paso 4: módulo** `src/sync/backend-company.ts`:

```ts
import { z } from 'zod';
import { backendCompanySignal } from '../ui/state/sync.ts';
import { storageKey } from '../storage/storage-namespace.ts';

/**
 * La empresa del último `getInfo` exitoso (4.5.0, #193), en `localStorage`: una terminal que
 * arranca sin red la muestra igual. Estado operativo best-effort, como las capacidades
 * (`backend-capabilities.ts`): perderlo solo deja de mostrarla hasta el próximo `/info`.
 */
const STORAGE_KEY = storageKey('backend-company');
const companySchema = z.object({ name: z.string().min(1) });

export function restoreBackendCompany(): void {
  let parsedJson: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    parsedJson = raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    parsedJson = null;
  }
  const parsed = companySchema.safeParse(parsedJson);
  backendCompanySignal.value = parsed.success ? parsed.data.name : undefined;
}

/** `undefined` borra: el backend no la mandó, o se aplicó otra conexión sin ella. */
export function saveBackendCompany(company: { name: string } | undefined): void {
  backendCompanySignal.value = company?.name;
  try {
    if (company === undefined) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: company.name }));
    }
  } catch {
    // Best-effort: el signal ya tiene el valor de esta sesión.
  }
}
```

- [ ] **Paso 5:** `pnpm vitest run src/sync/backend-company.test.ts` → PASA.

- [ ] **Paso 6: tests de los que la actualizan** (fallan hasta el Paso 8):
  - `src/sync/backend-status.test.ts`, en `describe('refreshBackendStatus')`:

```ts
  it('guarda la empresa que manda el backend; sin ella, la borra (4.5.0, #193)', async () => {
    await refreshBackendStatus(
      fakeConnector({
        getInfo: () =>
          Promise.resolve(
            ok({ contractVersion: '4.5.0', status: 'ok', company: { name: 'Kiosco Pepe' } }),
          ),
      }),
      now,
    );
    expect(backendCompanySignal.value).toBe('Kiosco Pepe');

    await refreshBackendStatus(fakeConnector(), now);
    expect(backendCompanySignal.value).toBeUndefined();
  });
```

  - `src/sync/connection.test.ts`, al lado de "suma las capacidades del getInfo de la prueba":

```ts
  it('suma la empresa del getInfo de la prueba (4.5.0, #193)', async () => {
    const connector = fakeConnector({
      getInfo: () =>
        Promise.resolve(
          ok({ contractVersion: '4.5.0', status: 'ok' as const, company: { name: 'Kiosco Pepe' } }),
        ),
    });

    const result = await probeConnection(config, { connector });

    expect(result.ok && result.value.company).toEqual({ name: 'Kiosco Pepe' });
  });
```

  - `src/sync/apply-connection.test.ts`, al lado del test de capacidades:

```ts
  it('guarda la empresa de la prueba; una foto sin ella la borra (4.5.0, #193)', async () => {
    await applyConnection({
      candidate,
      snapshot: { ...snapshot, company: { name: 'Kiosco Pepe' } },
      local: 'wipe',
      originChanged: true,
      now,
    });
    expect(backendCompanySignal.value).toBe('Kiosco Pepe');

    await applyConnection({ candidate, snapshot, local: 'wipe', originChanged: true, now });
    expect(backendCompanySignal.value).toBeUndefined();
    expect(localStorage.getItem('offline-pos:backend-company')).toBeNull();
  });
```

  (importar `backendCompanySignal` de `../ui/state/sync.ts` en los tres).

- [ ] **Paso 7:** `pnpm vitest run src/sync` → FALLAN los tres tests nuevos.

- [ ] **Paso 8: implementación**:
  - `src/sync/pull-snapshot.ts`, en `ProbeSnapshot`, después de `capabilities`:

```ts
  /** La del `getInfo` de la prueba de conexión (4.5.0, #193); ausente = el backend no la manda. */
  company?: { name: string };
```

  - `src/sync/connection.ts`, en `checkThenPull`:

```ts
  return snapshot.ok
    ? ok({
        ...snapshot.value,
        capabilities: info.value.capabilities ?? [],
        ...(info.value.company !== undefined ? { company: info.value.company } : {}),
      })
    : snapshot;
```

  - `src/sync/backend-status.ts`, en `refreshBackendStatus`, después de `saveBackendCapabilities`:

```ts
    // 4.5.0 (#193): la empresa de la key; sin ella, se deja de mostrar.
    saveBackendCompany(result.value.company);
```

  - `src/sync/apply-connection.ts`, después de `saveBackendCapabilities(params.snapshot.capabilities)`:

```ts
    // 4.5.0 (#193): la empresa de esta conexión, nunca la de la anterior.
    saveBackendCompany(params.snapshot.company);
```

  - `src/ui/bootstrap.ts`, después de `restoreBackendCapabilities()`: `restoreBackendCompany();`
    (y actualizar el comentario de arriba: "capacidades y empresa del último `getInfo`").

- [ ] **Paso 9:** `pnpm vitest run src/sync` → PASA.

- [ ] **Paso 10: `/DIAGNOSTICO`** — test en `src/ui/screens/diagnostico-screen.test.tsx`, al lado del
  de "Capacidades":

```ts
  it('muestra la empresa del backend, o "no informada" (4.5.0, #193)', () => {
    backendCompanySignal.value = 'Kiosco Pepe';
    render(<DiagnosticoScreen />);
    expect(screen.getByText('Empresa: Kiosco Pepe')).not.toBeNull();
    cleanup();

    backendCompanySignal.value = undefined;
    render(<DiagnosticoScreen />);
    expect(screen.getByText('Empresa: no informada')).not.toBeNull();
  });
```

  (seguir el armado de los tests vecinos: si setean otros signals o usan otro helper de render,
  copiarlo). Correr → FALLA.

- [ ] **Paso 11:** `src/sync/diagnostics.ts`: campo
  `/** Empresa del último `getInfo` exitoso (4.5.0, #193); `undefined` = no informada. */ company: string | undefined;`
  y en `collectDiagnostics`, `company: backendCompanySignal.value,`. En
  `src/ui/screens/diagnostico-screen.tsx`, después de la línea de Capacidades:

```tsx
          <p style={{ margin: 0 }}>Empresa: {diagnostics.company ?? 'no informada'}</p>
```

- [ ] **Paso 12:** `pnpm lint && pnpm typecheck && pnpm test` → verde.

- [ ] **Paso 13: commit**

```bash
git add -A src
git commit -m "feat(sync): guardar la empresa de GET /info y mostrarla en /DIAGNOSTICO (#193)"
```

---

### Tarea 3: sucursal y caja en un signal, texto de contexto y título de la pestaña

**Archivos:**
- Crear: `src/ui/terminal-context.ts`
- Crear: `src/ui/terminal-context.test.ts`
- Modificar: `src/ui/state/sync.ts` (`terminalIdentitySignal`, `setTerminalIdentity`)
- Modificar: `src/ui/bootstrap.ts`, `src/sync/apply-connection.ts` (`applyConnection` y
  `applyTerminalSettings`)
- Modificar: `src/main.tsx` (título)
- Test: `src/sync/apply-connection.test.ts`

**Interfaces:**
- Consume: `backendCompanySignal` (Tarea 2).
- Produce: `type TerminalIdentity = { branch: string; pointOfSale: string }` (en `ui/state/sync.ts`);
  `terminalIdentitySignal: Signal<TerminalIdentity | null>`;
  `setTerminalIdentity(identity: TerminalIdentity | null): void`;
  `terminalContextText(identity: TerminalIdentity | null, company: string | undefined): string | null`;
  `terminalTitle(identity: TerminalIdentity | null): string | null`;
  `startTerminalTitle(baseTitle: string): () => void`.

- [ ] **Paso 1: tests del módulo puro** — `src/ui/terminal-context.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { setTerminalIdentity } from './state/sync.ts';
import { startTerminalTitle, terminalContextText, terminalTitle } from './terminal-context.ts';

const identity = { branch: 'Central', pointOfSale: 'Caja 1' };

describe('contexto de la terminal (#193)', () => {
  it('caja - sucursal - empresa', () => {
    expect(terminalContextText(identity, 'Kiosco Pepe')).toBe('Caja 1 - Central - Kiosco Pepe');
  });

  it('sin empresa, caja - sucursal', () => {
    expect(terminalContextText(identity, undefined)).toBe('Caja 1 - Central');
  });

  it('sin identidad, nada', () => {
    expect(terminalContextText(null, 'Kiosco Pepe')).toBeNull();
    expect(terminalTitle(null)).toBeNull();
  });

  it('el título no lleva la empresa', () => {
    expect(terminalTitle(identity)).toBe('Caja 1 - Central');
  });
});

describe('título de la pestaña (#193)', () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    setTerminalIdentity(null);
  });

  it('sigue a la identidad; sin ella, el título de siempre', () => {
    setTerminalIdentity(null);
    stop = startTerminalTitle('offline-pos');
    expect(document.title).toBe('offline-pos');

    setTerminalIdentity(identity);
    expect(document.title).toBe('Caja 1 - Central');

    setTerminalIdentity(null);
    expect(document.title).toBe('offline-pos');
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run src/ui/terminal-context.test.ts` → FALLA.

- [ ] **Paso 3: signal** en `src/ui/state/sync.ts`, al lado de `demoSessionSignal`:

```ts
/** Sucursal y punto de venta de la config activa (#193). */
export type TerminalIdentity = { branch: string; pointOfSale: string };

/**
 * La sucursal y la caja de la config activa (`null` = sin conexión activa), para la barra de estado y
 * el título de la pestaña (#193). Lo fijan `bootstrap` al arrancar, `applyConnection` al cambiar de
 * conexión y `applyTerminalSettings` al cambiar la terminal desde `/CONFIG`.
 */
export const terminalIdentitySignal = signal<TerminalIdentity | null>(null);

export function setTerminalIdentity(identity: TerminalIdentity | null): void {
  terminalIdentitySignal.value = identity;
}
```

- [ ] **Paso 4: módulo** `src/ui/terminal-context.ts`:

```ts
import { effect } from '@preact/signals';
import { terminalIdentitySignal, type TerminalIdentity } from './state/sync.ts';

/** Caja, sucursal y empresa, en ese orden (#193); se omite lo que falte. Pura. */
export function terminalContextText(
  identity: TerminalIdentity | null,
  company: string | undefined,
): string | null {
  if (identity === null) {
    return null;
  }
  const text = [identity.pointOfSale, identity.branch, company]
    .filter((part): part is string => part !== undefined && part.trim() !== '')
    .join(' - ');
  return text === '' ? null : text;
}

/** Título de la pestaña: caja y sucursal, sin la empresa (#193). Pura. */
export function terminalTitle(identity: TerminalIdentity | null): string | null {
  return terminalContextText(identity, undefined);
}

/**
 * Mantiene `document.title` al día con la terminal (#193); sin conexión activa, `baseTitle`.
 * Devuelve la función que lo detiene (tests).
 */
export function startTerminalTitle(baseTitle: string): () => void {
  return effect(() => {
    document.title = terminalTitle(terminalIdentitySignal.value) ?? baseTitle;
  });
}
```

- [ ] **Paso 5:** `pnpm vitest run src/ui/terminal-context.test.ts` → PASA.

- [ ] **Paso 6: test de quién fija la identidad** — en `src/sync/apply-connection.test.ts`:

```ts
  it('fija la sucursal y la caja de la conexión aplicada (#193)', async () => {
    await applyConnection({
      candidate: { ...candidate, branch: 'Central', pointOfSale: 'Caja 1' },
      snapshot,
      local: 'wipe',
      originChanged: true,
      now,
    });
    expect(terminalIdentitySignal.value).toEqual({ branch: 'Central', pointOfSale: 'Caja 1' });
  });
```

  y en el `describe` de `applyTerminalSettings`:

```ts
  it('actualiza la sucursal y la caja a la vista (#193)', () => {
    saveSyncConfig({ ...oldConfig, branch: 'Central', pointOfSale: 'Caja 1' });
    applyTerminalSettings({ branch: 'Norte', pointOfSale: 'Caja 2', locale: '' });
    expect(terminalIdentitySignal.value).toEqual({ branch: 'Norte', pointOfSale: 'Caja 2' });
  });
```

  Correr → FALLAN.

- [ ] **Paso 7: implementación**:
  - `src/sync/apply-connection.ts`, en `applyConnection`, al lado de `setDemoSession(...)`:

```ts
    setTerminalIdentity({
      branch: params.candidate.branch ?? '',
      pointOfSale: params.candidate.pointOfSale ?? '',
    });
```

  - En `applyTerminalSettings`, después de `setActiveConnectorType(...)`:

```ts
  setTerminalIdentity(
    state === 'active' ? { branch: next.branch ?? '', pointOfSale: next.pointOfSale ?? '' } : null,
  );
```

  - `src/ui/bootstrap.ts`, al lado de `setDemoSession(...)`:

```ts
  setTerminalIdentity(
    state === 'active' && configResult.ok
      ? {
          branch: configResult.value.branch ?? '',
          pointOfSale: configResult.value.pointOfSale ?? '',
        }
      : null,
  );
```

  - `src/main.tsx`, en `startApp`, dentro del `.then` y antes del `render` de `<App />`:
    `startTerminalTitle(APP_TITLE);` (importado de `./ui/terminal-context.ts`). La segunda pestaña no
    llega a `startApp`, así que conserva `SECONDARY_TITLE`.

- [ ] **Paso 8:** `pnpm lint && pnpm typecheck && pnpm test` → verde.

- [ ] **Paso 9: commit**

```bash
git add -A src
git commit -m "feat(ui): sucursal y caja en el título de la pestaña (#193)"
```

---

### Tarea 4: barra de estado en dos líneas

**Archivos:**
- Modificar: `src/ui/components/StatusBar.tsx`
- Test: `src/ui/components/StatusBar.test.tsx`

**Interfaces:**
- Consume: `terminalIdentitySignal`, `setTerminalIdentity`, `terminalContextText` (Tarea 3);
  `backendCompanySignal` (Tarea 2).

- [ ] **Paso 1: tests** — en `StatusBar.test.tsx`, en el `beforeEach` sumar
  `setTerminalIdentity(null); backendCompanySignal.value = undefined;`, y un `describe` nuevo:

```tsx
describe('StatusBar — empresa, sucursal y caja (#193)', () => {
  it('línea de contexto: caja - sucursal - empresa', () => {
    setTerminalIdentity({ branch: 'Central', pointOfSale: 'Caja 1' });
    backendCompanySignal.value = 'Kiosco Pepe';
    render(<StatusBar />);
    expect(screen.getByText('Caja 1 - Central - Kiosco Pepe')).not.toBeNull();
  });

  it('sin empresa, caja - sucursal', () => {
    setTerminalIdentity({ branch: 'Central', pointOfSale: 'Caja 1' });
    render(<StatusBar />);
    expect(screen.getByText('Caja 1 - Central')).not.toBeNull();
  });

  it('DEMO y el botón del alta van en la línea del contexto, no en la del estado', () => {
    setTerminalIdentity({ branch: 'Central', pointOfSale: 'Caja 1' });
    setDemoSession(demo);
    render(<StatusBar />);
    const contextLine = screen.getByTestId('status-bar-context');
    expect(contextLine.textContent).toContain('DEMO');
    expect(contextLine.textContent).toContain('Caja 1 - Central');
    expect(contextLine.textContent).toContain('Crear mi comercio (/ALTA)');
    expect(screen.getByTestId('status-bar-sync').textContent).not.toContain('DEMO');
    setDemoSession(null);
  });

  it('sin identidad ni demo no hay línea de contexto', () => {
    render(<StatusBar />);
    expect(screen.queryByTestId('status-bar-context')).toBeNull();
  });

  it('un click en la línea de contexto abre /DIAGNOSTICO', () => {
    setTerminalIdentity({ branch: 'Central', pointOfSale: 'Caja 1' });
    activeScreenSignal.value = 'sale';
    render(<StatusBar />);
    fireEvent.click(screen.getByText('Caja 1 - Central'));
    expect(activeScreenSignal.value).toBe('diagnostico');
  });
});
```

  (el valor del screen de `/DIAGNOSTICO` es el que ya usa el test "un click abre /DIAGNOSTICO";
  copiarlo de ahí). Correr `pnpm vitest run src/ui/components/StatusBar.test.tsx` → FALLAN.

- [ ] **Paso 2: implementación** — en `StatusBar.tsx`, el contenedor pasa a columna, con dos hijos:

```tsx
  const context = terminalContextText(terminalIdentitySignal.value, backendCompanySignal.value);
  return (
    <div
      class="status-bar"
      title="Ver diagnóstico de sincronización (/DIAGNOSTICO)"
      onClick={enterDiagnosticoScreen}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        padding: 'var(--space-2) var(--space-3)',
        color: 'var(--color-chrome-text-muted)',
        fontSize: 'var(--font-size-sm)',
        background: 'var(--color-chrome-bg)',
        borderBottom: '2px solid var(--color-chrome-border)',
      }}
    >
      {(context !== null || demo !== null) && (
        <div
          data-testid="status-bar-context"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}
        >
          {demo !== null && (/* el <span>DEMO</span> de hoy, sin cambios */)}
          {context !== null && (
            <span
              style={{
                color: 'var(--color-chrome-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {context}
            </span>
          )}
          {demo !== null && (
            <div style={{ marginLeft: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {/* el <button> de /ALTA o /DEMO_NUEVA de hoy, sin cambios */}
            </div>
          )}
        </div>
      )}
      <div
        data-testid="status-bar-sync"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
      >
        {/* el punto + statusText() y, a la derecha, Avisos y Sin arqueo: lo de hoy, sin el bloque de la demo */}
      </div>
    </div>
  );
```

  Mover el `<span>DEMO</span>` y el `<button>` de la demo tal como están hoy (mismos estilos,
  `stopPropagation`, `keepFocusOnMouseDown`, `tabIndex={-1}`). Actualizar el comentario del
  componente: dos líneas, la de contexto (#193) con DEMO y el botón de la demo, y la de sync.

- [ ] **Paso 3:** `pnpm vitest run src/ui/components/StatusBar.test.tsx` → PASA (los tests viejos de
  la demo siguen andando: buscan por rol y texto, no por posición).

- [ ] **Paso 4:** `pnpm lint && pnpm typecheck && pnpm test` → verde.

- [ ] **Paso 5: commit**

```bash
git add -A src
git commit -m "feat(ui): barra de estado en dos líneas con caja, sucursal y empresa (#193)"
```

---

### Tarea 5: demo-backend 4.5.0 (empresa de la demo y del alta)

**Archivos:**
- Modificar: `demo-backend/src/settings.ts` (`CONTRACT_VERSION`, empresa y plantilla de la demo)
- Modificar: `demo-backend/src/seed.ts` (`DEMO_COMPANY_NAMES`)
- Modificar: `demo-backend/src/demo-keys.ts` (`isDemoKey`)
- Modificar: `demo-backend/src/router.ts` (`RouteContext.token`)
- Modificar: `demo-backend/src/routes/info.ts`
- Modificar: `demo-backend/src/routes/demo-sessions.ts` (plantilla, página de alta con formulario,
  `GET /_demo/onboarding/complete`)
- Test: `demo-backend/test/routes/info.test.ts`, `demo-backend/test/routes/demo-sessions.test.ts`
- Modificar: `e2e/demo-onboarding.spec.ts` (la vuelta del alta pasa de links a formulario)

**Interfaces:**
- Produce: `GET /_demo/onboarding/complete?return_url&wipe_key&company&with_key=1|0` → `302` a
  `<return_url>#connect=<base64url>` después de guardar la empresa; el formulario de
  `/_demo/onboarding` con el campo "Nombre del comercio" y los botones "Crear comercio y volver al POS"
  (`with_key=1`) y "Volver sin wipe_key" (`with_key=0`).

- [ ] **Paso 1: tests de `/info`** — en `demo-backend/test/routes/info.test.ts`: el test
  "informa el contrato 4.4.0…" pasa a 4.5.0 (`contractVersion` y `backend.version`), sin `company`
  (la key `demo-token` no es de demo y no hay empresa cargada). Sumar:

```ts
  it('con la key del comercio manda la empresa del alta (4.5.0)', async () => {
    setCompanyName(db, 'Almacén Rosa');
    expect(await info()).toMatchObject({ company: { name: 'Almacén Rosa' } });
  });
```

  y en `demo-sessions.test.ts`, al lado de los tests de `getInfo(apiKey)`:

```ts
  it('/info con la key de una demo manda el nombre de la demo según la plantilla (4.5.0)', async () => {
    const created = await createDemo({ template: 'almacen' });
    const { apiKey } = (await created.json()) as { apiKey: string };
    const body = (await (await getInfo(apiKey)).json()) as { company?: { name: string } };
    expect(body.company).toEqual({ name: 'Almacén de demo' });
  });
```

- [ ] **Paso 2: tests de la página de alta** — reemplazar `decodeConnect` y el test "arma la vuelta con
  #connect, con y sin el wipe_key" por:

```ts
  function decodeLocation(response: Response): unknown {
    const location = response.headers.get('location') ?? '';
    const encoded = /#connect=(.+)$/.exec(location)?.[1];
    expect(encoded).toBeDefined();
    return encoded === undefined
      ? undefined
      : (JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as unknown);
  }

  function complete(params: Record<string, string>): Promise<Response> {
    return fetch(`${baseUrl}/_demo/onboarding/complete?${new URLSearchParams(params).toString()}`, {
      redirect: 'manual',
    });
  }

  it('el formulario pide el nombre del comercio y lleva lo recibido', async () => {
    const html = await (
      await fetch(
        `${baseUrl}/_demo/onboarding?return_url=${encodeURIComponent('http://localhost:4173/')}&wipe_key=k1`,
      )
    ).text();
    expect(html).toContain('Nombre del comercio');
    expect(html).toContain('action="/_demo/onboarding/complete"');
    expect(html).toContain('value="http://localhost:4173/"');
    expect(html).toContain('value="k1"');
  });

  it('completar guarda la empresa y vuelve con #connect, con y sin el wipe_key', async () => {
    const connection = { baseUrl, apiKey: 'demo-api-key', branch: 'CENTRAL', pointOfSale: 'Caja 1' };
    const base = { return_url: 'http://localhost:4173/', wipe_key: 'k1', company: ' Almacén Rosa ' };

    const withKey = await complete({ ...base, with_key: '1' });
    expect(withKey.status).toBe(302);
    expect(withKey.headers.get('location')).toMatch(/^http:\/\/localhost:4173\/#connect=/);
    expect(decodeLocation(withKey)).toEqual({ ...connection, wipeKey: 'k1' });
    expect(getCompanyName(db)).toBe('Almacén Rosa');

    expect(decodeLocation(await complete({ ...base, with_key: '0' }))).toEqual(connection);
  });

  it('sin nombre, el comercio queda sin empresa', async () => {
    setCompanyName(db, 'Viejo');
    await complete({ return_url: 'http://localhost:4173/', company: '', with_key: '1' });
    expect(getCompanyName(db)).toBeUndefined();
  });

  it('completar sin return_url no redirige', async () => {
    const response = await complete({ company: 'x', with_key: '1' });
    expect(response.status).toBe(400);
  });
```

  Los tests "escapa lo que recibe" y "sin return_url no ofrece volver" quedan; el segundo pasa a
  `expect(html).not.toContain('<form')`. El header `X-POS-Contract-Version` de los helpers del archivo
  puede quedar en `'4.4.0'` (mismo major). Correr `pnpm test:backend` → FALLAN.

- [ ] **Paso 3: implementación**:
  - `settings.ts`: `CONTRACT_VERSION = '4.5.0'` (y sumar 4.5.0, #193, al comentario), y:

```ts
/** Plantilla de la demo en curso (#193): `/info` arma con ella el nombre de la demo. */
export function getDemoTemplate(db: DatabaseSync): string | undefined {
  return readSetting(db, 'demoTemplate');
}

export function setDemoTemplate(db: DatabaseSync, template: string): void {
  writeSetting(db, 'demoTemplate', template);
}

/** Nombre del comercio cargado en el alta (#193); `undefined` = no se cargó. */
export function getCompanyName(db: DatabaseSync): string | undefined {
  return readSetting(db, 'companyName');
}

/** Un nombre vacío borra la empresa: el comercio queda sin `company` en `/info`. */
export function setCompanyName(db: DatabaseSync, name: string): void {
  const trimmed = name.trim();
  if (trimmed === '') {
    db.prepare('DELETE FROM demo_settings WHERE key = ?').run('companyName');
  } else {
    writeSetting(db, 'companyName', trimmed);
  }
}
```

    (los dos viven en `demo_settings`, así que `resetToSeed` los borra con cada demo nueva: la base es
    de un solo comercio).
  - `seed.ts`, al lado de `TEMPLATES`:

```ts
/** Nombre de la empresa de cada demo, para `/info` (4.5.0, #193). */
export const DEMO_COMPANY_NAMES: Record<TemplateName, string> = {
  kiosco: 'Kiosco de demo',
  almacen: 'Almacén de demo',
};
```

  - `demo-keys.ts`:

```ts
/** Una key emitida por `POST /demo-sessions` (#193: `/info` manda el nombre de la demo). */
export function isDemoKey(db: DatabaseSync, key: string | undefined): boolean {
  if (key === undefined) {
    return false;
  }
  return db.prepare('SELECT 1 AS found FROM demo_keys WHERE key = ?').get(key) !== undefined;
}
```

  - `router.ts`: `RouteContext` suma `/** El token del `Authorization` (#193); `undefined` si falta. */ token: string | undefined;`
    y el handler recibe `{ db, params: …, url, token: bearerToken(req) }`.
  - `routes/info.ts`:

```ts
/** La empresa de la key (4.5.0, #193): la de la demo, o la que se cargó en el alta. */
function companyFor(ctx: RouteContext): { name: string } | undefined {
  if (isDemoKey(ctx.db, ctx.token)) {
    const template = getDemoTemplate(ctx.db);
    return {
      name: DEMO_COMPANY_NAMES[
        template !== undefined && isTemplateName(template) ? template : DEFAULT_TEMPLATE
      ],
    };
  }
  const name = getCompanyName(ctx.db);
  return name === undefined ? undefined : { name };
}
```

    y en la respuesta, `...(company !== undefined ? { company } : {})` con
    `const company = companyFor(ctx);`. Comentario de la ruta: "4.5.0 (#193): también la empresa".
  - `routes/demo-sessions.ts`:
    - En `POST /demo-sessions`, después de `resetToSeed(...)`: `setDemoTemplate(ctx.db, requested);`.
    - `renderOnboardingPage`: en lugar de los dos links, un formulario:

```ts
  const hidden = (name: string, value: string | null): string =>
    value === null || value === ''
      ? ''
      : `<input type="hidden" name="${name}" value="${escapeHtml(value)}" />`;
  return onboardingHtml.replace(
    '{{content}}',
    `${received}<form method="get" action="/_demo/onboarding/complete">${hidden('return_url', returnUrl)}${hidden('wipe_key', wipeKey)}<label>Nombre del comercio <input name="company" autofocus /></label><p class="actions"><button type="submit" name="with_key" value="1">Crear comercio y volver al POS</button><button type="submit" name="with_key" value="0">Volver sin wipe_key</button></p></form>`,
  );
```

    - Extraer el armado de `connect` a una función de módulo
      `connectFragment(origin: string, wipeKey: string | null): string` (la de hoy, con `withKey`
      resuelto por quien la llama) y sumar la ruta:

```ts
  {
    // La vuelta del alta falsa (#193): guarda el nombre del comercio y vuelve al POS con la conexión.
    method: 'GET',
    pattern: /^\/_demo\/onboarding\/complete$/,
    requiresAuth: false,
    handler: (req, res, ctx) => {
      const returnUrl = ctx.url.searchParams.get('return_url');
      if (returnUrl === null || returnUrl === '') {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(onboardingHtml.replace('{{content}}', '<p>Falta return_url.</p>'));
        return;
      }
      setCompanyName(ctx.db, ctx.url.searchParams.get('company') ?? '');
      const wipeKey =
        ctx.url.searchParams.get('with_key') === '1' ? ctx.url.searchParams.get('wipe_key') : null;
      res.writeHead(302, {
        Location: `${returnUrl}#connect=${connectFragment(requestOrigin(req), wipeKey)}`,
      });
      res.end();
    },
  },
```

    - Ajustar el texto de `onboarding.html` ("Esta vuelve con la de la demo") a: "Esta guarda el
      nombre del comercio y vuelve con una conexión fija."
- [ ] **Paso 4:** `pnpm test:backend && pnpm typecheck:backend` → verde.

- [ ] **Paso 5: e2e** — en `e2e/demo-onboarding.spec.ts`, las dos vueltas del alta:

```ts
  await page.getByLabel('Nombre del comercio').fill('Almacén Rosa');
  await page.getByRole('button', { name: 'Crear comercio y volver al POS' }).click();
```

  y

```ts
  await page.getByRole('button', { name: 'Volver sin wipe_key' }).click();
```

  (buscar otros `getByRole('link', { name: 'Crear comercio…' })` o `'Volver sin wipe_key'` en `e2e/`
  y cambiarlos igual). En el primer test, sumar el circuito de la empresa:

```ts
  // antes de /ALTA:
  await expect(page.getByText('Caja 1 - CENTRAL - Kiosco de demo')).toBeVisible();
  await expect(page).toHaveTitle('Caja 1 - CENTRAL');
  // después de volver del alta:
  await expect(page.getByText('Caja 1 - CENTRAL - Almacén Rosa')).toBeVisible();
```

- [ ] **Paso 6:** `pnpm build && pnpm test:e2e e2e/demo-onboarding.spec.ts` → verde.

- [ ] **Paso 7: commit**

```bash
git add -A demo-backend e2e
git commit -m "feat(demo-backend): 4.5.0, la empresa de la demo y la del alta en GET /info (#193)"
```

---

### Tarea 6: documentación y verificación completa

**Archivos:**
- Modificar: `AGENTS.md` (versión 4.5.0 en "Connector API"; el demo-backend como referencia
  ejecutable de un backend)
- Modificar: `src/sync/AGENTS.md` ("Contrato: qué trajo cada versión": 4.5.0; empresa en "Log de
  intentos y `/DIAGNOSTICO`" y en "Ciclo de vida de la conexión: aplicar")
- Modificar: `src/ui/AGENTS.md` ("Barra de estado": dos líneas y título de la pestaña)

- [ ] **Paso 1: `AGENTS.md`**:
  - En "Connector API", "**versión 4.4.0** desde #128" pasa a "**versión 4.5.0** desde #193
    (`company` opcional en `GET /info`, spec
    `docs/superpowers/specs/2026-10-03-empresa-sucursal-y-caja-design.md`); la 4.4.0 es de #128, la
    última antes del MVP (…)" — conservar el resto de la cadena de versiones.
  - En la estructura (`demo-backend/`) y en "Qué backends acompañan un cambio de contrato": aclarar
    que el demo-backend **no es un backend para demos del POS**: es la referencia ejecutable de lo que
    debe hacer un backend, y el circuito de demo y alta (`POST /demo-sessions`, página de alta, key
    del comercio) es una parte más de esa referencia. El nombre de la carpeta queda.
- [ ] **Paso 2: `src/sync/AGENTS.md`** — al principio de "Contrato: qué trajo cada versión":

```md
**Contrato 4.5.0 (#193)** — aditivo: `GET /info` suma `company: { name }` opcional, el comercio de
la key. El POS la guarda como las capacidades (`sync/backend-company.ts`, `localStorage` por carpeta
y `backendCompanySignal`): la actualiza con cada `/info` exitoso, la toma de la prueba al aplicar una
conexión y la borra si el backend deja de mandarla. Mal formada o vacía cuenta como ausente. No es
una capacidad. El demo-backend la manda (el nombre de la demo con una key de demo, el del alta con la
del comercio); el puente de Sheets no, y sigue compatible por el piso.
```

  y sumar "empresa" donde hoy dice que `/DIAGNOSTICO` muestra las capacidades y donde
  `applyConnection` reemplaza capacidades y avisos por los de la prueba.
- [ ] **Paso 3: `src/ui/AGENTS.md`**, en "Barra de estado": la barra tiene dos líneas. La primera
  (`data-testid="status-bar-context"`) lleva la marca DEMO, `<caja> - <sucursal> - <empresa>`
  (`ui/terminal-context.ts::terminalContextText`, con `terminalIdentitySignal` y
  `backendCompanySignal`) y a la derecha el botón de la demo; se recorta el contexto, nunca el botón.
  La segunda, el estado de sync con Avisos y Sin arqueo. El título de la pestaña es `<caja> -
  <sucursal>` (`startTerminalTitle`, desde `main.tsx`), también en las pantallas sin barra.
- [ ] **Paso 4: verificación completa**:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:backend && pnpm typecheck:backend && pnpm build && pnpm test:e2e
```

  Todo verde (si aparece un flake conocido — #155, #169, #142 —, reintentarlo una vez y anotarlo en el
  informe).
- [ ] **Paso 5: commit**

```bash
git add -A AGENTS.md src/sync/AGENTS.md src/ui/AGENTS.md
git commit -m "docs: empresa, sucursal y caja a la vista y contrato 4.5.0 (#193)"
```

- [ ] **Paso 6: informe final** con la prueba manual (convención del repo): con `pnpm backend` y
  `pnpm dev`, abrir el link de demo, ver la línea `DEMO  Caja 1 - CENTRAL - Kiosco de demo  [Crear mi
  comercio (/ALTA)]` y el título `Caja 1 - CENTRAL`; `/ALTA`, cargar "Almacén Rosa", "Crear comercio
  y volver al POS", y ver `Caja 1 - CENTRAL - Almacén Rosa` sin DEMO; `/DIAGNOSTICO` con "Empresa:
  Almacén Rosa"; `/CAJA` con el título igual.

## Después del merge (fuera de este plan)

- Issue en rauldiazsolis/mini-erp: mandar `company: { name: <nombre del tenant> }` en
  `GET /connector/info` (opcional, 4.5.0).
- Cerrar #193 con el PR y sumarlo a la tabla de "Estado del proyecto" y a `docs/historia.md`.
