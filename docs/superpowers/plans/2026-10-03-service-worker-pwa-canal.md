# Service worker, PWA y canal `/v4/` — plan de implementación

> **Para quien ejecuta:** se ejecuta **inline** con `superpowers:executing-plans`, tarea por tarea con
> checkpoints (convención del repo, "Cómo trabajamos" en `AGENTS.md`). Los pasos usan `- [ ]`.

**Objetivo:** el POS abre sin red, se instala como PWA en `pos.contax.ar/v4/` y recibe las versiones
nuevas por su service worker; la publicación pasa de carpetas por versión a un canal por major del
contrato, con una home de backends.

**Arquitectura:** un service worker propio (`src/workers/sw.ts`, lógica pura en `sw-logic.ts`)
compilado por un plugin de Vite en un segundo build `iife` con la lista de archivos inyectada; un
adaptador en `ui/service-worker.ts` lo registra y publica el estado en signals; `/ACTUALIZAR` lo
aplica reusando la suelta de #175. `site/` reemplaza la carpeta por versión por `v<major>/` y
`/versions` por la home.

**Stack:** Vite 8 (API `build` para el segundo build), TypeScript estricto, Preact + signals, Zod,
Vitest, Playwright, Node 24 (type stripping) para `site/` y `build/`.

**Spec:** `docs/superpowers/specs/2026-10-03-service-worker-pwa-canal-design.md`.

## Restricciones globales

- Cero dependencias nuevas (ni `vite-plugin-pwa` ni Workbox).
- Todo en español: textos de UI, comentarios, commits.
- `any` prohibido; `unknown` solo en el borde y validado con Zod en la línea siguiente.
- `try/catch` solo en adaptadores (`ui/service-worker.ts`, `sync/terminal-data.ts`, `build/`, `site/`).
- Nombre de caché: `<namespace de la carpeta>:sw:<hash>` (`offline-pos:sw:…` en `/`,
  `offline-pos@/v4/:sw:…` en `/v4/`). Un canal nunca toca la caché ni el registro de otro.
- Textos exactos: botón "Versión nueva (/ACTUALIZAR)"; aviso "Terminá o descartá la venta para
  actualizar."; falla "No se pudo actualizar: cerrá y abrí el POS."; mientras aplica,
  "Actualizando…".
- Topes: `RELEASE_WAIT_MS` (4 s, ya existe) para soltar; `APPLY_TIMEOUT_MS = 10_000`;
  `UPDATE_CHECK_INTERVAL_MS = 3_600_000`.
- La publicación se niega a bajar o repetir la versión del canal.
- Cada commit pasa `pnpm lint && pnpm typecheck && pnpm test` (y `pnpm build` cuando toca el build);
  `pnpm test:e2e` en la tarea de e2e y al final.

## Mapa de archivos

| Archivo | Qué hace |
|---|---|
| `src/storage/namespace-rules.ts` (nuevo) | `storageNamespaceFor`, `localStoragePrefixFor`: puras, sin `window` (las usa el service worker) |
| `src/storage/storage-namespace.ts` | Las reexporta; sigue calculando `STORAGE_NAMESPACE` al cargar |
| `src/workers/sw-logic.ts` (nuevo) | Nombre y prefijo de caché, ruteo de requests, cachés viejas, mensaje `skip-waiting` |
| `src/workers/sw.ts` (nuevo) | Los eventos del service worker |
| `tsconfig.sw.json` (nuevo) | `sw.ts` con `lib: WebWorker` |
| `build/precache.ts` (nuevo) | Lista de archivos de `dist/` y su hash |
| `build/sw-plugin.ts` (nuevo) | Plugin de Vite: segundo build de `sw.js` con la lista inyectada |
| `public/manifest.webmanifest`, `public/icon-*.png` (nuevos) | Manifest e íconos |
| `scripts/generate-icons.ts` (nuevo) | Saca los PNG del `favicon.svg` con Playwright (se corre una vez) |
| `src/ui/state/app-update.ts` (nuevo) | `appUpdateSignal`, `serviceWorkerStateSignal` |
| `src/ui/service-worker.ts` (nuevo) | Adaptador: registro, búsqueda de versiones, `skip-waiting`, baja del registro y cachés |
| `src/ui/keyboard/app-update-controller.ts` (nuevo) | `/ACTUALIZAR` |
| `src/ui/tab-release.ts` | `prepareTabRelease` devuelve con qué deshacer la suelta |
| `src/ui/keyboard/commands.ts`, `command-bar-controller.ts`, `components/StatusBar.tsx` | El comando y el botón |
| `src/sync/terminal-data.ts`, `src/ui/console/pos-console.ts` | `pos.reset()` borra service worker y cachés |
| `src/sync/diagnostics.ts`, `src/ui/screens/diagnostico-screen.tsx` | Estado del service worker |
| `site/channel-info.ts` (reemplaza `version-info.ts`) | Canales publicados |
| `site/build-channel.ts` (reemplaza `build-version.ts`) | Arma `v<major>/` |
| `site/cleanup.ts` (nuevo) | Borra `x.y.z/`, `*.zip`, `versions/` |
| `site/home-page.ts`, `site/build-home-page.ts` (reemplazan `versions-page.ts`, `build-versions-page.ts`) | La home |
| `.github/workflows/publish.yml` | Canal, limpieza, sin zip |
| `e2e/pwa.spec.ts` (nuevo), `e2e/published-site.spec.ts`, `playwright.config.ts` | E2E |

---

### Task 1: Reglas del namespace sin `window` y lógica pura del service worker

**Files:**
- Create: `src/storage/namespace-rules.ts`, `src/workers/sw-logic.ts`, `src/workers/sw-logic.test.ts`
- Modify: `src/storage/storage-namespace.ts`

**Interfaces:**
- Produces: `storageNamespaceFor(pathname: string): string`, `localStoragePrefixFor(pathname: string): string` (en `namespace-rules.ts`, reexportadas desde `storage-namespace.ts`);
  `swCachePrefix(scopeUrl: string): string`, `swCacheName(scopeUrl: string, hash: string): string`,
  `type SwRoute = { kind: 'navigation' } | { kind: 'precached'; url: string } | { kind: 'network' }`,
  `routeRequest(request: { method: string; url: string; mode: string }, scopeUrl: string, precached: ReadonlySet<string>): SwRoute`,
  `staleCaches(cacheNames: readonly string[], scopeUrl: string, currentName: string): string[]`,
  `type SwMessage = { type: 'skip-waiting' }`, `parseSwMessage(data: unknown): SwMessage | null`.

- [ ] **Step 1: Mover las funciones puras.** Crear `src/storage/namespace-rules.ts` con
  `BASE_NAME`, `storageNamespaceFor` y `localStoragePrefixFor` copiadas tal cual de
  `storage-namespace.ts` (con sus comentarios), y en `storage-namespace.ts` reemplazarlas por:

```ts
import { localStoragePrefixFor, storageNamespaceFor } from './namespace-rules.ts';

export { localStoragePrefixFor, storageNamespaceFor };
```

  (el resto de `storage-namespace.ts` queda igual). Comentario arriba de `namespace-rules.ts`:
  "Puras y sin `window`: también las usa el service worker (#54), donde no hay `location` de página."

- [ ] **Step 2: Correr los tests del namespace.** `pnpm vitest run src/storage` → PASS (no cambió
  nada observable).

