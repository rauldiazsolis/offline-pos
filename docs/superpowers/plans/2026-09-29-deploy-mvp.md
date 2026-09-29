# Deploy del MVP — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: `superpowers:executing-plans` (inline, tarea por tarea con
> checkpoints — convención del repo, ver `AGENTS.md` "Cómo trabajamos"). Los pasos usan checkboxes
> (`- [ ]`).

**Objetivo:** publicar el POS en carpetas inmutables por versión (`/<x.y.z>/`) con almacenamiento
aislado por ruta, una página `/versions` generada a partir de los backends conocidos consultados en
vivo, docs para integradores (humanos e IA), zip por versión, y deploy por tag a una rama `publish`
que sirve Cloudflare Pages.

**Arquitectura:** en la app solo cambian tres cosas: el nombre del almacenamiento pasa a derivarse
de `location.pathname` (`storage/storage-namespace.ts`, `/` sigue siendo `offline-pos`), el build
pasa a `base: './'`, y `/DIAGNOSTICO` muestra versión y almacenamiento. Todo lo de publicación vive
en `site/` (scripts TypeScript que corre Node 24 sin compilar, fuera de `src/`), más una GitHub
Action que acumula versiones en la rama `publish`. El demo-backend contesta el preflight de red
privada.

**Stack:** Preact + Vite 8, Dexie, Vitest 5 + Testing Library, Playwright; Node 24 (type
stripping) para `site/`; `marked` (devDependency, sin dependencias propias) para la guía en HTML;
demo-backend Node + `node:sqlite`; GitHub Actions; Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-09-29-deploy-mvp-design.md`.

## Restricciones globales

- Todo en español: comentarios, commits, textos de UI y docs; identificadores en inglés como el resto.
- `any` prohibido; funciones de negocio devuelven `Result<T>`. **`site/` es tooling de publicación,
  no negocio**: sus errores se lanzan con un mensaje claro (una publicación con datos malos tiene
  que fallar y cortar la Action), pero todo dato externo (`backends.json`, `version.json`, respuestas
  HTTP) se valida con Zod.
- En `/` nada cambia: base `offline-pos`, claves `offline-pos:<nombre>` con los mismos nombres de hoy.
- Primera versión: `0.1.0`. Contrato: sigue en `4.4.0` (`POS_CONTRACT_VERSION`), piso `4.0.0`
  (`MIN_BACKEND_CONTRACT`).
- La app nunca importa nada de `site/`. `site/` sí puede importar módulos puros de `src/`
  (`domain/contract-version.ts`, `sync/demo-session.ts`, `sync/connector.ts`, `sync/demo-link.ts`).
- No tocar `mini-erp/` ni el conector de Sheets.
- pnpm solo desde PowerShell; `gh` desde Bash con `-R rauldiazsolis/offline-pos`; mensajes de
  commit con comillas o backticks por archivo (`git commit -F`) o heredoc en Bash. Todo commit
  termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Formatear con Prettier solo los archivos tocados (`pnpm exec prettier --write <archivos>`; el repo
  en general no pasa `format:check`, #135).
- Si `pnpm test` termina con un `DatabaseClosedError` sin manejar pero todos los tests pasan, volver
  a correr (#142).
- Verificación local de cada tarea que toca código:
  `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }` (PowerShell),
  más `pnpm test:e2e` donde se indica.

---

### Task 0: Preparar el worktree

**Files:** ninguno nuevo.

- [ ] **Step 1: Instalar dependencias**

Run (PowerShell): `pnpm install --frozen-lockfile`
Expected: termina sin errores.

- [ ] **Step 2: Formatear el spec y el plan (se commitearon sin Prettier)**

Run: `pnpm exec prettier --write docs/superpowers/specs/2026-09-29-deploy-mvp-design.md docs/superpowers/plans/2026-09-29-deploy-mvp.md`

- [ ] **Step 3: Línea de base verde**

Run: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }`
Expected: todo pasa (si falla antes de tocar nada, frenar y avisar).

- [ ] **Step 4: Commit (si Prettier cambió algo)**

```bash
git add docs/superpowers
git commit -m "docs: formato del spec y el plan del deploy (#148)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Almacenamiento aislado por carpeta

**Files:**
- Create: `src/storage/storage-namespace.ts`
- Create: `src/storage/storage-namespace.test.ts`
- Create: `src/storage/storage-keys.test.ts`
- Modify: `src/storage/db.ts` (constructor, `super('offline-pos')`)
- Modify: `src/sync/terminal-data.ts:10-15` (`LOCAL_STORAGE_PREFIX` pasa a importarse)
- Modify: `src/sync/terminal-data.test.ts` (test de aislamiento)
- Modify (clave fija → `storageKey`): `src/sync/config.ts:60`, `src/sync/cursor.ts:11-13`,
  `src/sync/push-lot.ts:11-12`, `src/sync/backend-capabilities.ts:12`,
  `src/sync/backend-notices.ts:10`, `src/sync/cleanup-schedule.ts:12`,
  `src/sync/receipt-counter.ts:10`, `src/sync/ticket-counter.ts:11`,
  `src/sync/terminal-identity.ts:8`, `src/sync/wipe-key.ts:8`

**Interfaces:**
- Produces:
  - `storageNamespaceFor(pathname: string): string`
  - `localStoragePrefixFor(pathname: string): string`
  - `STORAGE_NAMESPACE: string` (calculado una vez desde `window.location.pathname`)
  - `LOCAL_STORAGE_PREFIX: string` (= `STORAGE_NAMESPACE + ':'`)
  - `storageKey(name: string): string`

- [ ] **Step 1: Tests de la función pura (fallan)**

`src/storage/storage-namespace.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from './db.ts';
import {
  localStoragePrefixFor,
  STORAGE_NAMESPACE,
  storageKey,
  storageNamespaceFor,
} from './storage-namespace.ts';

describe('storageNamespaceFor (#148)', () => {
  it('en la raíz sigue siendo offline-pos: las terminales actuales no se enteran', () => {
    expect(storageNamespaceFor('/')).toBe('offline-pos');
    expect(storageNamespaceFor('/index.html')).toBe('offline-pos');
  });

  it('en una carpeta lleva la carpeta, con o sin index.html', () => {
    expect(storageNamespaceFor('/0.1.0/')).toBe('offline-pos@/0.1.0/');
    expect(storageNamespaceFor('/0.1.0/index.html')).toBe('offline-pos@/0.1.0/');
    expect(storageNamespaceFor('/pos/0.1.0/')).toBe('offline-pos@/pos/0.1.0/');
  });

  it('sin barra final la carpeta es la de arriba (la app no llega a cargar: sus assets dan 404)', () => {
    expect(storageNamespaceFor('/0.1.0')).toBe('offline-pos');
  });

  it('el prefijo de una carpeta nunca abarca las claves de otra', () => {
    const folders = ['/', '/0.1.0/', '/0.1.0/sub/', '/0.1.1/', '/pos/0.1.0/'];
    for (const a of folders) {
      for (const b of folders) {
        if (a === b) {
          continue;
        }
        const keyOfB = `${localStoragePrefixFor(b)}sync-config`;
        expect(keyOfB.startsWith(localStoragePrefixFor(a))).toBe(false);
      }
    }
  });
});

