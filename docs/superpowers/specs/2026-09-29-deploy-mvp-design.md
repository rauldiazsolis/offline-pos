# Deploy del MVP: carpetas por versión, `/versions`, docs y Cloudflare Pages

Fecha: 2026-09-29
Estado: diseño aprobado; plan en `docs/superpowers/plans/2026-09-29-deploy-mvp.md`.
Issues: #148 (etapa del epic #134; decisiones en su primer comentario). Relacionados: #54 (service
worker, fuera de alcance), #147 (backend público, `backlog`), #150 (dominio propio, `backlog`),
#151 (`GET /info` sin autenticación, `backlog`, anotado en este brainstorming). Fuera de alcance: el
mini-erp (desarrollo separado) y Google Sheets (congelado, #127).

## Contexto

El POS es estático y genérico desde #128 (PR #145): publicarlo es servir el `dist/` de `pnpm build`.
El público del lanzamiento son developers e integradores que levantan el demo-backend en
`localhost:4000` y entran por el link de demo; no hay backend público (#147).

Hoy el build usa `base: '/'`, la base de IndexedDB se llama `offline-pos` y todas las claves de
`localStorage` llevan el prefijo fijo `offline-pos:` (unos 12 módulos de `src/sync/`). Carpetas del
mismo origen comparten IndexedDB y `localStorage`: dos versiones publicadas en `/<x.y.z>/` se
mezclarían la config, el outbox y los contadores, y abrir una versión vieja después de una
migración de Dexie de una nueva falla con `VersionError`.

## Decisiones

Tomadas en la revisión del 2026-09-29 (comentario de #148), no se reabren:

- **Cloudflare Pages** en `<proyecto>.pages.dev`, sirviendo una **rama `publish`** que acumula las
  versiones (cada deploy de Pages reemplaza el sitio entero).
- **Deploy por tag `vX.Y.Z`** con una GitHub Action; no en cada merge a `main`.
- **Carpetas inmutables** `/<x.y.z>/`, con `base: './'` y almacenamiento aislado por ruta: `/` sigue
  siendo `offline-pos`.
- **`/versions`** con los backends conocidos, arrancando con `http://localhost:4000`.
- **Docs para humanos y para IA**: guía en Markdown, OpenAPI 4.4.0, `llms.txt` y un HTML generado de
  la guía. Solo REST.
- **Zip** de cada versión y **`_headers`** (caché larga para los assets con hash, corta para el HTML).

Tomadas en el brainstorming de esta etapa:

- **Primera versión: `0.1.0`**. El `1.0.0` queda para el primer comercio real (con #54 y #150); un
  `0.x` además no se confunde con el contrato (4.4.0).
- **La compatibilidad de `/versions` se calcula al generar la página**, nunca en vivo desde el
  navegador (eso dispararía el permiso de red local con solo abrirla, y fallaría con el backend
  apagado).
- **Una carpeta de versión solo declara hechos del POS** (`version.json`). La lista de backends es
  un dato **del sitio**, no de una versión: vive en `main` (`site/backends.json`), cambia por PR, y
  `/versions` se regenera entera cruzando **todas** las carpetas publicadas contra la lista
  **actual**. Si un backend sube de major, las filas de los POS viejos pasan a "incompatible" en la
  próxima generación. La app nunca lee esa lista.
- **El contrato y las capacidades de cada backend se consultan, no se cargan a mano.** Como
  `GET /info` está autenticado, el generador pide `POST /demo-sessions` (público) y con esa conexión
  consulta `GET /info`. Sin cambio de contrato; la alternativa (`/info` público) quedó en #151.
  Consecuencia: la lista solo admite backends con `demo-sessions`.
- **Regeneración**: con el tag, con un push a `main` que toque `site/`, con un cron diario y a mano.
  Si un backend no contesta, la generación **falla** y no publica nada (nunca datos viejos sin
  avisar).
- **Docs en español**, con un solo OpenAPI: se limpian del archivo del repo las referencias
  internas (issues, specs, `AGENTS.md`).
- **`/DIAGNOSTICO` muestra la versión del POS y el nombre del almacenamiento.**
- **El demo-backend contesta el preflight de red privada** (acompaña al POS).

## Estructura publicada (rama `publish`)

```
_headers
_redirects                  → / redirige a /versions/
llms.txt                    → índice para IA: docs de la versión más nueva y lista de versiones
versions/index.html         → tabla versión del POS × backends conocidos
0.1.0/                      → el POS (inmutable)
  index.html, assets/, favicon.svg
  version.json              → { version, contract, minBackendContract }
  docs/
    index.html              → la guía convertida a HTML
    guia.md
    connector-api.openapi.yaml
    llms.txt
0.1.0.zip                   → carpeta offline-pos-0.1.0/ con todo lo de /0.1.0/
```

## 1. El circuito

```
main (PR)                          GitHub Action (publish.yml)          rama publish     Cloudflare Pages
tag v0.1.0 ──────────────────────► build + arma /0.1.0/ + /versions ──► commit + push ──► deploy automático
push a main que toca site/ ──────► regenera /versions y /llms.txt ────► commit si cambió
cron diario / a mano ────────────► regenera /versions y /llms.txt ────► commit si cambió
```

- **`site/`**, en la raíz del repo y fuera de `src/` (la app nunca lo importa): scripts de
  publicación en TypeScript, ejecutados con el Node 24 del repo sin compilar (type stripping; solo
  sintaxis borrable). Pueden importar módulos puros de `src/` (`domain/contract-version.ts`,
  `sync/demo-session.ts`) para no duplicar reglas.
  - `site/backends.json`: la lista de backends conocidos.
  - `site/build-version.ts`: arma `/<ver>/` en un directorio de sitio a partir de `dist/`.
  - `site/build-versions-page.ts`: consulta los backends y genera `/versions/index.html` y
    `/llms.txt`.
  - `site/build-site.ts`: los dos anteriores sobre un directorio vacío (`pnpm site:build`, para
    probar en local y en el e2e). La Action llama a los dos por separado sobre la rama `publish`.
  - `site/templates/`: `_headers`, `_redirects` y la plantilla HTML de la guía (`/versions` se
    arma en `site/versions-page.ts`).
- **Rama `publish`**: huérfana; la crea la Action la primera vez. Una carpeta `/<ver>/` que ya existe
  nunca se pisa.
- **Cloudflare** solo mira `publish`: sin build, raíz como salida, preview deployments desactivados.
  No hace falta ningún token de Cloudflare en GitHub.
- `package.json` pasa a `0.1.0`.

## 2. Almacenamiento aislado por carpeta

Módulo nuevo `src/storage/storage-namespace.ts`:

- `storageNamespaceFor(pathname: string): string` (pura). Toma la carpeta de `pathname` (todo hasta
  la última `/`, inclusive): `/` → `offline-pos`; cualquier otra carpeta `c` → `offline-pos@<c>`.
  `/0.1.0/` y `/0.1.0/index.html` → `offline-pos@/0.1.0/`; `/pos/0.1.0/` → `offline-pos@/pos/0.1.0/`.
- `STORAGE_NAMESPACE`: se calcula **una vez al cargar el módulo** desde `window.location.pathname`.
- `LOCAL_STORAGE_PREFIX = STORAGE_NAMESPACE + ':'` y `storageKey(nombre)` = prefijo + nombre. Pasa a
  vivir acá (hoy está en `sync/terminal-data.ts`).
- `storage/db.ts` abre `new Dexie(STORAGE_NAMESPACE)`.
- Cada clave fija `'offline-pos:xxx'` de `src/sync/` (`config`, `cursor`, `push-lot`,
  `backend-capabilities`, `backend-notices`, `cleanup-schedule`, `receipt-counter`,
  `ticket-counter`, `terminal-identity`, `wipe-key`, `daily-counter` y las que aparezcan) pasa a
  `storageKey('xxx')`, con el mismo nombre.

Propiedades:

- **En `/` nada cambia**: mismas claves, misma base. Un test fija la lista de claves de `/`.
- **Dos carpetas no se mezclan**: el borrado y el volcado por prefijo (`pos.reset()`,
  `pos.export()`) de `/` no tocan `offline-pos@…` (no empieza con `offline-pos:`), ni al revés.
- **Sin barra final** (`/0.1.0`): con `base: './'` los assets se resuelven contra `/`, dan 404 y la
  app no arranca. Falla segura: nunca abre con el almacenamiento de `/`. Pages redirige a la barra
  final (se verifica en la primera publicación); la guía pide servir el zip siempre con barra
  final.

### `/DIAGNOSTICO`

Suma una línea con la versión del POS y el almacenamiento: `POS 0.1.0 · almacenamiento
offline-pos@/0.1.0/`. La versión llega con un `define` de Vite (`__POS_VERSION__`, desde
`package.json`), declarado en un `.d.ts` para el typecheck y con un valor en el setup de Vitest.

## 3. `base: './'`

`vite.config.ts` pasa a `base: './'`: todas las rutas del build son relativas, así el mismo `dist/`
anda en `/0.1.0/`, en `/` o en cualquier carpeta de quien copie el zip. El favicon de `index.html`
(`/favicon.svg`) pasa a `./favicon.svg`. El dev server y `pnpm preview` en `/` siguen igual. Se
actualiza la línea de "Onboarding de demo" de `AGENTS.md` que dice "sin cambiar `base` de Vite para
el MVP".

## 4. `/versions` y los backends conocidos

### `site/backends.json`

```json
[
  {
    "name": "demo-backend local",
    "url": "http://localhost:4000",
    "local": "demo-backend",
    "notes": "Levantalo con el demo-backend/ del mismo tag que la versión del POS (pnpm --filter demo-backend run start)."
  }
]
```

Esquema Zod en el generador (`name` y `url` obligatorios, `url` https o http a localhost con la
misma regla del POS, `local` opcional con el único valor `demo-backend`, `notes` opcional). Una
entrada mal formada falla antes de consultar nada.

### El generador (`site/build-versions-page.ts`)

1. Lee `<sitio>/*/version.json` (cada carpeta publicada) y lo valida con Zod.
2. Por cada backend:
   - Con `local: "demo-backend"`: **siempre levanta su propio demo-backend** del commit actual, en
     memoria (`DEMO_BACKEND_DB=:memory:`) y en un puerto libre, y lo consulta ahí; lo apaga al
     terminar. Nunca consulta un `localhost:4000` ya levantado, porque `POST /demo-sessions`
     resiembra la base del demo-backend y le borraría los datos a quien lo esté usando. La tabla
     muestra igual la `url` de la entrada.
   - `POST /demo-sessions` con `sync/demo-session.ts::requestDemoSession` (la misma validación que
     el POS), y con la conexión devuelta (`baseUrl` o la `url`, y `apiKey`), `GET /info` con el
     header de versión, validado con Zod (`contractVersion`, `capabilities`).
   - Falla con un mensaje claro si el backend no contesta, si la respuesta no valida o si no
     declara `demo-sessions`.
3. Cruza versión × backend con `domain/contract-version.ts::isCompatibleContract(backend.contract,
   version.minBackendContract)`: la misma función pura que usa el POS.
4. Escribe `versions/index.html`: HTML plano, sin JavaScript, con estilos en línea, claro y oscuro.
   - Arriba, por backend: nombre, URL, contrato, capacidades, notas y fecha de la consulta.
   - Tabla: una fila por versión del POS, de la más nueva a la más vieja (orden semver). Columnas:
     versión, contrato que habla, docs (`/<ver>/docs/`), zip (`/<ver>.zip`) y una por backend.
   - Celda compatible: link de demo `../<ver>/?demo=true&backend=<url codificada>`. Incompatible:
     "Incompatible: el backend habla 5.0.0; este POS acepta 4.x desde 4.0.0".
5. Escribe `/llms.txt` (formato llmstxt.org): título, resumen, link a las docs de la versión más nueva
   y la lista de versiones con sus docs.
6. Copia `_headers` y `_redirects`.

La fecha de la consulta es lo único que cambia entre dos generaciones iguales. La Action compara
ignorándola (el HTML lleva la fecha en un único elemento marcado, y la comparación lo quita) y no
commitea si no hay otra diferencia: el cron diario no produce deploys vacíos.

## 5. Docs para humanos y para IA

Fuente en el repo, legible también desde GitHub, en `docs/integradores/`:

- `guia.md`, en español:
  - Qué es el POS y cómo probarlo: levantar el demo-backend, abrir el link de demo de `/versions`,
    aceptar el permiso de red local de Chrome (y cómo reactivarlo si se rechazó). El navegador de
    referencia es Chromium.
  - Cómo implementar el contrato: `GET /info`, `POST /sync/push`, `POST /sync/pull`,
    `POST /account-holds`, `POST /demo-sessions` y la vuelta del alta con `#connect=…`.
  - Compatibilidad por piso y capacidades; reglas de evolución (con referencia al OpenAPI).
  - Cómo servir el zip: en su propia carpeta, siempre con barra final. Cada carpeta tiene su
    almacenamiento, y pasar de una versión a otra es una instalación nueva.
  - Cómo pedir que un backend figure en `/versions` (PR a `site/backends.json`; requiere
    `demo-sessions`).
- `llms.txt`: título, resumen y links relativos a `guia.md`, `connector-api.openapi.yaml` e
  `index.html`.

El OpenAPI sigue siendo uno solo (`docs/connector-api.openapi.yaml`): se limpian de sus
`description` las referencias internas (números de issue, rutas a specs, `AGENTS.md`, nombres de
módulos del POS cuando no aportan al integrador). El historial por versión del contrato queda. No es
un cambio de contrato: sigue en 4.4.0.

`site/build-version.ts` publica en `/<ver>/docs/`: `index.html` (la guía convertida con `marked`,
devDependency sin dependencias propias, dentro de una plantilla mínima; los links a `guia.md` y al
OpenAPI siguen funcionando porque son relativos), `guia.md`, `connector-api.openapi.yaml` y
`llms.txt`.

## 6. `version.json` y zip

- `site/build-version.ts` escribe `/<ver>/version.json` con `version` (de `package.json`),
  `contract` (`POS_CONTRACT_VERSION`) y `minBackendContract` (`MIN_BACKEND_CONTRACT`).
- El zip lo arma la Action con el `zip` de Ubuntu (`offline-pos-<ver>/` con todo `/<ver>/`), sin
  dependencia nueva. `pnpm site:build` en local no arma el zip (en Windows no hay `zip`); el link
  queda igual en la tabla.

## 7. Action, `_headers` y `_redirects`

`.github/workflows/publish.yml`:

- Disparadores: `push` de tags `v*.*.*`, `push` a `main` con `paths: ['site/**']`, `schedule` diario
  y `workflow_dispatch`.
- `permissions: contents: write`; `concurrency: { group: publish, cancel-in-progress: false }`.
- Pasos comunes: checkout del ref, pnpm y Node 24, `pnpm install --frozen-lockfile`, y la rama
  `publish` en un worktree aparte (si no existe, huérfana y vacía).
- **Con tag**: falla si el tag no coincide con `v` + `package.json.version`, o si `/<ver>/` ya
  existe en `publish`. `pnpm build`, `site/build-version.ts`, el zip, el generador de `/versions`,
  commit "publish: v<ver>" y push. No repite lint ni tests: el tag sale de un `main` que ya pasó CI.
- **Sin tag**: solo el generador de `/versions`; commit "publish: /versions" y push si cambió algo
  más que la fecha.

`_headers`:

```
/*
  X-Content-Type-Options: nosniff
/*/assets/*
  Cache-Control: public, max-age=31536000, immutable
/*/index.html
  Cache-Control: public, max-age=0, must-revalidate
/versions/*
  Cache-Control: public, max-age=0, must-revalidate
/llms.txt
  Cache-Control: public, max-age=0, must-revalidate
```

(Las reglas exactas se ajustan a la sintaxis de Pages al implementar, con el mismo criterio: los
assets con hash, un año e `immutable`; todo lo demás, revalidar siempre.) La CSP y el resto del
hardening siguen en #54.

`_redirects`: `/ /versions/ 302`.

### Guía de publicación (`docs/publicacion.md`)

Para el mantenedor, que nunca usó Cloudflare, paso a paso:

1. Publicar una versión: PR que sube `package.json.version`; después del merge,
   `git tag v0.1.0` y `git push origin v0.1.0`; la Action crea (la primera vez) o actualiza la rama
   `publish`. Cloudflare necesita que la rama exista antes de conectarla.
2. Crear la cuenta de Cloudflare.
3. Crear el proyecto: Workers & Pages → Pages → conectar con Git → autorizar el repo; nombre
   `offline-pos` si está libre; rama de producción `publish`; preset "None", sin comando de build,
   `/` como directorio de salida.
4. Desactivar los preview deployments de las otras ramas (si no, Pages publicaría la raíz de `main`
   como sitio).
5. Verificar: `https://<proyecto>.pages.dev/` redirige a `/versions/`; el link de demo abre el POS
   con el demo-backend local; `/0.1.0` redirige a `/0.1.0/`.
6. Sumar un backend a `/versions`, qué hacer si la Action falla, y dónde se agregaría el dominio
   propio cuando llegue #150.

## 8. Local Network Access

En Chrome actual, una página pública que pide algo a `http://localhost` dispara un pedido de
permiso de acceso a la red local. No es contenido mixto (`http://localhost` cuenta como seguro). El
preflight de Private Network Access (`Access-Control-Request-Private-Network`) quedó reemplazado por
ese permiso, pero algunos Chromium lo pueden seguir mandando.

- **Demo-backend**: si el preflight (`OPTIONS`) trae `Access-Control-Request-Private-Network: true`,
  contesta además `Access-Control-Allow-Private-Network: true`. Inofensivo, con su test.
- La guía de integradores explica el permiso (sección 5).
- **Verificación real** en la primera publicación, en la prueba manual con Chrome: link de demo de
  `/versions` → aceptar el permiso → la venta arranca. El e2e no puede probarlo (corre en
  `localhost`). Si el permiso no alcanza (por ejemplo el POS necesita declarar
  `targetAddressSpace` en el `fetch`), el arreglo entra en esta misma etapa como `0.1.1` (la carpeta
  `0.1.0` es inmutable). Por eso el PR lleva "Refs #148", no "Closes": #148 se cierra a mano
  después de la primera publicación y de esta verificación.

## 9. Tests

- **Vitest**:
  - `storage-namespace`: `storageNamespaceFor` en sus casos; en `/` cada clave queda igual que hoy
    (lista fija); el borrado y el volcado por prefijo de un namespace no tocan las claves del otro.
  - `site/`: esquema de `backends.json`; cruce de compatibilidad (compatible; incompatible por major y por piso)
    y rechazo de un backend sin `demo-sessions`; orden semver; HTML sin cambios fuera
    de la fecha; `llms.txt`. Con `// @vitest-environment node`, y sin red: la consulta a los
    backends se inyecta.
  - `demo-backend`: el header de red privada, con y sin el header del preflight.
  - `/DIAGNOSTICO`: la línea de versión y almacenamiento.
- **E2E nuevo** (`e2e/published-site.spec.ts`): `pnpm site:build` arma `.site-out/` (desde cero, sin
  la rama `publish`), servido con `vite preview --outDir .site-out` en otro puerto:
  - `/` redirige a `/versions/`, que lista `0.1.0` con su link de demo (en el preview de Vite el
    redirect de `_redirects` no aplica: se prueba `/versions/` directo y el redirect se verifica en
    Cloudflare).
  - El link de demo, con la misma forma que el de la tabla pero apuntado al backend en memoria
    (`:4001`, el de `demo-onboarding.spec.ts`), abre `/0.1.0/`, entra a la venta, y los assets y el
    favicon cargan por ruta relativa.
  - Existe la base `offline-pos@/0.1.0/`, no existe `offline-pos`, y las claves de `localStorage`
    llevan el prefijo `offline-pos@/0.1.0/:`.
  - `/0.1.0/docs/` muestra la guía.
  - El resto de la suite sigue en `/`: prueba de paso que la raíz no cambió.
- `pnpm lint` y `pnpm typecheck` incluyen `site/`.

## 10. Documentación del repo

- `AGENTS.md`: la línea de "Onboarding de demo" sobre `base`; `site/` en la estructura; una sección
  corta "Publicación" (carpetas por versión, almacenamiento por ruta, `/versions`, Action, guía);
  estado y siguiente.
- `src/storage/AGENTS.md`: el namespace (dónde se calcula, por qué `/` no cambia, que nadie escribe
  una clave `offline-pos:` a mano).
- `e2e/AGENTS.md`: el spec nuevo y su servidor.
- `.gitignore`: `.site-out/`.

## Orden de implementación

1. Namespace de almacenamiento (y `/DIAGNOSTICO`).
2. `base: './'` y favicon.
3. Demo-backend: preflight de red privada.
4. OpenAPI limpio y docs de integradores.
5. `site/`: `build-version`, generador de `/versions`, `build-site`, plantillas.
6. E2E del sitio publicado.
7. Action y guía de publicación.
8. `package.json` a `0.1.0` y `AGENTS.md`.

La primera publicación (tag, cuenta y proyecto de Cloudflare) va **después del merge**, siguiendo la
guía; la verificación de Local Network Access se hace ahí.