- [ ] **Step 3: Escribir el test de `sw-logic`** (`src/workers/sw-logic.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { parseSwMessage, routeRequest, staleCaches, swCacheName, swCachePrefix } from './sw-logic.ts';

const SCOPE = 'https://pos.x/v4/';
const PRECACHED = new Set(['https://pos.x/v4/index.html', 'https://pos.x/v4/assets/app-1.js']);
const get = (url: string, mode = 'cors') => ({ method: 'GET', url, mode });

describe('caché del service worker por carpeta (#54)', () => {
  it('el prefijo sale de la carpeta del scope, con el criterio del almacenamiento', () => {
    expect(swCachePrefix('https://pos.x/')).toBe('offline-pos:sw:');
    expect(swCachePrefix(SCOPE)).toBe('offline-pos@/v4/:sw:');
    expect(swCachePrefix('https://pos.x/pos/v4/')).toBe('offline-pos@/pos/v4/:sw:');
    expect(swCacheName(SCOPE, 'abc')).toBe('offline-pos@/v4/:sw:abc');
  });

  it('borra solo las cachés viejas de su carpeta', () => {
    const names = [
      'offline-pos@/v4/:sw:viejo',
      'offline-pos@/v4/:sw:actual',
      'offline-pos@/v5/:sw:otro',
      'offline-pos:sw:raiz',
      'offline-pos@/v4/sub/:sw:hija',
      'otra-app',
    ];
    expect(staleCaches(names, SCOPE, 'offline-pos@/v4/:sw:actual')).toEqual([
      'offline-pos@/v4/:sw:viejo',
    ]);
    expect(staleCaches(names, 'https://pos.x/', 'offline-pos:sw:nuevo')).toEqual([
      'offline-pos:sw:raiz',
    ]);
  });
});

describe('routeRequest', () => {
  it('una navegación dentro del scope recibe el index, con o sin query', () => {
    expect(routeRequest(get('https://pos.x/v4/', 'navigate'), SCOPE, PRECACHED)).toEqual({
      kind: 'navigation',
    });
    expect(
      routeRequest(get('https://pos.x/v4/?demo=true&backend=x', 'navigate'), SCOPE, PRECACHED),
    ).toEqual({ kind: 'navigation' });
  });

  it('un archivo de la lista sale de la caché, sin la query', () => {
    expect(routeRequest(get('https://pos.x/v4/assets/app-1.js?x=1'), SCOPE, PRECACHED)).toEqual({
      kind: 'precached',
      url: 'https://pos.x/v4/assets/app-1.js',
    });
  });

  it('todo lo demás va a la red', () => {
    for (const request of [
      get('https://backend.y/sync/pull'),
      get('https://pos.x/v5/', 'navigate'),
      get('https://pos.x/', 'navigate'),
      get('https://pos.x/v4/version.json'),
      { method: 'POST', url: 'https://pos.x/v4/index.html', mode: 'cors' },
    ]) {
      expect(routeRequest(request, SCOPE, PRECACHED)).toEqual({ kind: 'network' });
    }
  });
});

describe('parseSwMessage', () => {
  it('solo reconoce skip-waiting', () => {
    expect(parseSwMessage({ type: 'skip-waiting' })).toEqual({ type: 'skip-waiting' });
    expect(parseSwMessage({ type: 'otra' })).toBeNull();
    expect(parseSwMessage('skip-waiting')).toBeNull();
  });
});
```

- [ ] **Step 4: Correr el test.** `pnpm vitest run src/workers` → FAIL (no existe `sw-logic.ts`).

- [ ] **Step 5: Implementar `src/workers/sw-logic.ts`:**

```ts
import { z } from 'zod';
import { storageNamespaceFor } from '../storage/namespace-rules.ts';

/**
 * Lógica pura del service worker (#54), sin eventos ni `caches`: la capa fina es `sw.ts`. La Cache
 * Storage es una sola por origen, así que el nombre de caché sale de la carpeta del `scope` con el
 * mismo criterio que el almacenamiento (`/v4/` → `offline-pos@/v4/`): un canal nunca toca la caché
 * de otro.
 */
export function swCachePrefix(scopeUrl: string): string {
  return `${storageNamespaceFor(new URL(scopeUrl).pathname)}:sw:`;
}

export function swCacheName(scopeUrl: string, hash: string): string {
  return `${swCachePrefix(scopeUrl)}${hash}`;
}

export type SwRoute = { kind: 'navigation' } | { kind: 'precached'; url: string } | { kind: 'network' };

/**
 * Solo GET del mismo origen y dentro del `scope`. Una navegación recibe el `index.html` (la query,
 * como `?demo=…`, la lee la app); un archivo del build, su copia; todo lo demás (el backend,
 * `version.json`, otra carpeta) va a la red sin tocarlo.
 */
export function routeRequest(
  request: { method: string; url: string; mode: string },
  scopeUrl: string,
  precached: ReadonlySet<string>,
): SwRoute {
  if (request.method !== 'GET') {
    return { kind: 'network' };
  }
  const url = new URL(request.url);
  const scope = new URL(scopeUrl);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) {
    return { kind: 'network' };
  }
  if (request.mode === 'navigate') {
    return { kind: 'navigation' };
  }
  const bare = `${url.origin}${url.pathname}`;
  return precached.has(bare) ? { kind: 'precached', url: bare } : { kind: 'network' };
}

/** Las cachés de esta carpeta que no son la actual: nunca las de otra carpeta ni las ajenas. */
export function staleCaches(
  cacheNames: readonly string[],
  scopeUrl: string,
  currentName: string,
): string[] {
  const prefix = swCachePrefix(scopeUrl);
  return cacheNames.filter((name) => name.startsWith(prefix) && name !== currentName);
}

const swMessageSchema = z.object({ type: z.literal('skip-waiting') });
export type SwMessage = z.infer<typeof swMessageSchema>;

/** El único mensaje que atiende: aplicar la versión en espera (`/ACTUALIZAR`). */
export function parseSwMessage(data: unknown): SwMessage | null {
  const parsed = swMessageSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
```

  Ojo con `offline-pos@/v4/sub/:sw:hija`: no empieza con `offline-pos@/v4/:sw:` (después de
  `/v4/` viene `sub`, no `:`), así que no se borra. El test lo fija.

- [ ] **Step 6: Correr.** `pnpm vitest run src/workers src/storage` → PASS. Después
  `pnpm lint && pnpm typecheck`.

- [ ] **Step 7: Commit.**

```bash
git add src/storage/namespace-rules.ts src/storage/storage-namespace.ts src/workers/sw-logic.ts src/workers/sw-logic.test.ts
git commit -m "feat(sw): lógica pura del service worker y reglas del namespace sin window (#54)"
```

---

### Task 2: `sw.js` en el build

**Files:**
- Create: `build/precache.ts`, `build/precache.test.ts`, `build/sw-plugin.ts`, `src/workers/sw.ts`, `tsconfig.sw.json`
- Modify: `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
- Delete: `src/workers/.gitkeep` si existe

**Interfaces:**
- Consumes: `routeRequest`, `staleCaches`, `swCacheName`, `parseSwMessage` (Task 1).
- Produces: `collectPrecache(outDir: string): { files: string[]; hash: string }`;
  `serviceWorkerPlugin(): Plugin`; `dist/sw.js` (script clásico) con `skip-waiting` como único mensaje.

- [ ] **Step 1: Test de `build/precache.ts`** (`build/precache.test.ts`):

```ts
// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectPrecache } from './precache.ts';

function dist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'precache-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

describe('collectPrecache (#54)', () => {
  it('lista todo el build en orden, con barras, sin sw.js', () => {
    const dir = dist({
      'index.html': '<html>',
      'assets/app-1.js': 'x',
      'favicon.svg': '<svg>',
      'sw.js': 'viejo',
    });
    expect(collectPrecache(dir).files).toEqual(['assets/app-1.js', 'favicon.svg', 'index.html']);
  });

  it('el hash cambia si cambia el contenido de un archivo, y no si cambia sw.js', () => {
    const a = collectPrecache(dist({ 'index.html': 'a', 'sw.js': '1' })).hash;
    expect(collectPrecache(dist({ 'index.html': 'a', 'sw.js': '2' })).hash).toBe(a);
    expect(collectPrecache(dist({ 'index.html': 'b', 'sw.js': '1' })).hash).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});
```

- [ ] **Step 2: Correr.** `pnpm vitest run build` → FAIL.

- [ ] **Step 3: Implementar `build/precache.ts`:**

```ts
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const SW_FILE = 'sw.js';

/**
 * Lo que el service worker guarda al instalarse (#54): todo el build menos él mismo, con rutas
 * relativas (se resuelven contra la URL de `sw.js`, así anda en cualquier carpeta), y un hash del
 * contenido que nombra la caché: un build distinto, una caché nueva.
 */
export function collectPrecache(outDir: string): { files: string[]; hash: string } {
  const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(outDir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((path) => path !== SW_FILE)
    .sort();
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(path).update('\0').update(readFileSync(join(outDir, path))).update('\0');
  }
  return { files, hash: hash.digest('hex').slice(0, 16) };
}
```

- [ ] **Step 4: Correr.** `pnpm vitest run build` → PASS.

- [ ] **Step 5: El service worker** (`src/workers/sw.ts`):

```ts
import { parseSwMessage, routeRequest, staleCaches, swCacheName } from './sw-logic.ts';

/**
 * Service worker del POS (#54). Lo compila `build/sw-plugin.ts` como script clásico, con la lista de
 * archivos del build y su hash inyectados. Nunca se activa solo si ya hay una versión andando: espera
 * a `/ACTUALIZAR` (mensaje `skip-waiting`) o a que no quede ninguna pestaña del POS abierta.
 */
declare const self: ServiceWorkerGlobalScope;
declare const __PRECACHE_FILES__: string[];
declare const __PRECACHE_HASH__: string;

const scope = self.registration.scope;
const cacheName = swCacheName(scope, __PRECACHE_HASH__);
const precacheUrls = __PRECACHE_FILES__.map((file) => new URL(file, self.location.href).href);
const precached = new Set(precacheUrls);
const indexUrl = new URL('index.html', self.location.href).href;

self.addEventListener('install', (event) => {
  // Todo o nada: si falla un archivo, falla la instalación y queda la versión anterior. `reload`
  // saltea la caché HTTP, así nunca se guarda un archivo viejo con el nombre de uno nuevo.
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) =>
        cache.addAll(precacheUrls.map((url) => new Request(url, { cache: 'reload' }))),
      ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(staleCaches(names, scope, cacheName).map((name) => caches.delete(name))),
      ),
  );
});

self.addEventListener('fetch', (event) => {
  const { method, url, mode } = event.request;
  const route = routeRequest({ method, url, mode }, scope, precached);
  if (route.kind === 'network') {
    return;
  }
  const target = route.kind === 'navigation' ? indexUrl : route.url;
  event.respondWith(
    caches
      .open(cacheName)
      .then((cache) => cache.match(target))
      .then((cached) => cached ?? fetch(event.request)),
  );
});

self.addEventListener('message', (event) => {
  if (parseSwMessage(event.data) !== null) {
    void self.skipWaiting();
  }
});
```

- [ ] **Step 6: Tipos.** Crear `tsconfig.sw.json` (copia de `tsconfig.app.json` con estos cambios:
  `"tsBuildInfoFile": "./node_modules/.tmp/tsconfig.sw.tsbuildinfo"`, `"lib": ["ES2023", "WebWorker"]`,
  `"types": []`, sin `jsx`, `jsxImportSource` ni `paths`, `"include": ["src/workers/sw.ts"]`).
  En `tsconfig.app.json`: `"exclude": ["src/workers/sw.ts"]`. En `tsconfig.json`: sumar
  `{ "path": "./tsconfig.sw.json" }` a `references`. En `tsconfig.node.json`: `"include"` suma
  `"build"` y `"scripts"`. `pnpm typecheck` → PASS. Si `pnpm lint` no encuentra el proyecto de
  `sw.ts` (`projectService`), sumar `allowDefaultProject` no: revisar que `tsconfig.json` lo
  referencie y que `tsconfig.app.json` lo excluya.

- [ ] **Step 7: El plugin** (`build/sw-plugin.ts`):

```ts
import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';
import { collectPrecache, SW_FILE } from './precache.ts';

/**
 * `sw.js` (#54): al terminar el build de la app (con `public/` ya copiado), un segundo build de
 * `src/workers/sw.ts` como script clásico en un solo archivo, con la lista de `dist/` inyectada. Un
 * build aparte para que nunca comparta chunks con la app. Solo en `vite build`.
 */
export function serviceWorkerPlugin(): Plugin {
  let root = '';
  let outDir = '';
  return {
    name: 'pos-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const { files, hash } = collectPrecache(outDir);
      await build({
        configFile: false,
        root,
        logLevel: 'warn',
        publicDir: false,
        define: {
          __PRECACHE_FILES__: JSON.stringify(files),
          __PRECACHE_HASH__: JSON.stringify(hash),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          lib: {
            entry: resolve(root, 'src/workers/sw.ts'),
            formats: ['iife'],
            name: 'posServiceWorker',
            fileName: () => SW_FILE,
          },
        },
      });
    },
  };
}
```

  En `vite.config.ts`: `import { serviceWorkerPlugin } from './build/sw-plugin.ts';` y
  `plugins: [preact(), serviceWorkerPlugin()]`.

- [ ] **Step 8: Verificar el build.** `pnpm build` y después:

```bash
node -e "const s=require('fs').readFileSync('dist/sw.js','utf8'); if(!s.includes('index.html')||!s.includes('assets/')||s.includes('__PRECACHE')) process.exit(1); console.log('ok', s.length)"
```

  Expected: `ok <tamaño>`. Si Vite avisa que `lib` con `iife` necesita `name`, ya está. Si
  `closeBundle` corre antes de copiar `public/` (no debería), cambiar a `writeBundle` y verificar que
  `favicon.svg` esté en la lista.

- [ ] **Step 9: `pnpm lint && pnpm typecheck && pnpm test` → PASS. Commit.**

```bash
git add build src/workers tsconfig*.json vite.config.ts
git commit -m "feat(sw): service worker propio compilado en el build con la lista de archivos (#54)"
```

---

### Task 3: Manifest e íconos

**Files:**
- Create: `scripts/generate-icons.ts`, `public/manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`
- Modify: `index.html`

- [ ] **Step 1: El script** (`scripts/generate-icons.ts`):

```ts
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