describe('en jsdom (servido en /)', () => {
  it('el namespace, las claves y la base son los de siempre', () => {
    expect(STORAGE_NAMESPACE).toBe('offline-pos');
    expect(storageKey('sync-config')).toBe('offline-pos:sync-config');
    expect(db.name).toBe('offline-pos');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `pnpm exec vitest run src/storage/storage-namespace.test.ts`
Expected: FAIL (no existe `./storage-namespace.ts`).

- [ ] **Step 3: Implementar el módulo**

`src/storage/storage-namespace.ts`:

```ts
const BASE_NAME = 'offline-pos';

/**
 * Nombre del almacenamiento local de la carpeta donde se sirve el POS (#148): carpetas del mismo
 * origen comparten IndexedDB y `localStorage`, así que cada versión publicada (`/0.1.0/`) usa el
 * suyo. La carpeta es todo `pathname` hasta la última `/`. En la raíz sigue siendo `offline-pos`,
 * como antes de #148: las terminales servidas en `/` no se enteran.
 */
export function storageNamespaceFor(pathname: string): string {
  const folder = pathname.slice(0, pathname.lastIndexOf('/') + 1);
  return folder === '/' || folder === '' ? BASE_NAME : `${BASE_NAME}@${folder}`;
}

/** Prefijo de las claves de `localStorage`; el `:` final evita que una carpeta abarque a otra. */
export function localStoragePrefixFor(pathname: string): string {
  return `${storageNamespaceFor(pathname)}:`;
}

/** Se calcula una vez al cargar: la carpeta no cambia sin recargar la página. */
export const STORAGE_NAMESPACE = storageNamespaceFor(window.location.pathname);

/**
 * Todo lo que la app guarda en `localStorage` lleva este prefijo. Borrar/volcar por prefijo, no por
 * una lista de claves escrita a mano (`sync/terminal-data.ts`): una clave futura queda incluida sola.
 */
export const LOCAL_STORAGE_PREFIX = `${STORAGE_NAMESPACE}:`;

/** Clave de `localStorage` de esta carpeta. Nadie escribe `'offline-pos:…'` a mano. */
export function storageKey(name: string): string {
  return `${LOCAL_STORAGE_PREFIX}${name}`;
}
```

- [ ] **Step 4: Dexie con el namespace**

En `src/storage/db.ts`: `import { STORAGE_NAMESPACE } from './storage-namespace.ts';` y en el
constructor `super(STORAGE_NAMESPACE);` (en lugar de `super('offline-pos')`). Sumar al comentario
de la clase: "El nombre de la base depende de la carpeta (#148, `storage-namespace.ts`)".

- [ ] **Step 5: Correr el test**

Run: `pnpm exec vitest run src/storage/storage-namespace.test.ts`
Expected: PASS.

- [ ] **Step 6: Test guardián de las claves (falla)**

`src/storage/storage-keys.test.ts`:

```ts
// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #148: las claves de `localStorage` pasan por `storageKey`, así en `/` quedan exactamente como
 * antes (`offline-pos:<nombre>`) y en una carpeta se aíslan. Este test lee el código: cada nombre
 * de hoy sigue usándose y ninguna clave con el prefijo escrito a mano volvió.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));

const LEGACY_NAMES = [
  'sync-config',
  'sync-cursor:products',
  'sync-cursor:customers',
  'sync:last-full',
  'sync:push-lot',
  'sync:push-lot-awaiting',
  'backend-capabilities',
  'backend-notices',
  'cleanup:last-run',
  'receipt-counter',
  'ticket-counter',
  'device-id',
  'pending-wipe-key',
];

function sources(): { path: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => ({ path: file, text: readFileSync(join(SRC, file), 'utf8') }));
}

describe('claves de localStorage (#148)', () => {
  it('cada nombre de antes de #148 sigue pasando por storageKey', () => {
    const all = sources()
      .map((source) => source.text)
      .join('\n');
    for (const name of LEGACY_NAMES) {
      expect(all).toContain(`storageKey('${name}')`);
    }
  });

  it("ningún archivo escribe el prefijo 'offline-pos:' a mano", () => {
    const offenders = sources()
      .filter((source) => source.text.includes("'offline-pos:"))
      .map((source) => source.path);
    expect(offenders).toEqual([]);
  });
});
```

Run: `pnpm exec vitest run src/storage/storage-keys.test.ts`
Expected: FAIL (los 13 nombres todavía son literales).

- [ ] **Step 7: Migrar las claves**

En cada archivo, importar `storageKey` de `'../storage/storage-namespace.ts'` y reemplazar el
literal por la llamada, con el mismo nombre:

| Archivo | Antes | Después |
|---|---|---|
| `sync/config.ts` | `'offline-pos:sync-config'` | `storageKey('sync-config')` |
| `sync/cursor.ts` | `'offline-pos:sync-cursor:products'` | `storageKey('sync-cursor:products')` |
| `sync/cursor.ts` | `'offline-pos:sync-cursor:customers'` | `storageKey('sync-cursor:customers')` |
| `sync/cursor.ts` | `'offline-pos:sync:last-full'` | `storageKey('sync:last-full')` |
| `sync/push-lot.ts` | `'offline-pos:sync:push-lot'` | `storageKey('sync:push-lot')` |
| `sync/push-lot.ts` | `'offline-pos:sync:push-lot-awaiting'` | `storageKey('sync:push-lot-awaiting')` |
| `sync/backend-capabilities.ts` | `'offline-pos:backend-capabilities'` | `storageKey('backend-capabilities')` |
| `sync/backend-notices.ts` | `'offline-pos:backend-notices'` | `storageKey('backend-notices')` |
| `sync/cleanup-schedule.ts` | `'offline-pos:cleanup:last-run'` | `storageKey('cleanup:last-run')` |
| `sync/receipt-counter.ts` | `'offline-pos:receipt-counter'` | `storageKey('receipt-counter')` |
| `sync/ticket-counter.ts` | `'offline-pos:ticket-counter'` | `storageKey('ticket-counter')` |
| `sync/terminal-identity.ts` | `'offline-pos:device-id'` | `storageKey('device-id')` |
| `sync/wipe-key.ts` | `'offline-pos:pending-wipe-key'` | `storageKey('pending-wipe-key')` |

En `sync/terminal-data.ts`: borrar la constante `LOCAL_STORAGE_PREFIX` y su comentario (líneas
10-15) e importarla de `'../storage/storage-namespace.ts'`. En su JSDoc de `resetTerminal`,
"todas las claves `offline-pos:*`" pasa a "todas las claves de esta carpeta
(`LOCAL_STORAGE_PREFIX`)". En `receipt-counter.ts` y `ticket-counter.ts`, el comentario
"(prefijo `offline-pos:`)" pasa a "(prefijo de `storage-namespace.ts`)".

Los tests que usan literales `'offline-pos:…'` (por ejemplo `e2e/fixtures.ts`, tests de
`src/sync/`) no cambian: corren en `/`, donde la clave es la misma.

- [ ] **Step 8: Test de aislamiento en `terminal-data.test.ts`**

Agregar, siguiendo el `beforeEach`/`afterEach` que ya tiene el archivo (sync despausado, tablas
vacías):

```ts
it('pos.reset() y pos.export() no tocan las claves de otra carpeta (#148)', async () => {
  localStorage.setItem('offline-pos@/0.1.0/:sync-config', '{"x":1}');
  localStorage.setItem('offline-pos:ticket-counter', '{"date":"2026-09-29","last":3}');

  const dump = await exportLocalData('2026-09-29T00:00:00.000Z');
  expect(Object.keys(dump.localStorage)).toEqual(['offline-pos:ticket-counter']);

  expect((await resetTerminal()).ok).toBe(true);
  expect(localStorage.getItem('offline-pos@/0.1.0/:sync-config')).toBe('{"x":1}');
  expect(localStorage.getItem('offline-pos:ticket-counter')).toBeNull();
  localStorage.removeItem('offline-pos@/0.1.0/:sync-config');
});
```

(Si el archivo ya siembra otras claves en su `beforeEach`, ajustar el `toEqual` para que compare
solo la ausencia de la clave de la otra carpeta: `expect(dump.localStorage).not.toHaveProperty(…)`.)

- [ ] **Step 9: Verificación completa**

Run: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }`
Expected: todo pasa, incluidos los dos tests nuevos.

- [ ] **Step 10: Formatear y commit**

```bash
pnpm exec prettier --write src/storage src/sync
git add src/storage src/sync
git commit -m "feat(storage): almacenamiento aislado por carpeta; en / no cambia nada (#148)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `/DIAGNOSTICO` muestra versión y almacenamiento

**Files:**
- Create: `src/pos-version.d.ts`
- Modify: `vite.config.ts` (`define`)
- Modify: `src/sync/diagnostics.ts` (tipo `SyncDiagnostics` y `collectDiagnostics`)
- Modify: `src/ui/screens/diagnostico-screen.tsx` (línea bajo el título)
- Modify: `src/ui/screens/diagnostico-screen.test.tsx` (fixture y test)
- Modify: cualquier otro fixture de `SyncDiagnostics` que el typecheck marque (p. ej. tests de `ui/console/`)

**Interfaces:**
- Consumes: `STORAGE_NAMESPACE` (Task 1).
- Produces: `SyncDiagnostics.posVersion: string`, `SyncDiagnostics.storageNamespace: string`;
  constante global `__POS_VERSION__: string` (definida por Vite desde `package.json`).

- [ ] **Step 1: Test de la pantalla (falla)**

En `diagnostico-screen.test.tsx`, sumar al fixture `diagnostics`:

```ts
  posVersion: '0.1.0',
  storageNamespace: 'offline-pos@/0.1.0/',
```

y un test:

```ts
it('muestra la versión del POS y el almacenamiento de esta carpeta (#148)', () => {
  render(<DiagnosticoScreen />);
  expect(screen.getByText(/POS 0\.1\.0/)).not.toBeNull();
  expect(screen.getByText('offline-pos@/0.1.0/')).not.toBeNull();
});
```

Run: `pnpm exec vitest run src/ui/screens/diagnostico-screen.test.tsx`
Expected: FAIL (typecheck de Vitest no corre, pero el texto no aparece).

- [ ] **Step 2: La constante de versión**

`src/pos-version.d.ts`:

```ts
/** Versión del POS (`package.json`), definida por Vite al compilar (`vite.config.ts`, #148). */
declare const __POS_VERSION__: string;
```

`vite.config.ts`:

```ts
import { readFileSync } from 'node:fs';
import preact from '@preact/preset-vite';
import { defaultExclude, defineConfig } from 'vitest/config';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  // Versión visible en /DIAGNOSTICO (#148). Vitest usa el mismo `define`.
  define: { __POS_VERSION__: JSON.stringify(version) },
  test: {
    // …sin cambios…
  },
});
```

- [ ] **Step 3: Diagnóstico**

En `src/sync/diagnostics.ts`: `import { STORAGE_NAMESPACE } from '../storage/storage-namespace.ts';`,
sumar al tipo:

```ts
  /** Versión del POS (`package.json`, #148). */
  posVersion: string;
  /** Nombre del almacenamiento local de esta carpeta (#148, `storage/storage-namespace.ts`). */
  storageNamespace: string;
```

y a `collectDiagnostics`: `posVersion: __POS_VERSION__, storageNamespace: STORAGE_NAMESPACE,`.

- [ ] **Step 4: La línea en la pantalla**

En `diagnostico-screen.tsx`, envolver el `<h1>` en un `<div>` y sumar debajo:

```tsx
<div>
  <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>Diagnóstico de sincronización</h1>
  <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
    POS {diagnostics.posVersion} · almacenamiento{' '}
    <span style={monoStyle}>{diagnostics.storageNamespace}</span>
  </p>
</div>
```

- [ ] **Step 5: Correr el test y el typecheck**

Run: `pnpm exec vitest run src/ui/screens/diagnostico-screen.test.tsx; if ($?) { pnpm typecheck }`
Expected: PASS; si el typecheck marca otros fixtures de `SyncDiagnostics`, sumarles los dos campos.

- [ ] **Step 6: Verificación completa, formato y commit**

Run: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }`

```bash
pnpm exec prettier --write vite.config.ts src/pos-version.d.ts src/sync/diagnostics.ts src/ui/screens/diagnostico-screen.tsx src/ui/screens/diagnostico-screen.test.tsx
git add -A vite.config.ts src
git commit -m "feat(diagnostico): versión del POS y almacenamiento de la carpeta (#148)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `base: './'`

**Files:**
- Modify: `vite.config.ts`
- Modify (solo si hace falta, ver Step 3): `index.html`

- [ ] **Step 1: Cambiar la base**

En `vite.config.ts`, dentro de `defineConfig`, antes de `plugins`:

```ts
  // Rutas relativas (#148): el mismo build anda en /, en /0.1.0/ o en cualquier carpeta de quien
  // copie el zip. Revisa la decisión de #128 de dejar '/'.
  base: './',
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: termina sin errores.

- [ ] **Step 3: Revisar `dist/index.html`**

Run (Bash): `grep -o 'href="[^"]*"\|src="[^"]*"' dist/index.html`
Expected: todo relativo (`./assets/…`, `./favicon.svg`). Si el favicon quedó como `/favicon.svg`,
cambiar en `index.html` `href="/favicon.svg"` por `href="./favicon.svg"`, volver a construir y
revisar de nuevo.

- [ ] **Step 4: El e2e de siempre sigue en verde (sirve en `/`)**

Run: `pnpm test:e2e`
Expected: PASS (la suite corre en `/`: prueba que la raíz no cambió).

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write vite.config.ts
git add vite.config.ts index.html
git commit -m "build: base relativa para servir el POS desde cualquier carpeta (#148)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Demo-backend contesta el preflight de red privada

**Files:**
- Modify: `demo-backend/src/router.ts` (rama `OPTIONS` de `handleRequest`, y su comentario de CORS)
- Modify: `demo-backend/test/app.test.ts`

- [ ] **Step 1: Tests (fallan)**

En `demo-backend/test/app.test.ts`, sumar `import { request, type IncomingHttpHeaders } from 'node:http';`
y dentro del `describe`:

```ts
  // `fetch` de Node puede filtrar los headers `Access-Control-Request-*`: el preflight va con
  // `node:http`, como lo manda el navegador.
  function preflight(headers: Record<string, string>): Promise<IncomingHttpHeaders> {
    return new Promise((resolve, reject) => {
      const req = request(`${baseUrl}/info`, { method: 'OPTIONS', headers }, (res) => {
        res.resume();
        resolve(res.headers);
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('contesta el preflight de red privada de Chrome (#148)', async () => {
    const headers = await preflight({
      Origin: 'https://offline-pos.pages.dev',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Private-Network': 'true',
    });
    expect(headers['access-control-allow-private-network']).toBe('true');
  });

  it('sin el pedido de red privada no lo manda', async () => {
    const headers = await preflight({
      Origin: 'https://offline-pos.pages.dev',
      'Access-Control-Request-Method': 'GET',
    });
    expect(headers['access-control-allow-private-network']).toBeUndefined();
  });
```

Run (PowerShell): `pnpm --filter demo-backend run test`
Expected: FAIL en el primero.

- [ ] **Step 2: Implementar**

En `router.ts`, rama `OPTIONS`:

```ts
  if (method === 'OPTIONS') {
    // Una página pública (el POS en pages.dev) que llama a localhost: Chrome pide permiso de red
    // local, y algunos Chromium todavía mandan este preflight de Private Network Access (#148).
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    res.writeHead(204);
    res.end();
    return;
  }
```

- [ ] **Step 3: Tests y typecheck del backend**

Run: `pnpm --filter demo-backend run test; if ($?) { pnpm --filter demo-backend run typecheck }`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
pnpm exec prettier --write demo-backend/src/router.ts demo-backend/test/app.test.ts
git add demo-backend
git commit -m "feat(demo-backend): contesta el preflight de red privada (#148)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs para integradores y OpenAPI sin referencias internas

**Files:**
- Modify: `docs/connector-api.openapi.yaml` (solo `description`s)
- Create: `docs/integradores/guia.md`
- Create: `docs/integradores/llms.txt`
- Create: `site/docs.test.ts`

**Interfaces:**
- Produces: `docs/integradores/guia.md` empieza con `# Guía para integradores` y enlaza al OpenAPI
  como `../connector-api.openapi.yaml` (Task 7 reescribe ese link al publicar). `llms.txt` enlaza
  `guia.md`, `index.html` y `../connector-api.openapi.yaml`.

- [ ] **Step 1: Test guardián (falla)**

`site/docs.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('docs publicadas para integradores (#148)', () => {
  it('el OpenAPI no manda a un integrador a issues, specs ni archivos internos', () => {
    const openapi = read('../docs/connector-api.openapi.yaml');
    expect(openapi).not.toMatch(/#\d+/);
    expect(openapi).not.toMatch(/superpowers|AGENTS\.md|pos-web-diseno|historia\.md/);
  });

  it('la guía y llms.txt existen y enlazan al OpenAPI', () => {
    const guide = read('../docs/integradores/guia.md');
    expect(guide.startsWith('# Guía para integradores')).toBe(true);
    expect(guide).toContain('../connector-api.openapi.yaml');
    expect(read('../docs/integradores/llms.txt')).toContain('../connector-api.openapi.yaml');
  });
});
```

Run: `pnpm exec vitest run site/docs.test.ts`
Expected: FAIL.

- [ ] **Step 2: Limpiar el OpenAPI**

Run (Bash): `grep -nE "#[0-9]+|superpowers|AGENTS\.md|pos-web-diseno|historia\.md" docs/connector-api.openapi.yaml`

Por cada línea: quitar la referencia interna reescribiendo la frase para que se entienda sola (p. ej.
"`4.4.0 respecto de 4.3.0** (aditivo, #128)`" → "`4.4.0 respecto de 4.3.0** (aditivo)`"; el
párrafo de `info.description` que lista specs e issues se reemplaza por una frase: "Contrato que
cualquier sistema externo (ERP, e-commerce, facturación, inventario) implementa para conectarse al
POS. La guía para integradores (`guia.md`, publicada junto a este archivo) explica cómo probarlo y
por dónde empezar."). Nombres de módulos del POS (`sync/…`, `domain/…`) que no aportan al
integrador también se sacan. No se toca ningún `schema`, `path`, `required` ni `example`: la
versión sigue en `4.4.0`. Repetir el `grep` hasta que no devuelva nada.

- [ ] **Step 3: Escribir `docs/integradores/guia.md`**

En español, para un developer que no conoce el repo. Secciones, en este orden (con los datos
concretos que se listan):

1. `# Guía para integradores` — qué es el POS (web, offline-first, 100% teclado, estático y
   genérico: no conoce ningún backend) y qué es el Connector API (REST/JSON versionado, este
   documento acompaña a la versión del contrato `4.4.0`).
2. `## Probarlo en 5 minutos` — clonar el repo, `pnpm install`, `pnpm --filter demo-backend run
   start` (queda en `http://localhost:4000`), abrir `/versions` del sitio publicado y hacer click en
   el link de demo del demo-backend local; aceptar el permiso de **red local** que pide Chrome (la
   página es https y el backend es `http://localhost`); si se rechazó: ícono del candado → Configuración
   del sitio → "Acceso a la red local" → Permitir, y recargar. Navegador de referencia: Chromium
   (Chrome, Edge).
3. `## Cómo entra un comercio: el link de demo y el alta` — formato
   `<pos>/?demo=true&backend=<base URL>&template=<opcional>` (`https:`, o `http:` a localhost);
   `POST /demo-sessions` (el único endpoint sin autenticación); la terminal en demo muestra DEMO y
   el botón de alta; el alta vuelve a `<return_url>#connect=<base64url de JSON>` con `baseUrl`,
   `apiKey`, `branch`, `pointOfSale` y opcionalmente `wipeKey`. La config viaja en el fragmento,
   nunca en la query string.
4. `## Implementar el contrato` — las operaciones: `GET /info` (versión, estado, capacidades),
   `POST /sync/push` (un lote, un ack de recepción, idempotente por `idempotency_id`),
   `POST /sync/pull` (catálogo, clientes, estado de lotes, avisos), `POST /account-holds` (la única
   operación síncrona: reserva de crédito), `POST /demo-sessions` (opcional). Principio: el backend
   nunca rechaza el contenido de lo que manda el POS; registra y audita. Autenticación: `Authorization:
   Bearer <apiKey>`; el POS manda `X-POS-Contract-Version` en todo request. CORS: el POS corre en
   otro origen. Detalle de cada operación: [`connector-api.openapi.yaml`](../connector-api.openapi.yaml).
5. `## Compatibilidad y capacidades` — compatible = mismo major y minor ≥ el piso `4.0.0`; lo
   opcional se declara como capacidad en `GET /info` (`demo-sessions`, `customer-payment-void`); el
   POS ignora capacidades que no conoce. Reglas de evolución: ver la sección del OpenAPI.
6. `## Servir el POS desde tu propio servidor` — descargar `/<versión>.zip` desde `/versions`,
   servir su carpeta como archivos estáticos en una carpeta propia y **siempre con barra final**
   (`/pos/` y no `/pos`); cada carpeta tiene su propio almacenamiento (IndexedDB y `localStorage`),
   así que cambiar de carpeta, de versión o de dominio es una instalación nueva: lo no sincronizado
   queda en la carpeta anterior.
7. `## Aparecer en /versions` — un PR a `site/backends.json` del repo con `name`, `url` y `notes`;
   el backend tiene que ofrecer demos (`demo-sessions`): la página se genera consultando
   `POST /demo-sessions` y `GET /info` en vivo, todos los días.

- [ ] **Step 4: Escribir `docs/integradores/llms.txt`**

```
# offline-pos: guía para integradores

> POS web offline-first y genérico que se conecta a cualquier backend que implemente el Connector API (REST/JSON, contrato 4.4.0). Este directorio acompaña a una versión publicada del POS.

Para implementar un backend: leer primero la guía (qué es el POS, cómo probarlo con el demo-backend, cómo entra un comercio) y después el OpenAPI (cada operación, esquemas y reglas de evolución del contrato).

## Docs

- [Guía para integradores](guia.md): probarlo, link de demo y alta, operaciones del contrato, compatibilidad, servir el zip.
- [Guía en HTML](index.html): la misma guía para leer en el navegador.
- [Connector API (OpenAPI 3.1)](../connector-api.openapi.yaml): el contrato completo.
```

- [ ] **Step 5: Correr el test**

Run: `pnpm exec vitest run site/docs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write docs/connector-api.openapi.yaml docs/integradores/guia.md site/docs.test.ts
git add docs site/docs.test.ts
git commit -m "docs: guía para integradores, llms.txt y OpenAPI sin referencias internas (#148)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `site/`: esqueleto, backends conocidos y versiones publicadas

**Files:**
- Create: `tsconfig.site.json`
- Modify: `tsconfig.json` (referencia)
- Modify: `eslint.config.js` (ignorar `.site-dist`, `.site-out`)
- Modify: `vite.config.ts` (excluir `.site-dist/**`, `.site-out/**` de Vitest)
- Modify: `.gitignore`
- Create: `site/backends.json`, `site/backends.ts`, `site/backends.test.ts`
- Create: `site/version-info.ts`, `site/version-info.test.ts`

**Interfaces:**
- Produces:
  - `type BackendEntry = { name: string; url: string; local?: 'demo-backend'; notes?: string }`
  - `parseBackends(raw: unknown): BackendEntry[]` (lanza con los issues de Zod)
  - `loadBackends(path?: URL): BackendEntry[]` (default `site/backends.json`)
  - `type VersionInfo = { version: string; contract: string; minBackendContract: string }`
  - `VERSION_FOLDER = /^\d+\.\d+\.\d+$/`
  - `compareVersionsDesc(a: string, b: string): number`
  - `readPublishedVersions(siteDir: string): VersionInfo[]` (más nueva primero)

- [ ] **Step 1: Configuración de TypeScript, lint y git**

`tsconfig.site.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.site.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023", "DOM"],
    "types": ["node"],
    "skipLibCheck": true,
    "module": "nodenext",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true
  },
  "include": ["site"]
}
```

`tsconfig.json`: sumar `{ "path": "./tsconfig.site.json" }` a `references`.
`.gitignore`: sumar al final

```
# sitio publicado armado en local (#148)
.site-dist
.site-out
```

`eslint.config.js`: sumar `'.site-dist/**', '.site-out/**'` a `ignores`. `vite.config.ts`: sumar
`'.site-dist/**', '.site-out/**'` al `exclude` de `test`.

- [ ] **Step 2: Tests de backends (fallan)**

`site/backends.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadBackends, parseBackends } from './backends.ts';

describe('backends conocidos (#148)', () => {
  it('la lista del repo es válida y arranca con el demo-backend local', () => {
    const backends = loadBackends();
    expect(backends[0]).toMatchObject({ url: 'http://localhost:4000', local: 'demo-backend' });
  });

  it('acepta https y http a localhost', () => {
    expect(
      parseBackends([
        { name: 'A', url: 'https://erp.example.com' },
        { name: 'B', url: 'http://127.0.0.1:4000', notes: 'x' },
      ]),
    ).toHaveLength(2);
  });

  it('rechaza http fuera de localhost, un local desconocido y la lista vacía', () => {
    expect(() => parseBackends([{ name: 'A', url: 'http://erp.example.com' }])).toThrow(/https/);
    expect(() =>
      parseBackends([{ name: 'A', url: 'http://localhost:4000', local: 'otro' }]),
    ).toThrow();
    expect(() => parseBackends([])).toThrow();
  });
});
```

Run: `pnpm exec vitest run site/backends.test.ts` → FAIL.

- [ ] **Step 3: Implementar backends**

`site/backends.json`:

```json
[
  {
    "name": "demo-backend local",
    "url": "http://localhost:4000",
    "local": "demo-backend",
    "notes": "Levantalo con el demo-backend/ del mismo tag que la versión del POS: pnpm --filter demo-backend run start."
  }
]
```

`site/backends.ts`:

```ts
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { isAllowedBackendUrl } from '../src/sync/demo-link.ts';

/**
 * Backends conocidos de `/versions` (#148): un dato del sitio, no de una versión del POS (la app
 * nunca lo lee). Solo lo que no se puede averiguar solo; el contrato y las capacidades se consultan
 * en vivo (`query-backend.ts`). `local: 'demo-backend'`: la Action no llega a la máquina de nadie,
 * así que levanta el demo-backend del commit y lo consulta a él.
 */
const backendEntrySchema = z.object({
  name: z.string().min(1),
  url: z.url().refine(isAllowedBackendUrl, 'Tiene que ser https (o http a localhost)'),
  local: z.literal('demo-backend').optional(),
  notes: z.string().optional(),
});

export type BackendEntry = { name: string; url: string; local?: 'demo-backend'; notes?: string };

export function parseBackends(raw: unknown): BackendEntry[] {
  const parsed = z.array(backendEntrySchema).min(1).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`site/backends.json inválido:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data.map(({ name, url, local, notes }) => ({
    name,
    url: url.replace(/\/+$/, ''),
    ...(local !== undefined ? { local } : {}),
    ...(notes !== undefined ? { notes } : {}),
  }));
}

export function loadBackends(path: URL = new URL('./backends.json', import.meta.url)): BackendEntry[] {
  return parseBackends(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
```

Run: `pnpm exec vitest run site/backends.test.ts` → PASS.

- [ ] **Step 4: Tests de versiones publicadas (fallan)**

`site/version-info.test.ts`:

```ts
// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareVersionsDesc, readPublishedVersions } from './version-info.ts';

function site(folders: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'site-'));
  for (const [name, info] of Object.entries(folders)) {
    mkdirSync(join(dir, name));
    if (info !== undefined) {
      writeFileSync(join(dir, name, 'version.json'), JSON.stringify(info));
    }
  }
  return dir;
}

const info = (version: string) => ({ version, contract: '4.4.0', minBackendContract: '4.0.0' });

describe('versiones publicadas (#148)', () => {
  it('ordena por semver, la más nueva primero', () => {
    expect(['0.9.0', '0.10.0', '0.1.0', '1.0.0'].sort(compareVersionsDesc)).toEqual([
      '1.0.0',
      '0.10.0',
      '0.9.0',
      '0.1.0',
    ]);
  });

  it('lee las carpetas con forma de versión e ignora el resto', () => {
    const dir = site({ '0.1.0': info('0.1.0'), '0.2.0': info('0.2.0'), versions: undefined });
    expect(readPublishedVersions(dir).map((v) => v.version)).toEqual(['0.2.0', '0.1.0']);
  });

  it('falla si una carpeta de versión no tiene version.json o no coincide', () => {
    expect(() => readPublishedVersions(site({ '0.1.0': undefined }))).toThrow(/0\.1\.0/);
    expect(() => readPublishedVersions(site({ '0.1.0': info('0.2.0') }))).toThrow(/0\.1\.0/);
  });
});
```

Run: `pnpm exec vitest run site/version-info.test.ts` → FAIL.

- [ ] **Step 5: Implementar versiones publicadas**

`site/version-info.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** Lo único que una carpeta de versión declara: hechos del POS, que nunca cambian (#148). */
export type VersionInfo = { version: string; contract: string; minBackendContract: string };

const semver = z.string().regex(/^\d+\.\d+\.\d+$/);
const versionInfoSchema = z.object({ version: semver, contract: semver, minBackendContract: semver });

export const VERSION_FOLDER = /^\d+\.\d+\.\d+$/;

export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function readPublishedVersions(siteDir: string): VersionInfo[] {
  return readdirSync(siteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && VERSION_FOLDER.test(entry.name))
    .map((entry) => {
      const path = join(siteDir, entry.name, 'version.json');
      if (!existsSync(path)) {
        throw new Error(`La carpeta publicada ${entry.name} no tiene version.json`);
      }
      const parsed = versionInfoSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
      if (!parsed.success || parsed.data.version !== entry.name) {
        throw new Error(`version.json inválido en la carpeta ${entry.name}`);
      }
      return parsed.data;
    })
    .sort((a, b) => compareVersionsDesc(a.version, b.version));
}
```

- [ ] **Step 6: Verificación**

Run: `pnpm exec vitest run site; if ($?) { pnpm lint }; if ($?) { pnpm typecheck }`
Expected: PASS. Si el typecheck de `tsconfig.site.json` marca algo en los módulos de `src/` que
arrastra (`demo-link.ts`), corregirlo en el import o en la config de `site`, nunca relajando
`strict`.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write tsconfig.site.json tsconfig.json eslint.config.js vite.config.ts site
git add tsconfig.site.json tsconfig.json eslint.config.js vite.config.ts .gitignore site
git commit -m "feat(site): backends conocidos y versiones publicadas (#148)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `site/build-version.ts`: la carpeta de una versión

**Files:**
- Create: `site/templates/guide.html`
- Create: `site/guide-page.ts`
- Create: `site/build-version.ts`
- Create: `site/build-version.test.ts`
- Modify: `package.json` (devDependency `marked`)

**Interfaces:**
- Consumes: `VersionInfo` (Task 6); `POS_CONTRACT_VERSION`, `MIN_BACKEND_CONTRACT`
  (`src/domain/contract-version.ts`).
- Produces:
  - `renderGuidePage(markdown: string, version: string): string`
  - `buildVersionFolder(options: { distDir: string; siteDir: string; info: VersionInfo; docs?: DocsSources }): string`
    (devuelve la carpeta creada; lanza si ya existe)
  - `type DocsSources = { guide: string; llms: string; openapi: string }` (rutas)
  - CLI: `node site/build-version.ts --dist <dir> --site <dir>`
  - `isMain(importMetaUrl: string): boolean` en `site/cli.ts` (para los tres CLI)

- [ ] **Step 1: Dependencia**

Run (PowerShell): `pnpm add -D marked` y después `npm view marked dependencies`
Expected: `marked` sin dependencias propias (la salida del `npm view` vacía).

- [ ] **Step 2: Tests (fallan)**

`site/build-version.test.ts`:

```ts
// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVersionFolder } from './build-version.ts';
import { renderGuidePage } from './guide-page.ts';

const INFO = { version: '0.1.0', contract: '4.4.0', minBackendContract: '4.0.0' };

function fixture(): { distDir: string; siteDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'build-version-'));
  const distDir = join(root, 'dist');
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>offline-pos</title>');
  writeFileSync(join(distDir, 'assets', 'app-abc123.js'), 'console.log(1)');
  const siteDir = join(root, 'site');
  mkdirSync(siteDir);
  return { distDir, siteDir };
}

describe('buildVersionFolder (#148)', () => {
  it('copia el build, escribe version.json y publica las docs con el link al OpenAPI local', () => {
    const { distDir, siteDir } = fixture();
    const folder = buildVersionFolder({ distDir, siteDir, info: INFO });

    expect(folder).toBe(join(siteDir, '0.1.0'));
    expect(existsSync(join(folder, 'assets', 'app-abc123.js'))).toBe(true);
    expect(JSON.parse(readFileSync(join(folder, 'version.json'), 'utf8'))).toEqual(INFO);
    const guide = readFileSync(join(folder, 'docs', 'guia.md'), 'utf8');
    expect(guide).toContain('](connector-api.openapi.yaml)');
    expect(guide).not.toContain('../connector-api.openapi.yaml');
    expect(readFileSync(join(folder, 'docs', 'llms.txt'), 'utf8')).not.toContain('../');
    expect(existsSync(join(folder, 'docs', 'connector-api.openapi.yaml'))).toBe(true);
    expect(readFileSync(join(folder, 'docs', 'index.html'), 'utf8')).toContain(
      '<h1>Guía para integradores</h1>',
    );
  });

  it('nunca pisa una versión publicada', () => {
    const { distDir, siteDir } = fixture();
    buildVersionFolder({ distDir, siteDir, info: INFO });
    expect(() => buildVersionFolder({ distDir, siteDir, info: INFO })).toThrow(/inmutable/);
  });
});

describe('renderGuidePage', () => {
  it('convierte el Markdown dentro de la plantilla, con el título y la versión', () => {
    const html = renderGuidePage('# Guía para integradores\n\nHola **mundo**', '0.1.0');
    expect(html).toContain('<title>Guía para integradores · offline-pos 0.1.0</title>');
    expect(html).toContain('<strong>mundo</strong>');
  });
});
```

Run: `pnpm exec vitest run site/build-version.test.ts` → FAIL.

- [ ] **Step 3: Plantilla de la guía**

`site/templates/guide.html`:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{title}} · offline-pos {{version}}</title>
    <style>
      :root { color-scheme: light dark; --bg: #fff; --fg: #1a1a1a; --muted: #666; --code: #f3f3f3; }
      @media (prefers-color-scheme: dark) {
        :root { --bg: #161616; --fg: #e8e8e8; --muted: #999; --code: #262626; }
      }
      body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, sans-serif; }
      main { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; }
      header { color: var(--muted); font-size: 14px; }
      code, pre { background: var(--code); border-radius: 4px; font-size: 14px; }
      code { padding: 1px 4px; }
      pre { padding: 12px; overflow-x: auto; }
      a { color: inherit; }
    </style>
  </head>
  <body>
    <main>
      <header>offline-pos {{version}} · <a href="guia.md">Markdown</a> ·
        <a href="connector-api.openapi.yaml">OpenAPI</a> · <a href="llms.txt">llms.txt</a> ·
        <a href="../../versions/">Todas las versiones</a></header>
      {{content}}
    </main>
  </body>
</html>
```

- [ ] **Step 4: `site/guide-page.ts` y `site/cli.ts`**

`site/guide-page.ts`:

```ts
import { readFileSync } from 'node:fs';
import { marked } from 'marked';

const TEMPLATE = readFileSync(new URL('./templates/guide.html', import.meta.url), 'utf8');

/** La guía en HTML para leer en el navegador (#148). El título sale del primer `# `. */
export function renderGuidePage(markdown: string, version: string): string {
  const title = /^# (.+)$/m.exec(markdown)?.[1] ?? 'Guía para integradores';
  const content = marked.parse(markdown, { async: false });
  return TEMPLATE.replaceAll('{{title}}', title)
    .replaceAll('{{version}}', version)
    .replace('{{content}}', content);
}
```

`site/cli.ts`:

```ts
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `true` si el módulo se ejecutó con `node site/<archivo>.ts` y no se importó (tests). */
export function isMain(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && fileURLToPath(importMetaUrl) === resolve(entry);
}
```

- [ ] **Step 5: `site/build-version.ts`**

```ts
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MIN_BACKEND_CONTRACT, POS_CONTRACT_VERSION } from '../src/domain/contract-version.ts';
import { isMain } from './cli.ts';
import { renderGuidePage } from './guide-page.ts';
import type { VersionInfo } from './version-info.ts';

export type DocsSources = { guide: string; llms: string; openapi: string };

const repo = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));

const DEFAULT_DOCS: DocsSources = {
  guide: repo('docs/integradores/guia.md'),
  llms: repo('docs/integradores/llms.txt'),
  openapi: repo('docs/connector-api.openapi.yaml'),
};

/** En el repo el OpenAPI está un nivel arriba; publicado, al lado. */
const localizeLinks = (text: string): string =>
  text.replaceAll('../connector-api.openapi.yaml', 'connector-api.openapi.yaml');

/**
 * Arma `/<versión>/` dentro del sitio (#148): el build, `version.json` (hechos del POS) y `docs/`.
 * Una carpeta publicada es inmutable: si ya existe, falla.
 */
export function buildVersionFolder(options: {
  distDir: string;
  siteDir: string;
  info: VersionInfo;
  docs?: DocsSources;
}): string {
  const { distDir, siteDir, info, docs = DEFAULT_DOCS } = options;
  const folder = join(siteDir, info.version);
  if (existsSync(folder)) {
    throw new Error(`La versión ${info.version} ya está publicada: las carpetas son inmutables`);
  }
  cpSync(distDir, folder, { recursive: true });
  writeFileSync(join(folder, 'version.json'), `${JSON.stringify(info, null, 2)}\n`);

  const docsDir = join(folder, 'docs');
  mkdirSync(docsDir);
  const guide = localizeLinks(readFileSync(docs.guide, 'utf8'));
  writeFileSync(join(docsDir, 'guia.md'), guide);
  writeFileSync(join(docsDir, 'llms.txt'), localizeLinks(readFileSync(docs.llms, 'utf8')));
  cpSync(docs.openapi, join(docsDir, 'connector-api.openapi.yaml'));
  writeFileSync(join(docsDir, 'index.html'), renderGuidePage(guide, info.version));
  return folder;
}

export function currentVersionInfo(): VersionInfo {
  const { version } = JSON.parse(readFileSync(repo('package.json'), 'utf8')) as { version: string };
  return { version, contract: POS_CONTRACT_VERSION, minBackendContract: MIN_BACKEND_CONTRACT };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { dist: { type: 'string' }, site: { type: 'string' } } });
  if (values.dist === undefined || values.site === undefined) {
    throw new Error('Uso: node site/build-version.ts --dist <dir> --site <dir>');
  }
  const folder = buildVersionFolder({
    distDir: values.dist,
    siteDir: values.site,
    info: currentVersionInfo(),
  });
  console.log(`Versión armada en ${folder}`);
}
```

- [ ] **Step 6: Tests, lint, typecheck**

Run: `pnpm exec vitest run site; if ($?) { pnpm lint }; if ($?) { pnpm typecheck }`
Expected: PASS.

- [ ] **Step 7: Probar el CLI con Node real**

Run (PowerShell): `pnpm build; if ($?) { Remove-Item -Recurse -Force .site-out -ErrorAction SilentlyContinue; New-Item -ItemType Directory .site-out | Out-Null; node site/build-version.ts --dist dist --site .site-out }`
Expected: "Versión armada en .site-out\0.0.0" (todavía `0.0.0` hasta la Task 11), y
`.site-out/0.0.0/docs/index.html` existe. Si Node falla al importar un módulo de `src/`
(sintaxis no borrable o import sin extensión), corregirlo antes de seguir.

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write site package.json
git add site package.json pnpm-lock.yaml
git commit -m "feat(site): carpeta inmutable por versión con sus docs (#148)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Consultar un backend (`demo-sessions` → `/info`)

**Files:**
- Create: `site/query-backend.ts`
- Create: `site/query-backend.test.ts`
- Create: `site/local-demo-backend.ts`

**Interfaces:**
- Consumes: `requestDemoSession` (`src/sync/demo-session.ts`), `backendInfoSchema` y
  `CONTRACT_VERSION_HEADER` (`src/sync/connector.ts`), `POS_CONTRACT_VERSION`.
- Produces:
  - `type BackendFacts = { contract: string; capabilities: string[]; checkedAt: string }`
  - `queryBackend(url: string, now: Date): Promise<BackendFacts>` (lanza si no contesta, si no
    valida o si no declara `demo-sessions`)
  - `withLocalDemoBackend<T>(run: (url: string) => Promise<T>): Promise<T>`

- [ ] **Step 1: Tests (fallan)**

`site/query-backend.test.ts`:

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryBackend } from './query-backend.ts';

const NOW = new Date('2026-09-29T12:00:00.000Z');

const SESSION = {
  apiKey: 'k-123',
  branch: 'CENTRAL',
  pointOfSale: 'Caja 1',
  template: 'kiosco',
  onboarding: { url: 'https://erp.example.com/alta', label: 'Crear mi comercio' },
};

function stubFetch(info: unknown, session: unknown = SESSION) {
  const fetchMock = vi.fn((input: string) =>
    Promise.resolve(
      input.endsWith('/demo-sessions')
        ? new Response(JSON.stringify(session), { status: 201 })
        : new Response(JSON.stringify(info), { status: 200 }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('queryBackend (#148)', () => {
  it('pide una demo y con esa conexión consulta /info', async () => {
    const fetchMock = stubFetch({
      contractVersion: '4.4.0',
      status: 'ok',
      capabilities: ['demo-sessions', 'customer-payment-void'],
    });
    const facts = await queryBackend('https://erp.example.com', NOW);
    expect(facts).toEqual({
      contract: '4.4.0',
      capabilities: ['demo-sessions', 'customer-payment-void'],
      checkedAt: '2026-09-29T12:00:00.000Z',
    });
    const [infoUrl, infoInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(infoUrl).toBe('https://erp.example.com/info');
    expect(new Headers(infoInit.headers).get('Authorization')).toBe('Bearer k-123');
  });

  it('usa la baseUrl que devuelve la demo, si viene', async () => {
    const fetchMock = stubFetch(
      { contractVersion: '4.4.0', status: 'ok', capabilities: ['demo-sessions'] },
      { ...SESSION, baseUrl: 'https://tenant-1.erp.example.com' },
    );
    await queryBackend('https://erp.example.com', NOW);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://tenant-1.erp.example.com/info');
  });

  it('falla si el backend no contesta', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    await expect(queryBackend('https://erp.example.com', NOW)).rejects.toThrow(
      /https:\/\/erp\.example\.com/,
    );
  });

  it('falla si no declara demo-sessions', async () => {
    stubFetch({ contractVersion: '4.4.0', status: 'ok' });
    await expect(queryBackend('https://erp.example.com', NOW)).rejects.toThrow(/demo-sessions/);
  });

  it('falla si /info no valida', async () => {
    stubFetch({ status: 'ok' });
    await expect(queryBackend('https://erp.example.com', NOW)).rejects.toThrow(/\/info/);
  });
});
```

Run: `pnpm exec vitest run site/query-backend.test.ts` → FAIL.

- [ ] **Step 2: Implementar `site/query-backend.ts`**

```ts
import { POS_CONTRACT_VERSION } from '../src/domain/contract-version.ts';
import { backendInfoSchema, CONTRACT_VERSION_HEADER } from '../src/sync/connector.ts';
import { requestDemoSession } from '../src/sync/demo-session.ts';

/** Lo que `/versions` muestra de un backend, consultado en vivo (#148). */
export type BackendFacts = { contract: string; capabilities: string[]; checkedAt: string };

/**
 * `GET /info` está autenticado, así que se pide antes una demo (`POST /demo-sessions`, público) y
 * se usa su conexión. Sin cambio de contrato; la alternativa (`/info` público) es #151. Lanza: una
 * generación con un backend que no contesta tiene que fallar, nunca publicar datos viejos.
 */
export async function queryBackend(url: string, now: Date): Promise<BackendFacts> {
  const session = await requestDemoSession(url);
  if (!session.ok) {
    throw new Error(`${url}: POST /demo-sessions falló (${JSON.stringify(session)})`);
  }
  const base = (session.value.baseUrl ?? url).replace(/\/+$/, '');
  let body: unknown;
  try {
    const response = await fetch(`${base}/info`, {
      headers: {
        Authorization: `Bearer ${session.value.apiKey}`,
        [CONTRACT_VERSION_HEADER]: POS_CONTRACT_VERSION,
      },
    });
    body = (await response.json()) as unknown;
  } catch (error) {
    throw new Error(`${url}: GET /info no contestó (${String(error)})`, { cause: error });
  }
  const info = backendInfoSchema.safeParse(body);
  if (!info.success) {
    throw new Error(`${url}: GET /info devolvió algo inválido (${JSON.stringify(body)})`);
  }
  const capabilities = info.data.capabilities ?? [];
  if (!capabilities.includes('demo-sessions')) {
    throw new Error(`${url}: no declara la capacidad demo-sessions; /versions solo lista backends con demo`);
  }
  return { contract: info.data.contractVersion, capabilities, checkedAt: now.toISOString() };
}
```

Nota: si `requestDemoSession` falla sin red, su `Result` trae `sync/request-failed`, y el mensaje
lanzado incluye la `url`: el test "no contesta" lo cubre.

Run: `pnpm exec vitest run site/query-backend.test.ts` → PASS.

- [ ] **Step 3: `site/local-demo-backend.ts`**

```ts
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../demo-backend/src/server.ts', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      probe.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('No se pudo reservar un puerto'));
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

async function waitUntilUp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) {
        return;
      }
    } catch {
      // todavía arrancando
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`El demo-backend no arrancó en ${String(timeoutMs)} ms (${url})`);
}

/**
 * Levanta el demo-backend de este commit, en memoria y en un puerto libre, y lo apaga al terminar
 * (#148). Nunca se consulta un `localhost:4000` ya levantado: `POST /demo-sessions` resiembra la
 * base y le borraría los datos a quien lo esté usando.
 */
export async function withLocalDemoBackend<T>(run: (url: string) => Promise<T>): Promise<T> {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, DEMO_BACKEND_PORT: String(port), DEMO_BACKEND_DB: ':memory:' },
    stdio: 'inherit',
  });
  try {
    const url = `http://localhost:${String(port)}`;
    await waitUntilUp(`${url}/_demo`, 15_000);
    return await run(url);
  } finally {
    child.kill();
  }
}
```

(Sin test unitario: lo ejercitan el CLI de la Task 9 y el e2e de la Task 10.)

- [ ] **Step 4: Verificación y commit**

Run: `pnpm exec vitest run site; if ($?) { pnpm lint }; if ($?) { pnpm typecheck }`

```bash
pnpm exec prettier --write site
git add site
git commit -m "feat(site): consultar contrato y capacidades de un backend en vivo (#148)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `/versions`, `/llms.txt`, `_headers` y `_redirects`

**Files:**
- Create: `site/versions-page.ts`, `site/versions-page.test.ts`
- Create: `site/build-versions-page.ts`
- Create: `site/templates/_headers`, `site/templates/_redirects`

**Interfaces:**
- Consumes: `BackendEntry`, `loadBackends` (Task 6); `VersionInfo`, `readPublishedVersions`
  (Task 6); `BackendFacts`, `queryBackend`, `withLocalDemoBackend` (Task 8);
  `isCompatibleContract` (`src/domain/contract-version.ts`); `isMain` (Task 7).
- Produces:
  - `type KnownBackend = { entry: BackendEntry; facts: BackendFacts }`
  - `type Cell = { kind: 'demo'; href: string } | { kind: 'incompatible'; text: string }`
  - `cellFor(version: VersionInfo, backend: KnownBackend): Cell`
  - `renderVersionsPage(versions: VersionInfo[], backends: KnownBackend[], generatedAt: string): string`
  - `renderRootLlms(versions: VersionInfo[]): string`
  - `sameIgnoringGeneratedAt(a: string, b: string): boolean`
  - `buildVersionsPage(siteDir: string, now: Date): Promise<void>`
  - CLI: `node site/build-versions-page.ts --site <dir>`

- [ ] **Step 1: Tests (fallan)**

`site/versions-page.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  cellFor,
  renderRootLlms,
  renderVersionsPage,
  sameIgnoringGeneratedAt,
  type KnownBackend,
} from './versions-page.ts';

const V010 = { version: '0.1.0', contract: '4.4.0', minBackendContract: '4.0.0' };
const V020 = { version: '0.2.0', contract: '4.5.0', minBackendContract: '4.1.0' };

const backend = (contract: string, notes?: string): KnownBackend => ({
  entry: { name: 'Demo <local>', url: 'http://localhost:4000', ...(notes ? { notes } : {}) },
  facts: { contract, capabilities: ['demo-sessions'], checkedAt: '2026-09-29T12:00:00.000Z' },
});

describe('cellFor (#148)', () => {
  it('compatible: el link de demo a la carpeta, con el backend codificado', () => {
    expect(cellFor(V010, backend('4.4.0'))).toEqual({
      kind: 'demo',
      href: '../0.1.0/?demo=true&backend=http%3A%2F%2Flocalhost%3A4000',
    });
  });

  it('incompatible por major: un backend 5.0.0 deja atrás a los POS 4.x', () => {
    expect(cellFor(V010, backend('5.0.0'))).toEqual({
      kind: 'incompatible',
      text: 'Incompatible: el backend habla 5.0.0; este POS acepta 4.x desde 4.0.0',
    });
  });

  it('incompatible por piso', () => {
    expect(cellFor(V020, backend('4.0.0')).kind).toBe('incompatible');
  });
});

describe('renderVersionsPage', () => {
  const html = renderVersionsPage([V020, V010], [backend('4.4.0', '<b>ojo</b>')], '2026-09-29T12:00:00.000Z');

  it('una fila por versión, la más nueva primero, con docs y zip', () => {
    expect(html.indexOf('0.2.0')).toBeLessThan(html.indexOf('0.1.0'));
    expect(html).toContain('href="../0.1.0/docs/"');
    expect(html).toContain('href="../0.1.0.zip"');
    expect(html).toContain('Abrir demo');
  });

  it('escapa lo que viene de la lista', () => {
    expect(html).toContain('Demo &lt;local&gt;');
    expect(html).toContain('&lt;b&gt;ojo&lt;/b&gt;');
    expect(html).not.toContain('<b>ojo</b>');
  });

  it('dos generaciones que solo difieren en la fecha son iguales', () => {
    const other = renderVersionsPage([V020, V010], [backend('4.4.0', '<b>ojo</b>')], '2026-09-30T12:00:00.000Z');
    expect(other).not.toBe(html);
    expect(sameIgnoringGeneratedAt(html, other)).toBe(true);
    expect(sameIgnoringGeneratedAt(html, renderVersionsPage([V010], [], '2026-09-29T12:00:00.000Z'))).toBe(false);
  });
});

describe('renderRootLlms', () => {
  it('apunta a las docs de la versión más nueva y lista todas', () => {
    const llms = renderRootLlms([V020, V010]);
    expect(llms).toContain('[Guía para integradores (0.2.0)](0.2.0/docs/guia.md)');
    expect(llms).toContain('- [0.1.0](0.1.0/docs/llms.txt): contrato 4.4.0');
  });
});
```

Run: `pnpm exec vitest run site/versions-page.test.ts` → FAIL.

- [ ] **Step 2: Implementar `site/versions-page.ts`**

```ts
import { isCompatibleContract } from '../src/domain/contract-version.ts';
import type { BackendEntry } from './backends.ts';
import type { BackendFacts } from './query-backend.ts';
import type { VersionInfo } from './version-info.ts';

export type KnownBackend = { entry: BackendEntry; facts: BackendFacts };
export type Cell = { kind: 'demo'; href: string } | { kind: 'incompatible'; text: string };

const escape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Misma regla que el POS (`isCompatibleContract`), con el piso de cada carpeta publicada. */
export function cellFor(version: VersionInfo, backend: KnownBackend): Cell {
  if (isCompatibleContract(backend.facts.contract, version.minBackendContract)) {
    return {
      kind: 'demo',
      href: `../${version.version}/?demo=true&backend=${encodeURIComponent(backend.entry.url)}`,
    };
  }
  const major = version.minBackendContract.split('.')[0] ?? '';
  return {
    kind: 'incompatible',
    text: `Incompatible: el backend habla ${backend.facts.contract}; este POS acepta ${major}.x desde ${version.minBackendContract}`,
  };
}

const GENERATED_AT = /<time data-generated[^>]*>[^<]*<\/time>/;

export function sameIgnoringGeneratedAt(a: string, b: string): boolean {
  return a.replace(GENERATED_AT, '') === b.replace(GENERATED_AT, '');
}

function renderCell(cell: Cell): string {
  return cell.kind === 'demo'
    ? `<td><a href="${escape(cell.href)}">Abrir demo</a></td>`
    : `<td class="muted">${escape(cell.text)}</td>`;
}

/**
 * `/versions` (#148): todas las carpetas publicadas × la lista actual de backends. HTML plano, sin
 * JavaScript. Se regenera entera: si un backend cambia de contrato, las filas viejas lo reflejan.
 */
export function renderVersionsPage(
  versions: VersionInfo[],
  backends: KnownBackend[],
  generatedAt: string,
): string {
  const backendList = backends
    .map(
      ({ entry, facts }) => `<li><strong>${escape(entry.name)}</strong> · <code>${escape(entry.url)}</code>
        · contrato ${escape(facts.contract)} · capacidades: ${escape(facts.capabilities.join(', '))}
        ${entry.notes !== undefined ? `<br><span class="muted">${escape(entry.notes)}</span>` : ''}</li>`,
    )
    .join('\n');
  const header = backends.map(({ entry }) => `<th>${escape(entry.name)}</th>`).join('');
  const rows = versions
    .map(
      (version) => `<tr><th scope="row">${escape(version.version)}</th>
        <td>${escape(version.contract)}</td>
        <td><a href="../${escape(version.version)}/docs/">Docs</a></td>
        <td><a href="../${escape(version.version)}.zip">Zip</a></td>
        ${backends.map((backend) => renderCell(cellFor(version, backend))).join('')}</tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Versiones · offline-pos</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #1a1a1a; --muted: #666; --line: #ddd; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161616; --fg: #e8e8e8; --muted: #999; --line: #333; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
  .muted { color: var(--muted); }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); }
  a { color: inherit; }
</style>
</head>
<body>
<main>
<h1>offline-pos: versiones publicadas</h1>
<p>Cada versión vive en su carpeta, nunca cambia y guarda sus datos aparte de las demás. El link de
demo abre esa versión conectada al backend. Docs para integradores y para IA en cada versión y en
<a href="../llms.txt">llms.txt</a>.</p>
<h2>Backends conocidos</h2>
<ul>
${backendList}
</ul>
<p class="muted">Consultados el <time data-generated datetime="${escape(generatedAt)}">${escape(generatedAt)}</time>.</p>
<h2>Versiones</h2>
<div class="scroll">
<table>
<thead><tr><th>Versión</th><th>Contrato</th><th>Docs</th><th>Zip</th>${header}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
</main>
</body>
</html>
`;
}

/** `/llms.txt` del sitio (formato llmstxt.org): la versión más nueva primero. */
export function renderRootLlms(versions: VersionInfo[]): string {
  const latest = versions[0];
  const docs =
    latest === undefined
      ? ''
      : `## Docs

- [Guía para integradores (${latest.version})](${latest.version}/docs/guia.md): cómo probar el POS y cómo implementar el Connector API.
- [Connector API ${latest.contract} (OpenAPI)](${latest.version}/docs/connector-api.openapi.yaml): el contrato completo.