/**
 * Íconos de la PWA (#54), sacados del `favicon.svg` con el Chromium de Playwright: se corre a mano
 * una vez (`node scripts/generate-icons.ts`) y los PNG se commitean. Ningún generador como
 * dependencia. El maskable deja más margen: Android lo recorta en círculo.
 */
const ICONS = [
  { file: 'icon-192.png', size: 192, padding: 0.12 },
  { file: 'icon-512.png', size: 512, padding: 0.12 },
  { file: 'icon-maskable-512.png', size: 512, padding: 0.22 },
];
const BACKGROUND = '#12141c'; // --color-chrome-bg de tokens.css

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url)).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, padding } of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;width:${String(size)}px;height:${String(size)}px;
    background:${BACKGROUND};display:grid;place-items:center">
    <img src="data:image/svg+xml;base64,${svg}" style="width:${String(Math.round(size * (1 - 2 * padding)))}px"></body>`);
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
}
await browser.close();
console.log('Íconos generados en public/');
```

- [ ] **Step 2: Generarlos.** `node scripts/generate-icons.ts` y abrir los tres PNG para mirarlos
  (Read del archivo): el logo centrado sobre fondo oscuro.

- [ ] **Step 3: El manifest** (`public/manifest.webmanifest`):

```json
{
  "name": "POS",
  "short_name": "POS",
  "id": "./",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#12141c",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 4: `index.html`.** En `<head>`, después del favicon:

```html
    <link rel="manifest" href="./manifest.webmanifest" />
    <meta name="theme-color" content="#12141c" />
```

- [ ] **Step 5: Verificar.** `pnpm build` y `ls dist` muestra el manifest y los íconos; el script de
  verificación de la Task 2 (Step 8) sigue en `ok` y `dist/sw.js` contiene `manifest.webmanifest`.
  `pnpm lint && pnpm typecheck`.

- [ ] **Step 6: Commit.**

```bash
git add scripts public index.html
git commit -m "feat(pwa): manifest e íconos del canal (#54)"
```

---

### Task 4: Registro del service worker y estado en signals

**Files:**
- Create: `src/ui/state/app-update.ts`, `src/ui/service-worker.ts`, `src/ui/service-worker.test.ts`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces:
  - `type AppUpdateState = 'none' | 'available' | 'applying'`, `appUpdateSignal: Signal<AppUpdateState>`.
  - `type ServiceWorkerState = 'unsupported' | 'installing' | 'ready'`, `serviceWorkerStateSignal`.
  - `UPDATE_CHECK_INTERVAL_MS = 3_600_000`.
  - `startServiceWorker(options?: { enabled?: boolean; container?: ServiceWorkerContainer | undefined; setInterval?: (fn: () => void, ms: number) => unknown }): Promise<void>`.
  - `requestSkipWaiting(): boolean` (manda `skip-waiting` al que espera; `false` si no hay).
  - `waitForControllerChange(timeoutMs: number, container?: ServiceWorkerContainer | undefined): Promise<boolean>`.
  - `removeOwnServiceWorker(options?: { scopeUrl?: string; container?: ServiceWorkerContainer | undefined; cacheStorage?: CacheStorage | undefined }): Promise<void>`.

- [ ] **Step 1: El estado** (`src/ui/state/app-update.ts`):

```ts
import { signal } from '@preact/signals';

/**
 * Versión nueva del POS (#54): `available` cuando el service worker ya descargó una y espera,
 * `applying` mientras `/ACTUALIZAR` la aplica.
 */
export type AppUpdateState = 'none' | 'available' | 'applying';
export const appUpdateSignal = signal<AppUpdateState>('none');

/**
 * Si el POS abre sin red (#54): `ready` con un service worker activo, `installing` mientras se
 * instala el primero, `unsupported` sin service worker (contexto no seguro, dev o registro fallido).
 */
export type ServiceWorkerState = 'unsupported' | 'installing' | 'ready';
export const serviceWorkerStateSignal = signal<ServiceWorkerState>('unsupported');
```

- [ ] **Step 2: Test del adaptador** (`src/ui/service-worker.test.ts`), con un contenedor falso:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appUpdateSignal, serviceWorkerStateSignal } from './state/app-update.ts';
import {
  removeOwnServiceWorker,
  requestSkipWaiting,
  startServiceWorker,
  UPDATE_CHECK_INTERVAL_MS,
} from './service-worker.ts';

type Listener = () => void;

function fakeWorker(state: string) {
  const listeners: Listener[] = [];
  return {
    state,
    postMessage: vi.fn(),
    addEventListener: (_type: string, fn: Listener) => listeners.push(fn),
    become(next: string) {
      this.state = next;
      for (const fn of listeners) fn();
    },
  };
}

function fakeRegistration(init: { active?: unknown; waiting?: unknown; scope?: string }) {
  const listeners: Listener[] = [];
  return {
    scope: init.scope ?? 'https://pos.x/v4/',
    active: init.active ?? null,
    waiting: init.waiting ?? null,
    installing: null as ReturnType<typeof fakeWorker> | null,
    update: vi.fn(() => Promise.resolve()),
    unregister: vi.fn(() => Promise.resolve(true)),
    addEventListener: (_type: string, fn: Listener) => listeners.push(fn),
    found(worker: ReturnType<typeof fakeWorker>) {
      this.installing = worker;
      for (const fn of listeners) fn();
    },
  };
}

function fakeContainer(registration: ReturnType<typeof fakeRegistration>, controller: unknown) {
  return {
    controller,
    register: vi.fn(() => Promise.resolve(registration)),
    getRegistrations: vi.fn(() => Promise.resolve([registration])),
    addEventListener: vi.fn(),
  } as unknown as ServiceWorkerContainer;
}

beforeEach(() => {
  appUpdateSignal.value = 'none';
  serviceWorkerStateSignal.value = 'unsupported';
});

describe('startServiceWorker (#54)', () => {
  it('sin service worker o fuera del build no hace nada', async () => {
    await startServiceWorker({ enabled: true, container: undefined });
    await startServiceWorker({ enabled: false, container: fakeContainer(fakeRegistration({}), null) });
    expect(serviceWorkerStateSignal.value).toBe('unsupported');
  });

  it('registra sw.js relativo, queda lista con uno activo y busca versiones cada hora', async () => {
    const registration = fakeRegistration({ active: {} });
    const container = fakeContainer(registration, {});
    const setInterval = vi.fn();
    await startServiceWorker({ enabled: true, container, setInterval });
    expect(container.register).toHaveBeenCalledWith('./sw.js');
    expect(serviceWorkerStateSignal.value).toBe('ready');
    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), UPDATE_CHECK_INTERVAL_MS);
  });

  it('una versión que ya espera al arrancar es una versión nueva', async () => {
    const registration = fakeRegistration({ active: {}, waiting: fakeWorker('installed') });
    await startServiceWorker({ enabled: true, container: fakeContainer(registration, {}), setInterval: vi.fn() });
    expect(appUpdateSignal.value).toBe('available');
  });

  it('una que termina de instalarse con otra andando también; la primera instalación no', async () => {
    const first = fakeRegistration({});
    await startServiceWorker({ enabled: true, container: fakeContainer(first, null), setInterval: vi.fn() });
    expect(serviceWorkerStateSignal.value).toBe('installing');
    const worker = fakeWorker('installing');
    first.found(worker);
    worker.become('installed');
    expect(appUpdateSignal.value).toBe('none');
    worker.become('activated');
    expect(serviceWorkerStateSignal.value).toBe('ready');

    const second = fakeRegistration({ active: {} });
    await startServiceWorker({ enabled: true, container: fakeContainer(second, {}), setInterval: vi.fn() });
    const next = fakeWorker('installing');
    second.found(next);
    next.become('installed');
    expect(appUpdateSignal.value).toBe('available');
  });

  it('un registro que falla deja "sin service worker" y no rompe el arranque', async () => {
    const container = {
      register: vi.fn(() => Promise.reject(new Error('no'))),
    } as unknown as ServiceWorkerContainer;
    await startServiceWorker({ enabled: true, container });
    expect(serviceWorkerStateSignal.value).toBe('unsupported');
  });
});

describe('requestSkipWaiting', () => {
  it('le manda skip-waiting al que espera', async () => {
    const waiting = fakeWorker('installed');
    const registration = fakeRegistration({ active: {}, waiting });
    await startServiceWorker({ enabled: true, container: fakeContainer(registration, {}), setInterval: vi.fn() });
    expect(requestSkipWaiting()).toBe(true);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' });
  });
});

describe('removeOwnServiceWorker (pos.reset)', () => {
  it('da de baja solo el registro de su carpeta y borra solo sus cachés', async () => {
    const own = fakeRegistration({ scope: 'https://pos.x/v4/' });
    const parent = fakeRegistration({ scope: 'https://pos.x/' });
    const container = {
      getRegistrations: vi.fn(() => Promise.resolve([parent, own])),
    } as unknown as ServiceWorkerContainer;
    const deleted: string[] = [];
    const cacheStorage = {
      keys: () => Promise.resolve(['offline-pos@/v4/:sw:a', 'offline-pos:sw:b', 'offline-pos@/v5/:sw:c']),
      delete: (name: string) => {
        deleted.push(name);
        return Promise.resolve(true);
      },
    } as unknown as CacheStorage;
    await removeOwnServiceWorker({ scopeUrl: 'https://pos.x/v4/', container, cacheStorage });
    expect(own.unregister).toHaveBeenCalled();
    expect(parent.unregister).not.toHaveBeenCalled();
    expect(deleted).toEqual(['offline-pos@/v4/:sw:a']);
  });
});
```

- [ ] **Step 3: Correr.** `pnpm vitest run src/ui/service-worker.test.ts` → FAIL.

- [ ] **Step 4: Implementar `src/ui/service-worker.ts`:**