`;
  return `# offline-pos

> POS web offline-first y genérico que se conecta a cualquier backend que implemente el Connector API (REST/JSON versionado). Cada versión publicada vive en su carpeta inmutable, con sus propias docs para integradores.

${docs}## Versiones

${versions.map((v) => `- [${v.version}](${v.version}/docs/llms.txt): contrato ${v.contract}`).join('\n')}
`;
}
```

Run: `pnpm exec vitest run site/versions-page.test.ts` → PASS.

- [ ] **Step 3: Plantillas de Pages**

`site/templates/_redirects`:

```
/ /versions/ 302
```

`site/templates/_headers`:

```
# Cloudflare Pages (#148). Por defecto Pages ya manda "public, max-age=0, must-revalidate":
# el HTML, /versions, llms.txt y version.json se revalidan siempre. Solo los assets con hash
# (nunca cambian de contenido) se guardan un año.
/*
  X-Content-Type-Options: nosniff

/:version/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

- [ ] **Step 4: `site/build-versions-page.ts`**

```ts
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadBackends } from './backends.ts';
import { isMain } from './cli.ts';
import { withLocalDemoBackend } from './local-demo-backend.ts';
import { queryBackend } from './query-backend.ts';
import { readPublishedVersions } from './version-info.ts';
import {
  renderRootLlms,
  renderVersionsPage,
  sameIgnoringGeneratedAt,
  type KnownBackend,
} from './versions-page.ts';

/** Escribe `content` salvo que lo publicado sea igual ignorando la fecha: el cron no hace commits vacíos. */
function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && sameIgnoringGeneratedAt(readFileSync(path, 'utf8'), content)) {
    return;
  }
  writeFileSync(path, content);
}

/**
 * Regenera `/versions/index.html`, `/llms.txt`, `_headers` y `_redirects` del sitio (#148),
 * consultando cada backend conocido. Falla si alguno no contesta.
 */
export async function buildVersionsPage(siteDir: string, now: Date): Promise<void> {
  const versions = readPublishedVersions(siteDir);
  const backends: KnownBackend[] = [];
  for (const entry of loadBackends()) {
    const facts =
      entry.local === 'demo-backend'
        ? await withLocalDemoBackend((url) => queryBackend(url, now))
        : await queryBackend(entry.url, now);
    backends.push({ entry, facts });
  }
  mkdirSync(join(siteDir, 'versions'), { recursive: true });
  writeIfChanged(
    join(siteDir, 'versions', 'index.html'),
    renderVersionsPage(versions, backends, now.toISOString()),
  );
  writeIfChanged(join(siteDir, 'llms.txt'), renderRootLlms(versions));
  for (const file of ['_headers', '_redirects']) {
    cpSync(new URL(`./templates/${file}`, import.meta.url), join(siteDir, file));
  }
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { site: { type: 'string' } } });
  if (values.site === undefined) {
    throw new Error('Uso: node site/build-versions-page.ts --site <dir>');
  }
  await buildVersionsPage(values.site, new Date());
  console.log(`/versions regenerada en ${values.site}`);
}
```

- [ ] **Step 5: Probar el CLI de punta a punta**

Run (PowerShell, con `.site-out/0.0.0/` de la Task 7): `node site/build-versions-page.ts --site .site-out`
Expected: se ve el log del demo-backend arrancando en un puerto libre; "/versions regenerada";
`.site-out/versions/index.html` tiene la fila `0.0.0` con "Abrir demo" a
`../0.0.0/?demo=true&backend=http%3A%2F%2Flocalhost%3A4000`; existen `.site-out/llms.txt`,
`_headers` y `_redirects`. Correrlo otra vez: `git diff --no-index` entre una copia previa y la
nueva de `versions/index.html` no muestra cambios (el archivo no se reescribió).

- [ ] **Step 6: Verificación y commit**

Run: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }`