```ts
import { swCachePrefix } from '../workers/sw-logic.ts';
import { appUpdateSignal, serviceWorkerStateSignal } from './state/app-update.ts';

/** Cada cuánto la pestaña le pregunta al servidor si hay un `sw.js` nuevo (#54). */
export const UPDATE_CHECK_INTERVAL_MS = 3_600_000;

let registration: ServiceWorkerRegistration | undefined;

function browserContainer(): ServiceWorkerContainer | undefined {
  return 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
}

function watchInstalling(container: ServiceWorkerContainer, worker: ServiceWorker): void {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && container.controller !== null) {
      appUpdateSignal.value = 'available';
    }
    if (worker.state === 'activated') {
      serviceWorkerStateSignal.value = 'ready';
    }
  });
}

/**
 * Adaptador del service worker (#54): lo registra con el `scope` de su carpeta, busca versiones al
 * arrancar y cada hora (el navegador solo busca al navegar, y una pestaña de POS queda abierta días),
 * y avisa cuando una nueva quedó esperando. Solo en el build y en la pestaña que manda (lo llama
 * `startApp`). Sin service worker (contexto no seguro) no hace nada; un registro que falla no rompe
 * el arranque.
 */
export async function startServiceWorker({
  enabled = import.meta.env.PROD,
  container = browserContainer(),
  setInterval: every = (fn: () => void, ms: number) => window.setInterval(fn, ms),
}: {
  enabled?: boolean;
  container?: ServiceWorkerContainer | undefined;
  setInterval?: (fn: () => void, ms: number) => unknown;
} = {}): Promise<void> {
  if (!enabled || container === undefined) {
    return;
  }
  try {
    const current = await container.register('./sw.js');
    registration = current;
    serviceWorkerStateSignal.value = current.active !== null ? 'ready' : 'installing';
    if (current.waiting !== null && container.controller !== null) {
      appUpdateSignal.value = 'available';
    }
    current.addEventListener('updatefound', () => {
      if (current.installing !== null) {
        watchInstalling(container, current.installing);
      }
    });
    const check = () => {
      current.update().catch(() => {
        // Sin red: se vuelve a probar en la próxima hora.
      });
    };
    check();
    every(check, UPDATE_CHECK_INTERVAL_MS);
  } catch {
    serviceWorkerStateSignal.value = 'unsupported';
  }
}

/** `/ACTUALIZAR`: le pide al service worker en espera que se active. */
export function requestSkipWaiting(): boolean {
  const waiting = registration?.waiting ?? null;
  if (waiting === null) {
    return false;
  }
  waiting.postMessage({ type: 'skip-waiting' });
  return true;
}

/** `true` si la página pasó a estar controlada por otro service worker antes del tope. */
export function waitForControllerChange(
  timeoutMs: number,
  container: ServiceWorkerContainer | undefined = browserContainer(),
): Promise<boolean> {
  if (container === undefined) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
    container.addEventListener(
      'controllerchange',
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      { once: true },
    );
  });
}

/**
 * `pos.reset()`: da de baja el registro cuyo `scope` es exactamente esta carpeta (el de una carpeta
 * de arriba también la controlaría, y nunca se toca) y borra las cachés con su prefijo.
 */
export async function removeOwnServiceWorker({
  scopeUrl = new URL('./', window.location.href).href,
  container = browserContainer(),
  cacheStorage = 'caches' in window ? window.caches : undefined,
}: {
  scopeUrl?: string;
  container?: ServiceWorkerContainer | undefined;
  cacheStorage?: CacheStorage | undefined;
} = {}): Promise<void> {
  if (container !== undefined) {
    const registrations = await container.getRegistrations();
    await Promise.all(
      registrations.filter((r) => r.scope === scopeUrl).map((r) => r.unregister()),
    );
  }
  if (cacheStorage !== undefined) {
    const prefix = swCachePrefix(scopeUrl);
    const names = await cacheStorage.keys();
    await Promise.all(names.filter((n) => n.startsWith(prefix)).map((n) => cacheStorage.delete(n)));
  }
}
```

- [ ] **Step 5: Correr.** `pnpm vitest run src/ui/service-worker.test.ts` → PASS.

- [ ] **Step 6: Registrar en `main.tsx`.** Import `import { startServiceWorker } from './ui/service-worker.ts';`
  y en `startApp`, después de `installPosConsole();`:

```ts
  // #54: el POS abre sin red y recibe las versiones nuevas. Solo la pestaña que manda.
  void startServiceWorker();
```

- [ ] **Step 7: `pnpm lint && pnpm typecheck && pnpm test` → PASS. Commit.**

```bash
git add src/ui/state/app-update.ts src/ui/service-worker.ts src/ui/service-worker.test.ts src/main.tsx
git commit -m "feat(sw): registrar el service worker y avisar de una versión nueva (#54)"
```

---

### Task 5: `/ACTUALIZAR`

**Files:**
- Create: `src/ui/keyboard/app-update-controller.ts`, `src/ui/keyboard/app-update-controller.test.ts`
- Modify: `src/ui/tab-release.ts`, `src/ui/tab-release.test.ts`, `src/ui/keyboard/commands.ts`, `src/ui/keyboard/command-bar-controller.ts`, `src/ui/components/StatusBar.tsx`, `src/ui/components/StatusBar.test.tsx`

**Interfaces:**
- Consumes: `appUpdateSignal`, `requestSkipWaiting`, `waitForControllerChange` (Task 4); `RELEASE_WAIT_MS` (`ui/tab-leadership.ts`).
- Produces: `prepareTabRelease(timeoutMs: number): Promise<() => void>` (lo devuelto reanuda el sync y suelta el cerrojo si lo tomó);
  `APPLY_TIMEOUT_MS = 10_000`; `type AppUpdateDeps`; `applyAppUpdate(deps?: AppUpdateDeps): Promise<void>`.

- [ ] **Step 1: `prepareTabRelease` devuelve cómo deshacer.** Test nuevo en `src/ui/tab-release.test.ts`
  (mismo patrón de `load()` del archivo):

```ts
  it('lo que devuelve reanuda el sync y suelta el cerrojo (#54, /ACTUALIZAR que falla)', async () => {
    const { engine, syncState, prepareTabRelease } = await load();
    const undo = await prepareTabRelease(80);
    expect(syncState.syncPausedSignal.value).toBe(true);
    expect(engine.isSyncLockHeld()).toBe(true);
    undo();
    expect(syncState.syncPausedSignal.value).toBe(false);
    expect(engine.isSyncLockHeld()).toBe(false);
  });
```

  (Si `load()` no expone `syncPausedSignal`/`isSyncLockHeld` con esos nombres, usar los que ya usa
  el archivo.) `pnpm vitest run src/ui/tab-release.test.ts` → FAIL. Implementación:

```ts
export async function prepareTabRelease(timeoutMs: number): Promise<() => void> {
  const deadline = Date.now() + timeoutMs;
  setSyncPaused(true);
  const release = await acquireSyncLockWaiting(timeoutMs);
  await waitForIdleWriteTransactions(Math.max(0, deadline - Date.now()));
  return () => {
    release?.();
    setSyncPaused(false);
  };
}
```

  Actualizar el comentario: "El traspaso de pestaña ignora lo devuelto (después se recarga);
  `/ACTUALIZAR` lo usa si la versión nueva no llega a activarse." → PASS, y los tests de
  `tab-leadership` siguen en verde.