```bash
pnpm exec prettier --write site
git add site
git commit -m "feat(site): /versions, llms.txt y reglas de Pages generadas en vivo (#148)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: El sitio armado en local y su e2e

**Files:**
- Create: `site/build-site.ts`
- Modify: `package.json` (scripts `site:build`, `site:preview`)
- Modify: `playwright.config.ts` (dos `webServer` nuevos)
- Create: `e2e/published-site.spec.ts`
- Modify: `e2e/AGENTS.md`

**Interfaces:**
- Consumes: `buildVersionFolder`, `currentVersionInfo` (Task 7); `buildVersionsPage` (Task 9).
- Produces: `pnpm site:build` (arma `.site-out/` desde cero con su propio build en `.site-dist/`),
  `pnpm site:preview` (sirve `.site-out/` en `4174`).

- [ ] **Step 1: `site/build-site.ts`**

```ts
import { mkdirSync, rmSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildVersionFolder, currentVersionInfo } from './build-version.ts';
import { buildVersionsPage } from './build-versions-page.ts';
import { isMain } from './cli.ts';

/**
 * El sitio completo desde cero, para probarlo en local y en el e2e (#148): la versión actual más
 * `/versions`. No arma el zip (lo hace la Action con `zip`) ni parte de la rama `publish`.
 */
if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { dist: { type: 'string' }, out: { type: 'string' } } });
  if (values.dist === undefined || values.out === undefined) {
    throw new Error('Uso: node site/build-site.ts --dist <dir> --out <dir>');
  }
  rmSync(values.out, { recursive: true, force: true });
  mkdirSync(values.out, { recursive: true });
  buildVersionFolder({ distDir: values.dist, siteDir: values.out, info: currentVersionInfo() });
  await buildVersionsPage(values.out, new Date());
  console.log(`Sitio armado en ${values.out}`);
}
```

`package.json`, scripts:

```json
    "site:build": "vite build --outDir .site-dist && node site/build-site.ts --dist .site-dist --out .site-out",
    "site:preview": "vite preview --outDir .site-out --port 4174 --strictPort",
```

(Build propio en `.site-dist/`: Playwright arranca sus servidores en paralelo y el de `4173` ya
construye `dist/`; dos builds al mismo directorio se pisarían.)

- [ ] **Step 2: Probarlo**

Run: `pnpm site:build`, después en otra terminal `pnpm site:preview` y abrir (o `curl`)
`http://localhost:4174/versions/` y `http://localhost:4174/0.0.0/docs/`.
Expected: las dos páginas cargan. Frenar el preview.

- [ ] **Step 3: Servidores del e2e**

En `playwright.config.ts`, sumar a `webServer`:

```ts
    {
      // Sitio publicado armado en local (#148): la versión actual en /<versión>/ más /versions.
      command: 'pnpm site:build && pnpm site:preview',
      url: 'http://localhost:4174/versions/',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // Backend en memoria propio de `e2e/published-site.spec.ts`: `POST /demo-sessions`
      // re-siembra la base, así que no comparte el de `demo-onboarding.spec.ts` (#148).
      command: 'pnpm --filter demo-backend run start',
      env: { DEMO_BACKEND_PORT: '4002', DEMO_BACKEND_DB: ':memory:' },
      url: 'http://localhost:4002/_demo',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
```

- [ ] **Step 4: El spec**

`e2e/published-site.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * El sitio publicado (#148), armado con `pnpm site:build` y servido en 4174: `/versions`, la
 * carpeta de la versión con rutas relativas y su almacenamiento propio, y las docs. El redirect de
 * `/` a `/versions/` (`_redirects`) es de Cloudflare: el preview de Vite no lo aplica.
 */
test.describe.configure({ mode: 'serial' });

const SITE = 'http://localhost:4174';
const BACKEND = 'http://localhost:4002';
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string };

test('/versions lista la versión actual con su link de demo, docs y zip', async ({ page }) => {
  await page.goto(`${SITE}/versions/`);
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: VERSION }) });
  await expect(row.getByRole('link', { name: 'Abrir demo' })).toHaveAttribute(
    'href',
    `../${VERSION}/?demo=true&backend=${encodeURIComponent('http://localhost:4000')}`,
  );
  await expect(row.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', `../${VERSION}/docs/`);
  await expect(row.getByRole('link', { name: 'Zip' })).toHaveAttribute('href', `../${VERSION}.zip`);
});

test('la carpeta arranca con el link de demo y guarda todo en su propio almacenamiento', async ({
  page,
}) => {
  await page.goto(`${SITE}/${VERSION}/?demo=true&backend=${encodeURIComponent(BACKEND)}`);
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();

  const storage = await page.evaluate(async () => ({
    databases: (await indexedDB.databases()).map((database) => database.name),
    keys: Object.keys(localStorage),
    favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href'),
  }));
  expect(storage.databases).toContain(`offline-pos@/${VERSION}/`);
  expect(storage.databases).not.toContain('offline-pos');
  expect(storage.keys).toContain(`offline-pos@/${VERSION}/:sync-config`);
  for (const key of storage.keys) {
    expect(key.startsWith(`offline-pos@/${VERSION}/:`)).toBe(true);
  }
  expect(storage.favicon).toBe('./favicon.svg');
  expect((await page.request.get(`${SITE}/${VERSION}/favicon.svg`)).ok()).toBe(true);
});

test('/<versión>/docs/ muestra la guía y enlaza el OpenAPI de al lado', async ({ page }) => {
  await page.goto(`${SITE}/${VERSION}/docs/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Guía para integradores' })).toBeVisible();
  expect((await page.request.get(`${SITE}/${VERSION}/docs/connector-api.openapi.yaml`)).ok()).toBe(true);
  expect((await page.request.get(`${SITE}/${VERSION}/docs/llms.txt`)).ok()).toBe(true);
});
```

- [ ] **Step 5: Correr la suite e2e completa**

Run: `pnpm test:e2e`
Expected: PASS, incluidos los 3 tests nuevos (la primera vez tarda más: dos builds).

- [ ] **Step 6: `e2e/AGENTS.md`**

Sumar al final un párrafo: **Sitio publicado** (#148): `e2e/published-site.spec.ts` corre contra
`.site-out/` (`pnpm site:build`, con su propio build en `.site-dist/` para no pisar el `dist/` del
servidor de `4173`), servido por `pnpm site:preview` en `4174`, y usa un tercer demo-backend en
memoria (`4002`) por el mismo motivo que el de `4001`. Prueba `/versions`, que la carpeta arranca
con rutas relativas y que su almacenamiento es `offline-pos@/<versión>/`. El redirect de `/` y los
headers son de Cloudflare: se verifican en la primera publicación. Actualizar también la mención de
"Dos demo-backends" a "Tres".

- [ ] **Step 7: Verificación y commit**

Run: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }`

```bash
pnpm exec prettier --write site/build-site.ts package.json playwright.config.ts e2e/published-site.spec.ts e2e/AGENTS.md
git add site/build-site.ts package.json playwright.config.ts e2e
git commit -m "test(e2e): sitio publicado armado en local con /versions y carpeta aislada (#148)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: GitHub Action de publicación y guía de Cloudflare

**Files:**
- Create: `.github/workflows/publish.yml`
- Create: `docs/publicacion.md`

- [ ] **Step 1: La Action**

`.github/workflows/publish.yml`:

```yaml
name: Publicación