- [ ] **Step 2: Test del controller** (`src/ui/keyboard/app-update-controller.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commandBarWarningSignal } from '../state/command-bar.ts';
import { appUpdateSignal } from '../state/app-update.ts';
import { applyAppUpdate, APPLY_TIMEOUT_MS, type AppUpdateDeps } from './app-update-controller.ts';

function deps(overrides: Partial<AppUpdateDeps> = {}): AppUpdateDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    hasSaleInProgress: () => false,
    prepareRelease: vi.fn(() => {
      calls.push('release');
      return Promise.resolve(() => calls.push('undo'));
    }),
    skipWaiting: vi.fn(() => {
      calls.push('skip');
      return true;
    }),
    waitForControllerChange: vi.fn(() => {
      calls.push('wait');
      return Promise.resolve(true);
    }),
    reload: vi.fn(() => calls.push('reload')),
    ...overrides,
  };
}

beforeEach(() => {
  appUpdateSignal.value = 'available';
  commandBarWarningSignal.value = null;
});

describe('/ACTUALIZAR (#54)', () => {
  it('con una venta en curso no actualiza y lo dice', async () => {
    const d = deps({ hasSaleInProgress: () => true });
    await applyAppUpdate(d);
    expect(commandBarWarningSignal.value).toBe('Terminá o descartá la venta para actualizar.');
    expect(d.calls).toEqual([]);
    expect(appUpdateSignal.value).toBe('available');
  });

  it('suelta sin cortar a medias, activa la versión nueva y recarga', async () => {
    const d = deps();
    await applyAppUpdate(d);
    expect(d.calls).toEqual(['release', 'wait', 'skip', 'reload']);
    expect(d.waitForControllerChange).toHaveBeenCalledWith(APPLY_TIMEOUT_MS);
    expect(appUpdateSignal.value).toBe('applying');
  });

  it('si la versión nueva no se activa, avisa, reanuda el sync y vuelve a estar disponible', async () => {
    const d = deps({ waitForControllerChange: vi.fn(() => Promise.resolve(false)) });
    await applyAppUpdate(d);
    expect(d.calls).toEqual(['release', 'skip', 'undo']);
    expect(commandBarWarningSignal.value).toBe('No se pudo actualizar: cerrá y abrí el POS.');
    expect(appUpdateSignal.value).toBe('available');
  });

  it('sin versión disponible no hace nada', async () => {
    appUpdateSignal.value = 'none';
    const d = deps();
    await applyAppUpdate(d);
    expect(d.calls).toEqual([]);
  });
});
```

- [ ] **Step 3: Correr** → FAIL. **Implementar** `src/ui/keyboard/app-update-controller.ts`:

```ts
import { requestSkipWaiting, waitForControllerChange } from '../service-worker.ts';
import { appUpdateSignal } from '../state/app-update.ts';
import { cartSignal } from '../state/cart.ts';
import { commandBarWarningSignal } from '../state/command-bar.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { RELEASE_WAIT_MS } from '../tab-leadership.ts';
import { prepareTabRelease } from '../tab-release.ts';

/** Cuánto se espera a que la versión nueva tome el control antes de darse por vencido. */
export const APPLY_TIMEOUT_MS = 10_000;

export type AppUpdateDeps = {
  hasSaleInProgress: () => boolean;
  prepareRelease: (timeoutMs: number) => Promise<() => void>;
  skipWaiting: () => boolean;
  waitForControllerChange: (timeoutMs: number) => Promise<boolean>;
  reload: () => void;
};

/** Venta en curso: líneas, cliente o ajuste global (lo que `/DESCARTAR` vacía). */
function saleInProgress(): boolean {
  const cart = cartSignal.value;
  return (
    cart.lines.length > 0 ||
    cart.globalAdjustmentPercentage !== undefined ||
    attachedCustomerSignal.value !== undefined
  );
}

const browserDeps: AppUpdateDeps = {
  hasSaleInProgress: saleInProgress,
  prepareRelease: prepareTabRelease,
  skipWaiting: requestSkipWaiting,
  waitForControllerChange: (timeoutMs) => waitForControllerChange(timeoutMs),
  reload: () => {
    window.location.reload();
  },
};

/**
 * `/ACTUALIZAR` y el botón de la barra de estado (#54): nunca con una venta en curso. Suelta como en
 * el traspaso de pestaña de #175 (termina el sync y las escrituras, con tope), activa la versión en
 * espera y recarga cuando toma el control. Si no lo toma a tiempo, lo deshace y avisa.
 */
export async function applyAppUpdate(deps: AppUpdateDeps = browserDeps): Promise<void> {
  if (appUpdateSignal.value !== 'available') {
    return;
  }
  if (deps.hasSaleInProgress()) {
    commandBarWarningSignal.value = 'Terminá o descartá la venta para actualizar.';
    return;
  }
  appUpdateSignal.value = 'applying';
  const undo = await deps.prepareRelease(RELEASE_WAIT_MS);
  const changed = deps.waitForControllerChange(APPLY_TIMEOUT_MS);
  if (deps.skipWaiting() && (await changed)) {
    deps.reload();
    return;
  }
  undo();
  appUpdateSignal.value = 'available';
  commandBarWarningSignal.value = 'No se pudo actualizar: cerrá y abrí el POS.';
}
```

  Nota: si `skipWaiting()` devuelve `false`, `changed` queda pendiente hasta su tope y se resuelve
  solo; no hace falta cancelarlo. → PASS.

- [ ] **Step 4: El comando.** En `commands.ts`, `availableCommands()` suma `/ACTUALIZAR` cuando
  `appUpdateSignal.value !== 'none'`, como `/ALTA` (la spec dice "en `CORE_COMMANDS`"; el patrón
  real de un comando condicional es este):

```ts
  const updateCommands: CommandInfo[] =
    appUpdateSignal.value !== 'none'
      ? [{ name: 'ACTUALIZAR', description: 'Aplicar la versión nueva del POS (recarga)' }]
      : [];
  return [
    ...CORE_COMMANDS,
    ...updateCommands,
    ...demoCommands,
    ...connectorCommands(activeConnectorTypeSignal.value),
  ];
```

  (import de `appUpdateSignal`; actualizar el comentario de `availableCommands`). En
  `command-bar-controller.ts`, un `case` al lado de `ALTA`:

```ts
    case 'ACTUALIZAR':
      // Solo existe con una versión nueva descargada (#54).
      if (appUpdateSignal.value === 'none') {
        commandBarErrorSignal.value = `Comando desconocido: /${name}`;
        return;
      }
      clearBuffer();
      void applyAppUpdate();
      return;
```

  Test en el archivo de tests de `commands.ts` que exista (`commands.test.ts`; si no existe, en
  `command-bar-controller.test.ts`): sin versión, `availableCommands()` no tiene `ACTUALIZAR`; con
  `appUpdateSignal.value = 'available'`, sí. Correr → PASS.

- [ ] **Step 5: El botón.** En `StatusBar.tsx`, primero en el grupo de botones de la derecha (antes
  de "Avisos"):

```tsx
          {appUpdateSignal.value !== 'none' && (
            <button
              type="button"
              tabIndex={-1}
              class="btn-primary"
              disabled={appUpdateSignal.value === 'applying'}
              onMouseDown={keepFocusOnMouseDown}
              onClick={(event) => {
                event.stopPropagation();
                void applyAppUpdate();
              }}
              title="Aplicar la versión nueva del POS (/ACTUALIZAR)"
              style={{
                border: '1px solid var(--color-accent)',
                borderRadius: 'var(--radius-sm, 6px)',
                padding: '2px 8px',
                fontSize: 'var(--font-size-sm)',
                cursor: 'pointer',
              }}
            >
              {appUpdateSignal.value === 'applying' ? 'Actualizando…' : 'Versión nueva (/ACTUALIZAR)'}
            </button>
          )}
```

  Sumar al comentario del componente una línea sobre el botón (#54). Tests en `StatusBar.test.tsx`,
  con el patrón del archivo: con `appUpdateSignal.value = 'available'` aparece "Versión nueva
  (/ACTUALIZAR)"; con `'applying'`, "Actualizando…" y deshabilitado; con `'none'`, no hay botón.
  Volver `appUpdateSignal` a `'none'` en el `afterEach`/`beforeEach` del archivo.

- [ ] **Step 6: `pnpm lint && pnpm typecheck && pnpm test` → PASS. Commit.**

```bash
git add src/ui
git commit -m "feat(ui): /ACTUALIZAR aplica la versión nueva sin cortar una venta (#54)"
```

---

### Task 6: `pos.reset()` y `/DIAGNOSTICO`

**Files:**
- Modify: `src/sync/terminal-data.ts`, `src/ui/console/pos-console.ts`, `src/ui/console/pos-console.test.ts`, `src/sync/diagnostics.ts`, `src/ui/screens/diagnostico-screen.tsx`, `src/ui/screens/diagnostico-screen.test.tsx`

**Interfaces:**
- Consumes: `removeOwnServiceWorker` (Task 4), `appUpdateSignal`, `serviceWorkerStateSignal`.
- Produces: `PosConsoleDeps.removeServiceWorker: () => Promise<void>`; `SyncDiagnostics.offline: OfflineStatus` con
  `type OfflineStatus = 'ready' | 'installing' | 'update-waiting' | 'unsupported'`;
  `describeOffline(status: OfflineStatus): string`.

- [ ] **Step 1: Test de la consola.** En `pos-console.test.ts`, `fakeDeps` suma
  `removeServiceWorker: vi.fn(() => Promise.resolve())`, y un test:

```ts
describe('pos.reset (#54)', () => {
  it('después de borrar lo local da de baja el service worker de esta carpeta y recarga', async () => {
    const calls: string[] = [];
    const deps = fakeDeps({
      resetTerminal: () => {
        calls.push('datos');
        return Promise.resolve(ok(undefined));
      },
      removeServiceWorker: () => {
        calls.push('sw');
        return Promise.resolve();
      },
      reload: () => calls.push('reload'),
    });
    await createPosConsole(deps).reset();
    expect(calls).toEqual(['datos', 'sw', 'reload']);
  });

  it('si borrar lo local falla, no toca el service worker', async () => {
    const removeServiceWorker = vi.fn(() => Promise.resolve());
    const deps = fakeDeps({
      resetTerminal: () => Promise.resolve(err('connection/sync-busy', undefined)),
      removeServiceWorker,
    });
    await createPosConsole(deps).reset();
    expect(removeServiceWorker).not.toHaveBeenCalled();
  });
});
```

  Correr → FAIL. **Implementar**: `PosConsoleDeps` suma `removeServiceWorker: () => Promise<void>`;
  `reset` queda:

```ts
    reset: async () => {
      const result = await deps.resetTerminal();
      if (!result.ok) {
        deps.console.error(describeError(result));
        return;
      }
      // #54: también el service worker y las cachés de esta carpeta (nunca los de otro canal).
      await deps.removeServiceWorker().catch((error: unknown) => {
        deps.console.error('No se pudo borrar el service worker:', error);
      });
      deps.console.info('Datos locales borrados. Recargando…');
      deps.reload();
    },
```

  En `installPosConsole`: `removeServiceWorker: () => removeOwnServiceWorker(),`. En `HELP`, la
  descripción de `pos.reset()` pasa a "Borra TODO lo local, incluida la config de /CONFIG, el service
  worker y las cachés de esta carpeta, y recarga. Sin confirmación." Actualizar el comentario de
  `resetTerminal` en `terminal-data.ts` para nombrar que la consola además borra el service worker.
  (`resetTerminal` no cambia: el service worker vive en la UI, `removeOwnServiceWorker`.) → PASS.

- [ ] **Step 2: Diagnóstico.** En `diagnostics.ts`:

```ts
/** Si el POS abre sin red (#54), para `/DIAGNOSTICO` y `pos.status()`. */
export type OfflineStatus = 'ready' | 'installing' | 'update-waiting' | 'unsupported';

export function describeOffline(status: OfflineStatus): string {
  switch (status) {
    case 'ready':
      return 'sin conexión: lista';
    case 'installing':
      return 'preparando el modo sin conexión';
    case 'update-waiting':
      return 'versión nueva descargada, falta aplicar';
    case 'unsupported':
      return 'sin service worker';
  }
}

function currentOfflineStatus(): OfflineStatus {
  return appUpdateSignal.value !== 'none' ? 'update-waiting' : serviceWorkerStateSignal.value;
}
```

  Desvío menor de la spec, que nombra tres estados: se suma `installing` ("preparando el modo sin
  conexión") para no decir "lista" mientras se instala el primer service worker.

  `SyncDiagnostics` suma `offline: OfflineStatus` (con comentario) y `collectDiagnostics` lo llena
  con `currentOfflineStatus()`. Los objetos `SyncDiagnostics` de los tests
  (`pos-console.test.ts`, `diagnostico-screen.test.tsx` y cualquier otro que no compile) suman
  `offline: 'ready'`.

- [ ] **Step 3: Test de la pantalla.** En `diagnostico-screen.test.tsx`, con el patrón del archivo
  (render con el objeto de diagnóstico): con `offline: 'update-waiting'` el encabezado contiene
  "POS 0.1.0 · almacenamiento offline-pos@/0.1.0/ · versión nueva descargada, falta aplicar"; con
  `'unsupported'`, "sin service worker". Correr → FAIL. En `diagnostico-screen.tsx`, el `<p>` queda:

```tsx
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            POS {diagnostics.posVersion} · almacenamiento{' '}
            <span style={monoStyle}>{diagnostics.storageNamespace}</span> ·{' '}
            {describeOffline(diagnostics.offline)}
          </p>
```

  → PASS.

- [ ] **Step 4: `pos.status()`.** `PosStatus` suma `sinConexion: string` y `formatStatus`
  `sinConexion: describeOffline(diagnostics.offline)`. Test en `pos-console.test.ts` dentro de
  `describe('pos.status')`: `expect(formatStatus(diagnostics).sinConexion).toBe('sin conexión: lista')`.
  → PASS.

- [ ] **Step 5: `pnpm lint && pnpm typecheck && pnpm test` → PASS. Commit.**

```bash
git add src
git commit -m "feat(sw): pos.reset() borra el service worker de su carpeta y /DIAGNOSTICO muestra su estado (#54)"
```

---

### Task 7: `site/`: canal, limpieza y home

**Files:**
- Create: `site/channel-info.ts`, `site/channel-info.test.ts`, `site/build-channel.ts`, `site/build-channel.test.ts`, `site/cleanup.ts`, `site/cleanup.test.ts`, `site/home-page.ts`, `site/home-page.test.ts`, `site/build-home-page.ts`
- Delete: `site/version-info.ts`, `site/version-info.test.ts`, `site/build-version.ts`, `site/build-version.test.ts`, `site/versions-page.ts`, `site/versions-page.test.ts`, `site/build-versions-page.ts`
- Modify: `site/build-site.ts`, `site/templates/_redirects`, `site/backends.json`, `playwright.config.ts` (solo la URL del servidor 4174), y cualquier import de los archivos borrados (`grep -rn "version-info\|build-version\|versions-page" site e2e`).

**Interfaces:**
- Produces:
  - `channel-info.ts`: `type VersionInfo = { version: string; contract: string; minBackendContract: string }`, `type ChannelInfo = VersionInfo & { channel: string }`, `compareVersionsDesc(a, b): number`, `channelFor(contract: string): string` (`'4.5.0'` → `'v4'`), `readChannelInfo(folder: string): VersionInfo | undefined`, `readChannels(siteDir: string): ChannelInfo[]` (major más nuevo primero).
  - `build-channel.ts`: `buildChannel(options: { distDir: string; siteDir: string; info: VersionInfo; docs?: DocsSources }): string`, `currentVersionInfo(): VersionInfo`, `type DocsSources = { guide: string; llms: string; openapi: string; bridge: string[] }`.
  - `cleanup.ts`: `cleanupLegacy(siteDir: string): string[]`.
  - `home-page.ts`: `type KnownBackend`, `type Action = { kind: 'demo'; href: string } | { kind: 'incompatible'; text: string }`, `actionFor(backend: KnownBackend, channels: ChannelInfo[]): Action`, `renderHomePage(channels, backends, generatedAt): string`, `renderRootLlms(channels): string`, `sameIgnoringGeneratedAt(a, b): boolean`.
  - `build-home-page.ts`: `buildHomePage(siteDir: string, now: Date, options?: { onlyLocal?: boolean }): Promise<void>`.

- [ ] **Step 1: `channel-info`.** Crear `site/channel-info.ts` moviendo de `version-info.ts` el tipo
  `VersionInfo`, el esquema y `compareVersionsDesc`, más:

```ts
export const CHANNEL_FOLDER = /^v\d+$/;

/** El canal de un POS sale del major de su contrato (#54): `4.5.0` → `v4`. */
export function channelFor(contract: string): string {
  return `v${contract.split('.')[0] ?? ''}`;
}

export type ChannelInfo = VersionInfo & { channel: string };

/** `version.json` de una carpeta publicada, o `undefined` si no existe. Falla si es inválido. */
export function readChannelInfo(folder: string): VersionInfo | undefined {
  const path = join(folder, 'version.json');
  if (!existsSync(path)) {
    return undefined;
  }
  const parsed = versionInfoSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.success) {
    throw new Error(`version.json inválido en ${folder}`);
  }
  return parsed.data;
}

/** Los canales publicados (`v<n>/`), el major más nuevo primero. Cada uno tiene que tener version.json. */
export function readChannels(siteDir: string): ChannelInfo[] {
  return readdirSync(siteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && CHANNEL_FOLDER.test(entry.name))
    .map((entry) => {
      const info = readChannelInfo(join(siteDir, entry.name));
      if (info === undefined || channelFor(info.contract) !== entry.name) {
        throw new Error(`El canal ${entry.name} no tiene un version.json de su major`);
      }
      return { ...info, channel: entry.name };
    })
    .sort((a, b) => Number(b.channel.slice(1)) - Number(a.channel.slice(1)));
}
```

  Test `site/channel-info.test.ts` (`// @vitest-environment node`, con el helper `site()` de
  `version-info.test.ts`): mantiene el de `compareVersionsDesc`; `channelFor('4.5.0')` es `'v4'` y
  `channelFor('5.0.0')` es `'v5'`; `readChannels` lee `v4` y `v5` (el 5 primero) e ignora `0.2.0` y
  `versions`; falla si `v4/` no tiene `version.json` o si su contrato es 5.x. Borrar
  `version-info.ts` y su test.

- [ ] **Step 2: `build-channel`.** Test `site/build-channel.test.ts` adaptado de
  `build-version.test.ts` (mismo `fixture()`, `INFO = { version: '0.3.0', contract: '4.5.0', minBackendContract: '4.0.0' }`):
  - arma `v4/` con el build, `version.json` igual a `INFO`, las docs como hoy y además
    `docs/bridge.gs` y `docs/columnas.gs`;
  - con `v4/version.json` en `0.2.0` y un archivo viejo `v4/assets/viejo.js`, reemplaza todo:
    `viejo.js` ya no está y `version.json` dice `0.3.0`;
  - con `v4/version.json` en `0.3.0` falla con `/ya está publicada/`, y en `0.4.0` también;
  - el test de `renderGuidePage` se mueve tal cual.

  Implementación: copiar `build-version.ts` a `build-channel.ts` con estos cambios:

```ts
const DEFAULT_DOCS: DocsSources = {
  guide: repo('docs/integradores/guia.md'),
  llms: repo('docs/integradores/llms.txt'),
  openapi: repo('docs/connector-api.openapi.yaml'),
  bridge: [repo('src/connectors/google-sheets/bridge.gs'), repo('src/connectors/google-sheets/columnas.gs')],
};

/**
 * Arma el canal `v<major del contrato>/` (#54): lo reemplaza entero con el build, `version.json` y
 * `docs/`. Nunca baja ni repite la versión publicada en el canal: volver atrás es un revert y un
 * tag de parche (además, una versión vieja no abre una base de Dexie ya migrada).
 */
export function buildChannel(options: {
  distDir: string;
  siteDir: string;
  info: VersionInfo;
  docs?: DocsSources;
}): string {
  const { distDir, siteDir, info, docs = DEFAULT_DOCS } = options;
  const folder = join(siteDir, channelFor(info.contract));
  const published = readChannelInfo(folder);
  if (published !== undefined && compareVersionsDesc(published.version, info.version) <= 0) {
    throw new Error(
      `La versión ${info.version} ya está publicada en /${channelFor(info.contract)}/ (o hay una más nueva: ${published.version}): para volver atrás, revert y un tag de parche`,
    );
  }
  rmSync(folder, { recursive: true, force: true });
  cpSync(distDir, folder, { recursive: true });
  // … version.json y docs/ como en build-version.ts, más:
  for (const file of docs.bridge) {
    cpSync(file, join(docsDir, basename(file)));
  }
  return folder;
}
```

  (`compareVersionsDesc(published, info) <= 0` ⇔ publicada ≥ nueva.) CLI igual a la de
  `build-version.ts` con el mensaje "Canal armado en …" y "Uso: node site/build-channel.ts --dist
  <dir> --site <dir>". `renderGuidePage(guide, info.version)` queda. Borrar `build-version.ts` y su
  test. Correr `pnpm vitest run site` → PASS.

- [ ] **Step 3: `cleanup`.** Test `site/cleanup.test.ts`:

```ts
// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupLegacy } from './cleanup.ts';

describe('cleanupLegacy (#54)', () => {
  it('borra las carpetas por versión, los zips y /versions, y nada más', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cleanup-'));
    for (const folder of ['0.1.0', '0.2.0', 'versions', 'v4', 'otra']) {
      mkdirSync(join(dir, folder));
    }
    for (const file of ['0.1.0.zip', '0.2.0.zip', 'index.html', 'llms.txt', '_headers']) {
      writeFileSync(join(dir, file), '');
    }
    expect(cleanupLegacy(dir).sort()).toEqual(['0.1.0', '0.1.0.zip', '0.2.0', '0.2.0.zip', 'versions']);
    for (const kept of ['v4', 'otra', 'index.html', 'llms.txt', '_headers']) {
      expect(existsSync(join(dir, kept))).toBe(true);
    }
    expect(cleanupLegacy(dir)).toEqual([]);
  });
});
```

  Implementación `site/cleanup.ts`:

```ts
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { isMain } from './cli.ts';

const LEGACY = [/^\d+\.\d+\.\d+$/, /^\d+\.\d+\.\d+\.zip$/, /^versions$/];

/**
 * Lo que quedó de la publicación por carpetas (#148), que el canal reemplaza (#54): las carpetas
 * `x.y.z/`, sus zips y `/versions`. Cualquier otra cosa queda. Devuelve lo que borró.
 */
export function cleanupLegacy(siteDir: string): string[] {
  const removed = readdirSync(siteDir).filter((name) => LEGACY.some((re) => re.test(name)));
  for (const name of removed) {
    rmSync(join(siteDir, name), { recursive: true, force: true });
  }
  return removed;
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { site: { type: 'string' } } });
  if (values.site === undefined) {
    throw new Error('Uso: node site/cleanup.ts --site <dir>');
  }
  const removed = cleanupLegacy(values.site);
  console.log(removed.length === 0 ? 'Nada que limpiar' : `Borrado: ${removed.join(', ')}`);
}
```

- [ ] **Step 4: La home.** Test `site/home-page.test.ts` (reemplaza a `versions-page.test.ts`):

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { actionFor, renderHomePage, renderRootLlms, sameIgnoringGeneratedAt, type KnownBackend } from './home-page.ts';

const V4 = { channel: 'v4', version: '0.3.0', contract: '4.5.0', minBackendContract: '4.0.0' };
const V4_ALTO = { ...V4, minBackendContract: '4.3.0' };

const backend = (contract: string, notes?: string): KnownBackend => ({
  entry: { name: 'Demo <local>', url: 'http://localhost:4000', ...(notes ? { notes } : {}) },
  facts: { contract, capabilities: ['demo-sessions'], checkedAt: '2026-10-03T12:00:00.000Z' },
});

describe('actionFor (#54)', () => {
  it('compatible: demo en el canal de su major, con el backend codificado', () => {
    expect(actionFor(backend('4.4.0'), [V4])).toEqual({
      kind: 'demo',
      href: 'v4/?demo=true&backend=http%3A%2F%2Flocalhost%3A4000',
    });
  });

  it('sin canal para su major', () => {
    expect(actionFor(backend('5.0.0'), [V4])).toEqual({
      kind: 'incompatible',
      text: 'Incompatible: no hay POS para el contrato 5.x',
    });
  });

  it('canal con un piso más alto', () => {
    expect(actionFor(backend('4.1.0'), [V4_ALTO])).toEqual({
      kind: 'incompatible',
      text: 'Incompatible: el backend habla 4.1.0; el POS de /v4/ acepta 4.x desde 4.3.0',
    });
  });
});

describe('renderHomePage', () => {
  const html = renderHomePage([V4], [backend('4.4.0', '<b>ojo</b>')], '2026-10-03T12:00:00.000Z');

  it('una fila por backend con su demo, y las docs del canal y los tags para integradores', () => {
    expect(html).toContain('href="v4/?demo=true&amp;backend=http%3A%2F%2Flocalhost%3A4000"');
    expect(html).toContain('Abrir demo');
    expect(html).toContain('href="v4/docs/"');
    expect(html).toContain('href="https://github.com/rauldiazsolis/offline-pos/tags"');
    expect(html).not.toContain('.zip');
  });

  it('escapa lo que viene de la lista', () => {
    expect(html).toContain('Demo &lt;local&gt;');
    expect(html).not.toContain('<b>ojo</b>');
  });

  it('dos generaciones que solo difieren en la fecha son iguales', () => {
    const other = renderHomePage([V4], [backend('4.4.0', '<b>ojo</b>')], '2026-10-04T12:00:00.000Z');
    expect(sameIgnoringGeneratedAt(html, other)).toBe(true);
    expect(sameIgnoringGeneratedAt(html, renderHomePage([V4], [], '2026-10-03T12:00:00.000Z'))).toBe(false);
  });
});

describe('renderRootLlms', () => {
  it('apunta a las docs del canal más nuevo y lista los canales', () => {
    const llms = renderRootLlms([V4]);
    expect(llms).toContain('[Guía para integradores (/v4/, POS 0.3.0)](v4/docs/guia.md)');
    expect(llms).toContain('- [/v4/](v4/docs/llms.txt): contrato 4.5.0');
  });
});
```

  Implementación `site/home-page.ts` a partir de `versions-page.ts`: `escape`, `GENERATED_AT`,
  `sameIgnoringGeneratedAt` y los estilos se mantienen; `cellFor` pasa a:

```ts
export function actionFor(backend: KnownBackend, channels: ChannelInfo[]): Action {
  const { contract } = backend.facts;
  const major = contract.split('.')[0] ?? '';
  const channel = channels.find((c) => c.channel === channelFor(contract));
  if (channel === undefined) {
    return { kind: 'incompatible', text: `Incompatible: no hay POS para el contrato ${major}.x` };
  }
  if (!isCompatibleContract(contract, channel.minBackendContract)) {
    return {
      kind: 'incompatible',
      text: `Incompatible: el backend habla ${contract}; el POS de /${channel.channel}/ acepta ${major}.x desde ${channel.minBackendContract}`,
    };
  }
  return {
    kind: 'demo',
    href: `${channel.channel}/?demo=true&backend=${encodeURIComponent(backend.entry.url)}`,
  };
}
```

  `renderHomePage(channels, backends, generatedAt)`:
  - `<title>offline-pos</title>`, `<h1>offline-pos</h1>` y un párrafo: "POS web offline-first para
    comercios, que se conecta a cualquier backend que implemente el Connector API. Elegí un backend
    y abrí una demo: el POS se instala en su canal y se actualiza solo."
  - `<h2>Backends</h2>` y una tabla con columnas Backend (nombre, `<code>` de la URL y notas en
    `.muted`), Contrato, Capacidades y Demo (`Abrir demo` o el texto incompatible, como
    `renderCell`). Debajo, "Consultados el `<time data-generated …>`".
  - `<h2>Para integradores</h2>`: una lista con cada canal ("`/v4/`: POS 0.3.0, contrato 4.5.0 ·
    `<a href="v4/docs/">Docs</a>`") y "Una versión exacta del POS: `<a
    href="https://github.com/rauldiazsolis/offline-pos/tags">tags del repo</a>`. Índice para IA:
    `<a href="llms.txt">llms.txt</a>`."
  - Los links son relativos a la raíz (sin `../`).

  `renderRootLlms(channels)`: como hoy, con el canal más nuevo (`channels[0]`) en "Docs" ("Guía para
  integradores (/v4/, POS 0.3.0)" → `v4/docs/guia.md`; "Connector API 4.5.0 (OpenAPI)" →
  `v4/docs/connector-api.openapi.yaml`), el resumen dice "Cada canal (`/v4/`) sirve el último POS
  de ese major del contrato y se actualiza solo; una versión exacta está en los tags del repo." y
  "## Canales" con `- [/v4/](v4/docs/llms.txt): contrato 4.5.0`.

  Borrar `versions-page.ts` y su test. → PASS.

- [ ] **Step 5: `build-home-page.ts`** a partir de `build-versions-page.ts`: `buildHomePage(siteDir,
  now, { onlyLocal })` lee `readChannels(siteDir)`, consulta los backends igual, escribe
  `index.html` (con `writeIfChanged`) y `llms.txt`, y copia `_headers` y `_redirects`. CLI con
  "Uso: node site/build-home-page.ts --site <dir>" y "Home regenerada en …". Borrar
  `build-versions-page.ts`.

- [ ] **Step 6: Plantillas y datos.** `site/templates/_redirects` queda:

```
/versions/ / 301
/versions / 301
```

  En `site/templates/_headers`, el comentario de arriba pasa a nombrar también `sw.js` y el manifest
  ("se revalidan siempre: la búsqueda de versiones nuevas siempre llega al servidor"); las reglas no
  cambian. En `site/backends.json`, la nota del demo-backend local: "Levantalo con el demo-backend/
  del último tag del repo: pnpm backend." (`site/backends.test.ts` sigue igual).

- [ ] **Step 7: `build-site.ts`.** Usa `buildChannel` y `buildHomePage` en vez de los viejos;
  comentario: "la versión actual en su canal más la home". En `playwright.config.ts`, el servidor
  de `4174` espera `url: 'http://localhost:4174/'` y su comentario dice "el canal actual (`/v4/`) más
  la home". Correr `pnpm site:build --only-local` y verificar que existan `.site-out/index.html`,
  `.site-out/v4/sw.js`, `.site-out/v4/version.json` y `.site-out/v4/docs/bridge.gs`.

- [ ] **Step 8: `pnpm lint && pnpm typecheck && pnpm test` → PASS. Commit.**

```bash
git add -A site playwright.config.ts
git commit -m "feat(site): el canal v<major> y la home de backends reemplazan las carpetas por versión (#54)"
```

---

### Task 8: La Action

**Files:**
- Modify: `.github/workflows/publish.yml`

- [ ] **Step 1:** El comentario de arriba: "#54. Con un tag vX.Y.Z publica el POS en su canal
  (`/v<major del contrato>/`) y limpia lo que quedó de las carpetas por versión; en los demás casos
  solo regenera la home y /llms.txt. Cloudflare Pages sirve la rama `publish`."

- [ ] **Step 2:** El paso "Carpeta de la versión y zip" pasa a "Canal y limpieza":

```yaml
      - name: Canal y limpieza
        if: github.ref_type == 'tag'
        run: |
          VERSION=$(node -p "require('./package.json').version")
          if [ "$GITHUB_REF_NAME" != "v$VERSION" ]; then
            echo "::error::El tag $GITHUB_REF_NAME no coincide con package.json ($VERSION)"
            exit 1
          fi
          pnpm build
          node site/build-channel.ts --dist dist --site publish-tree
          node site/cleanup.ts --site publish-tree
```

  (La guardia de "ya publicada" ahora vive en `buildChannel`, que falla con su mensaje.)

- [ ] **Step 3:** El paso "/versions y /llms.txt" pasa a "Home y /llms.txt" con
  `node site/build-home-page.ts --site publish-tree`, y el mensaje del commit sin tag a
  `'publish: home'`.

- [ ] **Step 4:** Revisar el YAML a ojo (no hay forma de correrlo en local) y que no quede ninguna
  referencia a `build-version`, `build-versions-page`, `zip` ni `/versions`:
  `grep -n "zip\|versions\|build-version" .github/workflows/publish.yml` → sin resultados.

- [ ] **Step 5: Commit.**

```bash
git add .github/workflows/publish.yml
git commit -m "ci(publish): publicar en el canal y limpiar las carpetas por versión (#54)"
```

---

### Task 9: E2E

**Files:**
- Modify: `playwright.config.ts`, `e2e/published-site.spec.ts`
- Create: `e2e/pwa.spec.ts`

- [ ] **Step 1: Bloquear service workers por defecto.** En `playwright.config.ts`, `use` suma
  `serviceWorkers: 'block'` con el comentario "#54: la suite no depende del service worker; lo
  prueba `pwa.spec.ts`, que lo habilita". Correr `pnpm test:e2e` → la suite completa en verde (con
  el sitio publicado roto hasta el Step 2: correr con `--grep-invert "sitio publicado|published"` si
  hace falta, o hacer el Step 2 primero).

- [ ] **Step 2: `published-site.spec.ts`.** Comentario de arriba: "El sitio publicado (#54), armado
  con `pnpm site:build` y servido en 4174: la home, el canal `/v4/` con rutas relativas y su
  almacenamiento propio, y las docs. El redirect de `/versions` (`_redirects`) es de Cloudflare." El
  canal va fijo como `'v4'` en el spec: si el contrato sube de major, que el test falle es lo que se
  quiere. Tests:
  - "la home lista el backend local con su demo en el canal": `page.goto(`${SITE}/`)`, la fila del
    backend `demo-backend local` tiene el link "Abrir demo" con `href`
    `v4/?demo=true&backend=${encodeURIComponent('http://localhost:4000')}`; hay un link "Docs" a
    `v4/docs/` y ninguno con `.zip`.
  - "el canal arranca con el link de demo y guarda todo en su propio almacenamiento": el de hoy con
    `${SITE}/v4/?demo=…`, base `offline-pos@/v4/` y prefijo `offline-pos@/v4/:`.
  - "/v4/docs/ muestra la guía y enlaza el OpenAPI y el puente": el de hoy con `/v4/docs/`, más
    `bridge.gs` y `columnas.gs` con `ok()`.

- [ ] **Step 3: `pwa.spec.ts`.** Un servidor estático propio en `4175` que sirve el `dist/` del
  servidor de `4173` bajo `/v4/` (en `localhost`, que es contexto seguro), y que puede cambiar
  `sw.js` para simular una versión nueva:

```ts
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { expect, test } from '@playwright/test';
import { ACTIVE_CONFIG } from './fixtures.ts';

/**
 * Service worker y PWA (#54), con service workers habilitados (el resto de la suite los bloquea).
 * Un servidor propio sirve el `dist/` de 4173 en `/v4/`, como el canal publicado, y puede cambiar
 * `sw.js` para que el navegador vea una versión nueva sin un segundo build.
 */
test.use({ serviceWorkers: 'allow' });
test.describe.configure({ mode: 'serial' });

const PORT = 4175;
const ORIGIN = `http://localhost:${String(PORT)}`;
const CHANNEL = `${ORIGIN}/v4/`;
const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};
let swSuffix = '';
let server: Server;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', ORIGIN).pathname;
    if (!path.startsWith('/v4/')) {
      res.writeHead(404).end();
      return;
    }
    const relative = path.slice('/v4/'.length) || 'index.html';
    const file = join(DIST, normalize(relative));
    readFile(file)
      .then((content) => {
        const body = relative === 'sw.js' ? Buffer.concat([content, Buffer.from(swSuffix)]) : content;
        res.writeHead(200, {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(body);
      })
      .catch(() => res.writeHead(404).end());
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(async ({ page }) => {
  swSuffix = '';
  // Conexión activa en el almacenamiento de /v4/, una vez por pestaña (pos.reset() la borra).
  await page.addInitScript((config) => {
    if (sessionStorage.getItem('e2e:seeded') === null) {
      localStorage.setItem('offline-pos@/v4/:sync-config', JSON.stringify(config));
      localStorage.setItem('offline-pos@/v4/:device-id', 'e2e-device-id');
      sessionStorage.setItem('e2e:seeded', '1');
    }
  }, ACTIVE_CONFIG);
});

async function swReady(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

test('después de la primera carga, sin red y con F5 el POS abre', async ({ page, context }) => {
  await page.goto(CHANNEL);
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await swReady(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
});

test('una versión nueva se avisa y /ACTUALIZAR la aplica, nunca con una venta en curso', async ({ page }) => {
  await page.goto(CHANNEL);
  const bar = page.getByLabel('Barra de comandos');
  await expect(bar).toBeVisible();
  await swReady(page);

  swSuffix = '\n// e2e: versión nueva\n';
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
  const button = page.getByRole('button', { name: 'Versión nueva (/ACTUALIZAR)' });
  await expect(button).toBeVisible();

  await bar.fill('algo$100');
  await bar.press('Enter');
  await bar.fill('/ACTUALIZAR');
  await bar.press('Enter');
  await expect(page.getByText('Terminá o descartá la venta para actualizar.')).toBeVisible();

  await bar.fill('/DESCARTAR');
  await bar.press('Enter');
  await page.evaluate(() => {
    (window as unknown as { e2eMarker: boolean }).e2eMarker = true;
  });
  await bar.fill('/ACTUALIZAR');
  await bar.press('Enter');
  await page.waitForFunction(() => !('e2eMarker' in window));
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await expect(button).toBeHidden();
});

test('pos.reset() da de baja el service worker y las cachés de su carpeta', async ({ page }) => {
  await page.goto(CHANNEL);
  await expect(page.getByLabel('Barra de comandos')).toBeVisible();
  await swReady(page);
  await page.evaluate(async () => {
    const reset = (window as unknown as { pos: { reset: () => Promise<void> } }).pos.reset();
    await reset;
  });
  await page.waitForLoadState('load');
  // Tras la recarga se vuelve a registrar: lo que importa es que la caché vieja ya no esté.
  const caches = await page.evaluate(() => window.caches.keys());
  expect(caches.every((name) => name.startsWith('offline-pos@/v4/:sw:'))).toBe(true);
  expect(caches.length).toBeLessThanOrEqual(1);
});

test('el manifest y sus íconos cargan', async ({ page }) => {
  await page.goto(CHANNEL);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('./manifest.webmanifest');
  const manifest = (await (await page.request.get(`${CHANNEL}manifest.webmanifest`)).json()) as {
    icons: { src: string }[];
    display: string;
  };
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    expect((await page.request.get(`${CHANNEL}${icon.src}`)).ok()).toBe(true);
  }
});
```

  Ajustes al correrlo:
  - El label de la barra y el comportamiento de `algo$100` (línea libre) son los de la suite
    (`e2e/helpers.ts`, `offline-sale.spec.ts`): si difieren, usar los de ahí.
  - El test de `pos.reset()` es débil por diseño (tras la recarga hay una caché nueva). Si se puede,
    hacerlo fuerte: antes del reset leer el nombre de la caché actual, y después verificar que ese
    nombre exacto ya no exista **o** que el registro sea otro (`registration.installing`/`active`
    distinto). Elegir la forma que sea estable.
  - `context.setOffline(true)` va después de cargar una vez (regla de "Testing" en `AGENTS.md`).

- [ ] **Step 4: Correr.** `pnpm test:e2e e2e/pwa.spec.ts e2e/published-site.spec.ts` → PASS, y
  después `pnpm test:e2e` completo → PASS.

- [ ] **Step 5: Commit.**

```bash
git add playwright.config.ts e2e
git commit -m "test(e2e): PWA sin red, /ACTUALIZAR, pos.reset() y el canal publicado (#54)"
```

---

### Task 10: Documentación y versión

**Files:**
- Modify: `AGENTS.md`, `src/ui/AGENTS.md`, `src/storage/AGENTS.md`, `e2e/AGENTS.md`, `docs/publicacion.md`, `docs/integradores/guia.md`, `docs/integradores/llms.txt` (si nombra carpetas por versión o zips), `package.json`

- [ ] **Step 1: `AGENTS.md`.**
  - "Qué es esto": "pensado para instalarse como PWA (pendiente, #54)" → "instalable como PWA en su
    canal (`pos.contax.ar/v4/`, #54)".
  - Stack: la fila "PWA / service worker" → "Service worker propio (`src/workers/`, compilado por
    `build/sw-plugin.ts`) y manifest estático"; nota debajo de la de TanStack: "**Nota (#54)**: el
    stack decía `vite-plugin-pwa` (Workbox). Se descartó: `workbox-build` arrastra Babel, Rollup, ajv,
    terser y unas 35 dependencias más para usar solo precache y fallback de navegación."
  - Estructura: `workers/` deja de estar vacío ("el service worker y su lógica pura"); sumar `build/`
    ("plugin de Vite que compila `sw.js`") y `scripts/` ("los íconos de la PWA, se corre a mano").
  - "Publicación" reescrita: canal por major (`/v<major del contrato>/`, siempre el último POS; un
    canal nuevo solo con un major nuevo; el anterior queda congelado), la home en `/` con los
    backends conocidos (consulta en vivo como antes) y `/versions` redirigiendo ahí, sin carpetas
    por versión ni zips (versión exacta: tags del repo), la Action se niega a bajar o repetir (volver
    atrás = revert y tag de parche), almacenamiento y caché por carpeta, `offline-pos.pages.dev`
    igual que hoy. Spec nueva al lado de la de #148.
  - "Onboarding de demo": el link de demo de la home va al canal.
  - Comandos: fila `/ACTUALIZAR` ("Solo con una versión nueva descargada: la aplica y recarga, nunca
    con una venta en curso (ver `src/ui/AGENTS.md`)").
  - Estado: fila "#54 | Service worker propio y PWA en el canal `/v4/`, `/ACTUALIZAR`, home de
    backends; sin carpetas por versión | PR #N" (N al abrir el PR). "Siguiente": sacar #54 de lo
    pendiente antes del hito 1. Issues abiertas: sacar #54 de "Pantallas y publicación", sumar el
    `backlog` nuevo (Task 11).
- [ ] **Step 2: `src/ui/AGENTS.md`.** Sección nueva "Service worker y versión nueva (#54)": registro
  en `startApp` (solo el build, solo la pestaña que manda, sin `serviceWorker` no hace nada),
  búsqueda al arrancar y cada hora, `appUpdateSignal`/`serviceWorkerStateSignal`, el botón y
  `/ACTUALIZAR` (venta en curso, suelta con `prepareTabRelease`, `skip-waiting`, recarga, tope de
  10 s), y la regla: "la app no tiene `import()` dinámicos; si se suma uno, la segunda pestaña tiene
  que recargar al tomar el control en vez de correr `startApp`". En "Utilidades de consola",
  `reset()` también da de baja el service worker de su carpeta y sus cachés.
- [ ] **Step 3: `src/storage/AGENTS.md`.** En "Almacenamiento por carpeta": `namespace-rules.ts`
  (puras, sin `window`, las usa el service worker) y las cachés `<namespace>:sw:<hash>`; lo que
  `pos.reset()` borra de cada cosa.
- [ ] **Step 4: `e2e/AGENTS.md`.** `serviceWorkers: 'block'` por defecto; `pwa.spec.ts` y su
  servidor en `4175` (el `dist/` de 4173 bajo `/v4/`, `sw.js` modificable); el sitio publicado
  prueba la home y `/v4/`.
- [ ] **Step 5: `docs/publicacion.md`.** §1: la rama acumula la home, `llms.txt` y un canal por major;
  §2: publicar = tag, va al canal; no se puede bajar ni repetir; volver atrás = revert y tag de
  parche; la primera publicación después del merge (`0.3.0`) borra `0.1.0/`, `0.2.0/`, sus zips y
  `/versions`; §5 (verificar): `/` muestra la home, `/versions` redirige a `/`, `/v4` redirige a
  `/v4/`, el link de demo abre `/v4/` en DEMO, `/DIAGNOSTICO` dice `POS 0.3.0 · almacenamiento
  offline-pos@/v4/ · sin conexión: lista`, Chrome ofrece instalar, sin red y con F5 el POS abre, y
  `curl -I https://pos.contax.ar/v4/sw.js` muestra `max-age=0`; §7: "La versión … ya está
  publicada en /v4/" reemplaza a la de carpeta inmutable; §8: el `curl` de ejemplo usa `/v4/`; §9:
  el acceso directo con `--kiosk-printing` apunta a `https://pos.contax.ar/v4/`.
- [ ] **Step 6: `docs/integradores/guia.md` (y `llms.txt` si hace falta).** Cómo probar: el link de
  demo de la home va a `/v4/`. Servir el POS: el build anda en cualquier carpeta; con `https` o
  `localhost` trae service worker (abre sin red, se actualiza con `/ACTUALIZAR`); una versión exacta
  sale de los tags del repo (`pnpm build`). Sacar las menciones a zips y a carpetas `/<versión>/`.
  `site/docs.test.ts` tiene que seguir en verde.
- [ ] **Step 7: Versión.** `package.json` → `"version": "0.3.0"`.
- [ ] **Step 8: Verificación completa.** `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` → todo en verde.
- [ ] **Step 9: Commit.**

```bash
git add -A
git commit -m "docs: canal /v4/, service worker y /ACTUALIZAR; versión 0.3.0 (#54)"
```

---

### Task 11: Issues

- [ ] **Step 1: Issue en rauldiazsolis/mini-erp** (`gh issue create -R rauldiazsolis/mini-erp`),
  título "El POS se publica en un canal por major del contrato (pos.contax.ar/v4/)", con: el
  criterio nuevo (offline-pos#54 y su spec); los links de demo y alta van a
  `https://pos.contax.ar/v4/`; desde la `0.3.0` ya no existen `/<versión>/` ni los zips, ni en
  `pos.contax.ar` ni en `offline-pos.pages.dev` (mismo proyecto de Pages), así que
  `scripts/contract-source.ts` (`PUBLISHED_POS_ORIGIN`, `contractBaseUrl`) y el espejo de desarrollo
  (`src/server/pos-mirror/`, `contract.json.posVersion`) dejan de fijar una versión: bajan `/v4/` y
  `/v4/docs/`, o un tag del repo de offline-pos; con un major nuevo del contrato el backend tiene que
  hablar los dos durante la transición (por el header `X-POS-Contract-Version`, que ya viaja en cada
  request); absorbe rauldiazsolis/mini-erp#38 (comentar ahí y cerrarlo si el usuario está de acuerdo,
  o dejarlo enlazado). **Antes de la primera publicación de `0.3.0`.**
- [ ] **Step 2: Issue `backlog` en offline-pos**, etiquetas `backlog` y `feature:transversal`:
  "Pasar una terminal de /v4/ a /v5/ sin perder lo pendiente", con el contexto (canal por major,
  almacenamiento por carpeta, 409 con un backend que deja de hablar 4), la idea (vaciar el outbox en
  `/v4/` y reconectar en `/v5/` sin repetir el onboarding) y la relación con #143.
- [ ] **Step 3:** Sumar el número del issue `backlog` a "Issues abiertas" de `AGENTS.md`, commit
  "docs: issue de la transición entre canales (#54)".

---

## Antes de abrir el PR

Borrar este plan (`git rm docs/superpowers/plans/2026-10-03-service-worker-pwa-canal.md`): queda en
el historial; la spec se queda.

## Después del merge (no es parte del PR)

1. El issue del mini-erp ya está abierto.
2. Tag `v0.3.0` según `docs/publicacion.md`: la Action publica `/v4/` y limpia.
3. Prueba en producción (`docs/publicacion.md` §5) y cierre de #54 con el comentario del PR.