# #148. Con un tag vX.Y.Z publica una carpeta nueva; en los demás casos solo regenera /versions y
# /llms.txt (backends conocidos consultados en vivo). Cloudflare Pages sirve la rama `publish`.
on:
  push:
    tags: ['v*.*.*']
    branches: [main]
    paths: ['site/**'] # no se evalúa para tags
  schedule:
    - cron: '17 9 * * *'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: publish
  cancel-in-progress: false

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v5

      - uses: actions/setup-node@v7
        with:
          node-version: '24'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Rama publish en publish-tree/
        run: |
          if git ls-remote --exit-code --heads origin publish > /dev/null; then
            git fetch --depth=1 origin publish:publish
            git worktree add publish-tree publish
          else
            git worktree add --orphan -b publish publish-tree
          fi

      - name: Carpeta de la versión y zip
        if: github.ref_type == 'tag'
        run: |
          VERSION=$(node -p "require('./package.json').version")
          if [ "$GITHUB_REF_NAME" != "v$VERSION" ]; then
            echo "::error::El tag $GITHUB_REF_NAME no coincide con package.json ($VERSION)"
            exit 1
          fi
          if [ -e "publish-tree/$VERSION" ]; then
            echo "::error::La versión $VERSION ya está publicada: las carpetas son inmutables"
            exit 1
          fi
          pnpm build
          node site/build-version.ts --dist dist --site publish-tree
          STAGE=$(mktemp -d)
          cp -r "publish-tree/$VERSION" "$STAGE/offline-pos-$VERSION"
          (cd "$STAGE" && zip -qr "$GITHUB_WORKSPACE/publish-tree/$VERSION.zip" "offline-pos-$VERSION")

      - name: /versions y /llms.txt
        run: node site/build-versions-page.ts --site publish-tree

      - name: Commit y push a publish
        run: |
          cd publish-tree
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          git add -A
          if git diff --cached --quiet; then
            echo 'Sin cambios: nada que publicar'
            exit 0
          fi
          if [ "$GITHUB_REF_TYPE" = tag ]; then MSG="publish: $GITHUB_REF_NAME"; else MSG='publish: /versions'; fi
          git commit -m "$MSG"
          git push origin publish
```

- [ ] **Step 2: Revisión estática del YAML**

Run (Bash): `node -e "require('node:fs').readFileSync('.github/workflows/publish.yml','utf8')" && pnpm exec prettier --check .github/workflows/publish.yml`
Expected: Prettier OK (si no, `--write`). No se puede correr la Action en local: la prueba real es
el primer tag, después del merge.

- [ ] **Step 3: `docs/publicacion.md`**

Guía en español para el mantenedor, que nunca usó Cloudflare. Antes de escribir los pasos de
Cloudflare, confirmar los nombres actuales de la interfaz en la documentación oficial de Pages
(`https://developers.cloudflare.com/pages/get-started/git-integration/` y
`https://developers.cloudflare.com/pages/configuration/branch-build-controls/`) con WebFetch, y
usar los nombres que figuren ahí. Secciones:

1. **Cómo funciona** — rama `publish` huérfana que acumula carpetas; la Action (`publish.yml`) y
   sus disparadores (tag, push a `main` en `site/`, cron diario, a mano); Cloudflare solo sirve la
   rama; las carpetas son inmutables (la Action falla si el tag repite una versión o no coincide con
   `package.json`).
2. **Publicar una versión** — PR que sube `package.json.version`; después del merge, desde `main`
   actualizado: `git tag v0.1.0` y `git push origin v0.1.0`; mirar la Action en la pestaña Actions
   de GitHub.
3. **Primera vez: Cloudflare** (después de que la primera Action creó la rama `publish`):
   crear la cuenta (gratis); Workers & Pages → crear → Pages → conectar con Git → autorizar la app
   de Cloudflare en GitHub solo para este repo; nombre del proyecto `offline-pos` (si está tomado,
   otro: queda `https://<nombre>.pages.dev`); rama de producción `publish`; framework preset
   "None"; comando de build vacío; directorio de salida `/` (o vacío, según pida la interfaz);
   guardar y desplegar.
4. **Desactivar los preview deployments** — en la configuración del proyecto, builds de ramas de
   preview: "None" (si no, cada push a `main` u otra rama publicaría la raíz del repo como sitio de
   preview).
5. **Verificar** — `https://<proyecto>.pages.dev/` redirige a `/versions/`; `/versions/` lista
   `0.1.0`; `/0.1.0` redirige a `/0.1.0/`; `curl -I https://<proyecto>.pages.dev/0.1.0/assets/<un
   archivo>` muestra `cache-control: public, max-age=31536000, immutable`; el link de demo con el
   demo-backend local levantado abre el POS (aceptar el permiso de red local de Chrome) y entra a la
   venta; `/DIAGNOSTICO` muestra `POS 0.1.0 · almacenamiento offline-pos@/0.1.0/`.
6. **Sumar un backend a `/versions`** — PR a `site/backends.json` (`name`, `url` https, `notes`);
   el backend tiene que ofrecer `demo-sessions`; al mergear, la Action regenera `/versions`.
7. **Si la Action falla** — leer el paso que falló: tag que no coincide (borrar el tag remoto con
   `git push origin :refs/tags/vX.Y.Z`, corregir y volver a taggear), versión ya publicada (subir el
   número), backend que no contesta (la página queda como estaba; se reintenta al otro día o a mano
   desde Actions → Publicación → Run workflow).
8. **Dominio propio (#150)** — cuando llegue: en el proyecto de Pages → dominios personalizados; el
   almacenamiento es por origen, así que es una instalación nueva para cada terminal.

- [ ] **Step 4: Commit**

```bash
pnpm exec prettier --write .github/workflows/publish.yml docs/publicacion.md
git add .github/workflows/publish.yml docs/publicacion.md
git commit -m "ci: publicación por tag a la rama publish y guía de Cloudflare Pages (#148)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Versión `0.1.0`, `AGENTS.md` y cierre de la etapa

**Files:**
- Modify: `package.json` (`"version": "0.1.0"`)
- Modify: `AGENTS.md`
- Modify: `src/storage/AGENTS.md`
- Modify: `docs/historia.md`

- [ ] **Step 1: Versión**

`package.json`: `"version": "0.0.0"` → `"version": "0.1.0"`.

- [ ] **Step 2: `AGENTS.md` de la raíz**

- "Onboarding de demo": reemplazar "(nada fijo en el código; tiene que poder embeberse en el deploy
  de un backend, sin cambiar `base` de Vite para el MVP)" por "(nada fijo en el código; el build usa
  `base: './'` desde #148, así el mismo `dist/` anda en cualquier carpeta, incluido el deploy de un
  backend)".
- "Estructura de proyecto": sumar `site/  # publicación (#148): carpeta por versión, /versions, docs; no es parte de la app`
  y en `docs/` mencionar `integradores/` y `publicacion.md`.
- Sección nueva "Publicación (#148)", después de "Onboarding de demo", corta: carpetas
  inmutables `/<x.y.z>/` en Cloudflare Pages (rama `publish`, deploy por tag `vX.Y.Z`); almacenamiento
  por carpeta (`storage/storage-namespace.ts`, `/` sigue siendo `offline-pos`; detalle en
  `src/storage/AGENTS.md`); `/versions` cruza todas las carpetas con `site/backends.json`, que es un
  dato del sitio (la app no lo lee) y cambia por PR, y el contrato y las capacidades se consultan en
  vivo (`POST /demo-sessions` → `GET /info`; #151); docs en `docs/integradores/`; guía del
  mantenedor en `docs/publicacion.md`. Cambiar de carpeta, de versión o de dominio es una
  instalación nueva (canal estable pendiente, #54).
- "Estado del proyecto": sumar la fila del deploy (#148) con su PR; "Siguiente" pasa a "después del
  MVP: #112 + #111 y #102"; en "Issues abiertas" sacar #148 y sumar #151 (`backlog`) en "Pantallas y
  publicación".

- [ ] **Step 3: `src/storage/AGENTS.md`**

Párrafo nuevo "Almacenamiento por carpeta (#148)": `storage-namespace.ts` calcula una vez, desde
`location.pathname`, el nombre de la base de Dexie y el prefijo de `localStorage`; en `/`
`offline-pos` y `offline-pos:` (las terminales de antes no se enteran), en `/0.1.0/`
`offline-pos@/0.1.0/`; toda clave nueva pasa por `storageKey('<nombre>')`, nunca un literal
`'offline-pos:…'` (lo vigila `storage-keys.test.ts`); el borrado y el volcado por prefijo nunca
tocan otra carpeta.

- [ ] **Step 4: `docs/historia.md`**

Leer cómo está escrita la última entrada y sumar una del mismo estilo para #148: qué trajo
(carpetas por versión, almacenamiento por ruta, `/versions` en vivo, docs, Action, Cloudflare), las
decisiones del brainstorming (0.1.0, lista de backends como dato del sitio, consulta vía
`demo-sessions` sin cambio de contrato y #151) y los desvíos del plan si los hubo.

- [ ] **Step 5: Verificación final completa**

Run: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }; if ($?) { pnpm --filter demo-backend run test }; if ($?) { pnpm test:e2e }`
Expected: todo pasa. `/DIAGNOSTICO` en `pnpm site:build` + `pnpm site:preview` muestra
`POS 0.1.0 · almacenamiento offline-pos@/0.1.0/`.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write package.json AGENTS.md src/storage/AGENTS.md docs/historia.md
git add package.json AGENTS.md src/storage/AGENTS.md docs/historia.md
git commit -m "docs: AGENTS.md con la publicación del MVP; versión 0.1.0 (#148)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Informe final y prueba manual**

Informe al usuario (en español) con lo hecho, desvíos y la prueba manual en local:

1. `pnpm site:build` y `pnpm site:preview`; en otra terminal, `pnpm --filter demo-backend run start`.
2. Abrir `http://localhost:4174/versions/`: la fila `0.1.0`, el backend local con contrato 4.4.0 y
   capacidades, links de demo, docs y zip (el zip da 404 en local: lo arma la Action).
3. Click en "Abrir demo": el POS en `/0.1.0/` entra a la venta en DEMO.
4. `/DIAGNOSTICO`: `POS 0.1.0 · almacenamiento offline-pos@/0.1.0/`.
5. En DevTools → Application: la base `offline-pos@/0.1.0/` y las claves con ese prefijo.
6. `http://localhost:4174/0.1.0/docs/`: la guía, con links al OpenAPI y a `llms.txt`.
7. `pnpm dev` en `/` sigue usando `offline-pos` (la terminal de siempre no cambió).

- [ ] **Step 8: Push y PR (después de la revisión del usuario y sus cambios)**

Push de la rama y PR a `main` con el cuerpo en un archivo (`gh pr create -R rauldiazsolis/offline-pos
--body-file <archivo>`), con **"Refs #148"** (no "Closes": #148 se cierra a mano después de la
primera publicación y de verificar Local Network Access) y el pie
"🤖 Generated with [Claude Code](https://claude.com/claude-code)". Merge commit, nunca squash.

## Después del merge (con el usuario)

1. El usuario sigue `docs/publicacion.md`: tag `v0.1.0` → la Action crea `publish` → cuenta y
   proyecto de Cloudflare → preview deployments desactivados.
2. Prueba en `https://<proyecto>.pages.dev/` (sección "Verificar" de la guía), incluido el permiso de
   red local de Chrome contra `http://localhost:4000`. Si el permiso no alcanza (p. ej. hace falta
   `targetAddressSpace` en el `fetch`), el arreglo va en esta etapa como `0.1.1`.
3. Con todo verificado: cerrar #148 con un comentario que apunte al PR y a la URL publicada, y tildar
   #148 en el epic #134 ("— PR #N").
