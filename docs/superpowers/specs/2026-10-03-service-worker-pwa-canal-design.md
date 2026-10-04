# Service worker, PWA y canal por major del contrato (`/v4/`)

Fecha: 2026-10-03
Estado: implementado (ver los desvíos al final); falta la primera publicación (`0.3.0`).
Issues: #54 (etapa del epic #182, antes del hito 1). Relacionados: #148 (publicación, que este diseño
reemplaza en parte), #175 (una sola pestaña), #143 (pasar de demo a producción sin repetir el
onboarding). Fuera de alcance: el mini-erp (desarrollo separado: se le avisa con un issue).

## Contexto

Hoy el POS se publica en carpetas inmutables por versión (`/0.1.0/`, `/0.2.0/`), cada una con su
almacenamiento (`storage/storage-namespace.ts`), más un zip por versión y `/versions`, una tabla de
versiones del POS × backends conocidos. La raíz `/` redirige a `/versions/` desde 0.1.0, así que en
`pos.contax.ar/` nunca operó una terminal.

Sin service worker, los datos sobreviven offline (IndexedDB y `localStorage`) pero el código no: con
el navegador cerrado, la compu reiniciada, un F5 o una pestaña descartada, sin red se ve "Sin
conexión" en vez del POS. Y actualizar es una instalación nueva: pasar de `/0.1.0/` a `/0.2.0/` es
arrancar de cero, con lo no sincronizado en la carpeta vieja.

## Decisiones

Del issue (2026-10-03), no se reabren:

- Las terminales se instalan en **`pos.contax.ar/v4/`**, un canal por major del contrato. Dentro del
  canal, una versión nueva llega por el service worker con la misma URL y el mismo almacenamiento;
  Dexie migra el esquema. Un canal nuevo (`/v5/`) nace solo con un major nuevo del contrato.
- La raíz es la página de backends (hoy `/versions`), no el canal vigente.
- `pos.reset()` borra también el service worker y las cachés de su carpeta, nunca las de otro canal,
  y recarga.

Tomadas en este brainstorming:

- **La versión del POS deja de publicarse en detalle.** Hay dos versiones distintas: la del POS es
  interna (llega sola por el service worker) y la que decide dónde instalar es el major del
  contrato. La home ya no cruza versiones del POS con backends: lista **backends conocidos**, y
  quien entra elige quién es el backend, no qué versión del POS usar. Esto revierte "las carpetas
  `/<x.y.z>/` quedan como archivo inmutable" del issue.
- **Sin carpetas por versión ni zips.** Cada tag publica directo en el canal. Se borran `0.1.0/`,
  `0.2.0/` y sus zips. Quien quiera una versión exacta usa los tags del repo
  (`https://github.com/rauldiazsolis/offline-pos/tags`).
- **El mini-erp abre `/v4/` por convención**, sin fijar una versión del POS: la PWA ya le da siempre
  el último POS compatible. Su papel en la home es dar el link de demo u onboarding.
- **Volver atrás es siempre hacia adelante**: un revert en `main` y un tag de parche. La publicación
  se niega a bajar o repetir la versión del canal (también protege el esquema de Dexie: una versión
  vieja no abre una base ya migrada).
- **Una versión nueva la aplica el operador** con `/ACTUALIZAR`, nunca con una venta en curso. Sin
  actualización automática en un momento ocioso por ahora.
- **Service worker propio, sin dependencias**, en vez de `vite-plugin-pwa`: `workbox-build` arrastra
  Babel, Rollup, ajv, terser y unas 35 dependencias más para usar solo precache y fallback de
  navegación (mismo criterio que la nota de TanStack Query en `AGENTS.md`).
- **La transición a un major nuevo queda fuera de alcance.** Hoy un backend que deja de hablar 4
  contesta 409 y el POS frena el sync sin perder nada y sigue vendiendo; mudar una terminal de `/v4/`
  a `/v5/` es otro almacenamiento. Va a un issue `backlog`, y el del mini-erp dice que con un major
  nuevo el backend tiene que hablar los dos durante la transición.

## 1. El sitio y la publicación

### Estructura de la rama `publish`

```
index.html        → la home: backends conocidos con su link de demo
llms.txt          → apunta a /v4/docs/
_headers
_redirects
v4/               → el POS del canal 4 (siempre el último), con sw.js y manifest
  version.json    → { version, contract, minBackendContract }
  docs/           → index.html, guia.md, connector-api.openapi.yaml, llms.txt,
                    bridge.gs, columnas.gs
```

El puente de Google Sheets (`src/connectors/google-sheets/bridge.gs` y `columnas.gs`) se suma a
`docs/`: `AGENTS.md` dice que se publica en cada carpeta de versión, pero `site/` nunca lo copió.

`version.json` no suma la versión del esquema de Dexie: con la guardia de "nunca bajar" (abajo) no
hace falta.

### Con un tag `vX.Y.Z` (`.github/workflows/publish.yml`)

1. Falla si el tag no coincide con `package.json`, como hoy.
2. El canal sale del contrato del POS: `v` + major de `POS_CONTRACT_VERSION`
   (`domain/contract-version.ts`). No se configura.
3. Falla si `v<major>/version.json` ya tiene una versión **igual o mayor** (orden semver): "La
   versión X ya está publicada en /v4/ (o hay una más nueva): para volver atrás, revert y un tag de
   parche".
4. `pnpm build`. `site/build-channel.ts` (reemplaza a `site/build-version.ts`) **reemplaza
   `v<major>/` entero** con el build, su `version.json` y `docs/` (lo mismo que hoy arma
   `build-version.ts`).
5. Regenera la home y `llms.txt`.
6. **Limpieza** (`site/cleanup.ts`): borra de `publish` las carpetas cuyo nombre es `x.y.z`, los
   `*.zip` y `versions/`. Nada más: cualquier otra cosa desconocida queda. La hace la primera
   publicación después del merge (`0.3.0`) y las siguientes no encuentran nada que borrar.
7. Commit "publish: vX.Y.Z" y push, como hoy.

Cuando el POS pase al contrato 5, un tag publica en `v5/` y `v4/` queda congelado con su último POS,
que es el canal de los backends que siguen en 4. Sin código extra.

Sin tag (push a `main` que toca `site/`, cron diario, a mano): solo la home y `llms.txt`, como hoy
`/versions`, con la misma comparación que ignora la fecha de la consulta para no commitear en vano.

### La home (`site/home-page.ts`, reemplaza a `site/versions-page.ts`)

HTML plano, sin JavaScript, claro y oscuro, como `/versions`. El generador
(`site/build-home-page.ts`, reemplaza a `site/build-versions-page.ts`) consulta los backends igual que
hoy (`POST /demo-sessions` y `GET /info`, el demo-backend local levantado en memoria, falla si uno no
contesta) y lee los canales publicados (`<sitio>/v<n>/version.json`, validado con Zod).

- **Una fila por backend** de `site/backends.json`: nombre, URL, notas, contrato, capacidades y fecha
  de la consulta.
- **Acción**: si existe el canal `v<major del backend>` y es compatible
  (`isCompatibleContract(backend.contract, canal.minBackendContract)`), "Abrir demo" con
  `v<major>/?demo=true&backend=<url codificada>` (relativo a la home). Si no, "Incompatible: no hay
  POS para el contrato 5.x" (sin canal) o el mensaje de hoy con el piso (canal con piso más alto).
- **Para integradores**: por canal, su versión del POS, su contrato y el link a `v<n>/docs/`; y el
  link a los tags del repo para una versión exacta.
- `llms.txt` de la raíz: las docs del canal más nuevo y la lista de canales con sus docs.

`site/backends.json` no cambia de forma. La nota del demo-backend local pasa a "levantalo con el
`demo-backend/` del último tag" (ya no hay "versión del POS" en la fila).

### `_redirects` y `_headers`

- `_redirects`: `/versions/ / 301` y `/versions / 301` (links viejos); se saca `/ /versions/ 302`.
- `_headers`: sin cambios. Los assets de `/v4/assets/` siguen con un año e `immutable` (la regla
  `/:version/assets/*` los cubre); `sw.js`, `index.html`, `manifest.webmanifest` y `version.json`
  quedan con el default de Pages (`max-age=0, must-revalidate`), así la consulta por versiones nuevas
  siempre llega al servidor.

### En local

`pnpm site:build` arma la home más `v4/` en `.site-out/` (`site/build-site.ts`), y `pnpm
site:preview` lo sirve como hoy.

## 2. Service worker y manifest

### El service worker (`src/workers/sw.ts`)

- **Build**: Vite lo compila como una segunda entrada (`build.rollupOptions.input`), con nombre fijo
  `sw.js` (sin hash) al lado de `index.html`. Un plugin chico (`build/sw-manifest-plugin.ts` o
  similar, importado por `vite.config.ts`) le inyecta en `generateBundle` la lista de archivos del
  build (todo `dist/` menos `sw.js`: `index.html`, `assets/*`, `favicon.svg`, el manifest y los
  íconos) y un hash de su contenido. `sw.ts` no importa nada de la app, así no comparte chunks.
- **Rutas relativas**: la lista se resuelve contra la URL de `sw.js`. Anda igual en `/v4/`, en `/` o
  en la carpeta de quien sirva el build.
- **Nombre de caché por carpeta**: la Cache Storage es una por origen, así que el nombre sale de la
  carpeta del `scope` con el criterio del almacenamiento: `offline-pos@/v4/:sw:<hash>`;
  `offline-pos:sw:<hash>` en `/`. Un canal nunca toca la caché de otro.
- **`install`**: `cache.addAll` de toda la lista en una caché nueva; si falla un archivo, falla la
  instalación y queda la versión anterior. Sin `skipWaiting` automático: con una versión ya activa,
  la nueva espera a `/ACTUALIZAR` (sección 3) o a que no quede ninguna pestaña del POS abierta.
- **`activate`**: borra las cachés con el prefijo de su carpeta que no son la actual.
- **`fetch`**: solo GET del mismo origen y dentro de su `scope`.
  - Navegación (`request.mode === 'navigate'`): el `index.html` de la caché, sin importar la query
    (`?demo=…` y `#connect=…` siguen andando).
  - Un archivo de la lista: desde la caché.
  - Todo lo demás: a la red, sin tocarlo. El backend nunca pasa por la caché (además es otro
    origen).
- **`message`**: `{ type: 'skip-waiting' }` → `self.skipWaiting()`. Mensaje validado; cualquier otro
  se ignora.
- **Lógica pura aparte** (`src/workers/sw-logic.ts`): nombre y prefijo de caché desde el `scope`, si
  un request se atiende y cómo, qué cachés borrar. `sw.ts` es la capa fina con los eventos.
- `tsconfig`: `sw.ts` necesita los tipos de `WebWorker` (`ServiceWorkerGlobalScope`), en un proyecto
  de TypeScript propio o con una referencia de tipos, sin mezclarlos con los del DOM de la app.

### El registro (`src/ui/service-worker.ts`, adaptador)

- `navigator.serviceWorker.register('./sw.js')`, con el `scope` por defecto (su carpeta).
- **Solo en el build** (`import.meta.env.PROD`), nunca en el dev server.
- Desde `main.tsx::startApp`, o sea solo en la pestaña que manda (#175).
- Sin `navigator.serviceWorker` (contexto no seguro, como `http://` a una IP de la red), no hace nada
  y la app anda como hoy, igual que sin `navigator.locks`.
- `try/catch` acá (es un adaptador): un registro que falla no rompe el arranque; queda como "sin
  service worker" en `/DIAGNOSTICO`.

### El manifest (`public/manifest.webmanifest`, estático)

- `name` y `short_name` "POS"; `start_url`, `scope` e `id` `"./"` (relativos al manifest: cada canal
  es una app instalada distinta); `display: "standalone"`; `background_color` y `theme_color` de
  `tokens.css`.
- Íconos PNG de 192 y 512, y uno de 512 `purpose: "maskable"`, sacados **una vez** del
  `favicon.svg` con un script que usa Playwright (ya es devDependency), commiteados en `public/`.
  Ningún generador nuevo.
- `index.html`: `<link rel="manifest" href="./manifest.webmanifest">` y
  `<meta name="theme-color">`.

## 3. Versión nueva, una sola pestaña, `pos.reset()` y `/DIAGNOSTICO`

### Detectar la versión nueva

El navegador busca un `sw.js` nuevo al navegar, y una pestaña de POS puede quedar abierta días. El
adaptador llama a `registration.update()` al arrancar y **cada hora**; sin red falla en silencio y
se reintenta a la hora siguiente. Cuando hay uno instalado y esperando (`registration.waiting` al
arrancar, o `updatefound` → `installed` con un controller activo),
`ui/state/app-update.ts::appUpdateSignal` pasa de `none` a `available`.

### El aviso

La barra de estado muestra el botón **"Versión nueva (/ACTUALIZAR)"**, como `/ALTA`. `/ACTUALIZAR`
está en `CORE_COMMANDS` pero solo aparece con `appUpdateSignal` en `available` (como `/ALTA` solo en
demo). El aviso no dice qué versión es (habría que pedir `version.json` aparte).

### Aplicarla (`ui/keyboard/app-update-controller.ts`, dependencias inyectadas)

- **Con una venta en curso** (líneas, cliente o ajuste global en el carrito; el mismo criterio de
  "venta en curso" que usa `storage/local-data.ts::hasUserData`): no actualiza y avisa en la barra
  de comandos (`commandBarWarningSignal`): "Terminá o descartá la venta para actualizar."
- **Si no**: `appUpdateSignal` pasa a `applying` (el botón queda deshabilitado, "Actualizando…") y
  suelta como en el traspaso de #175, con `ui/tab-release.ts::prepareTabRelease` (pausa el sync,
  toma su cerrojo, espera las escrituras de IndexedDB, tope de 4 s). Después manda `skip-waiting`
  al service worker en espera y, con `controllerchange`, recarga.
- **Si `controllerchange` no llega en 10 s**: avisa "No se pudo actualizar: cerrá y abrí el POS.",
  vuelve a `available` y reanuda el sync.
- **Al abrir el POS sin ninguna pestaña abierta** (al día siguiente, con Chrome cerrado), el
  navegador ya activa la versión en espera: arranca actualizado sin que nadie haga nada.

### Una sola pestaña (#175)

Solo la pestaña que manda registra y busca versiones. Si la original aplica una versión mientras una
segunda muestra "Usar esta pestaña", la segunda sigue con el código viejo hasta tomar el control, y
es seguro **porque la app no tiene `import()` dinámicos**: un solo bundle ya cargado, al que no le
falta nada aunque `/v4/assets/` ya no tenga los archivos viejos. Queda como regla en
`src/ui/AGENTS.md`: si algún día se suma un `import()` dinámico, la segunda pestaña tiene que
recargar al tomar el control en vez de correr `startApp`.

### `pos.reset()`

Después de borrar lo de hoy (tablas y claves de su prefijo), y antes de recargar:

1. Busca el registro cuyo `scope` es **exactamente** la carpeta actual (`getRegistrations()` y
   comparar `scope`; `getRegistration()` podría devolver el de una carpeta de arriba) y lo da de baja.
2. Borra las cachés con el prefijo de esta carpeta (`offline-pos@/v4/:sw:`; el mismo cálculo de
   `sw-logic.ts`).
3. Recarga. El primer arranque vuelve a registrar el service worker de cero.

Las dos cosas van en `sync/terminal-data.ts::resetTerminal` (o un adaptador que este recibe), con
`try/catch` de adaptador: si el navegador no tiene service worker, no hay nada que borrar.

### `/DIAGNOSTICO` y `pos.status()`

La línea de versión suma el estado del service worker (`collectDiagnostics`):
`POS 0.3.0 · almacenamiento offline-pos@/v4/ · sin conexión: lista`, `… · versión nueva descargada,
falta aplicar` o `… · sin service worker` (contexto no seguro, dev o registro fallido).

## 4. Tests

### Vitest

- `sw-logic`: nombre y prefijo de caché desde el `scope` (`/`, `/v4/`, `/pos/v4/`); qué request se
  atiende (navegación con y sin query, archivo de la lista, otro origen, fuera del `scope`, no-GET);
  qué cachés se borran (nunca las de otra carpeta ni las de otra app del origen).
- El plugin de build: la lista no incluye `sw.js`, incluye `index.html` y los assets, y el hash
  cambia si cambia el contenido de un archivo.
- `app-update-controller`: no actualiza con venta en curso; aplica en orden (soltar, `skip-waiting`,
  recargar); el tope de 10 s reanuda el sync y vuelve a `available`. Con puertos falsos, como
  `tab-leadership`.
- `pos.reset()`: da de baja solo el registro con el `scope` exacto y borra solo las cachés de su
  prefijo.
- `/DIAGNOSTICO`: los tres estados del service worker.
- `site/`: el canal sale del major del contrato; se niega a bajar o repetir; reemplaza el canal
  entero; la limpieza borra `x.y.z/`, `*.zip` y `versions/` y nada más; la home calcula la acción por
  backend y canal (compatible, sin canal, piso más alto) y arma el link a `v<major>/`; `llms.txt`.

### E2E

- `playwright.config.ts`: `serviceWorkers: 'block'` por defecto, así la suite actual no cambia.
- `e2e/published-site.spec.ts` pasa a la home y `/v4/`: la home lista el backend con su link, el
  link abre `/v4/` y entra a la venta, existe la base `offline-pos@/v4/` y las claves llevan su
  prefijo, `/v4/docs/` muestra la guía.
- **Nuevo, `e2e/pwa.spec.ts`**, con `serviceWorkers: 'allow'`:
  - después de la primera carga, offline y con F5 el POS abre (sin service worker vería "Sin
    conexión");
  - con un build distinto servido en la misma carpeta, aparece "Versión nueva (/ACTUALIZAR)"; con
    líneas en la venta no actualiza; al descartarlas, `/ACTUALIZAR` recarga en la versión nueva;
  - `pos.reset()` deja sin registro ni cachés de su carpeta;
  - el manifest carga y sus íconos también.

  Cómo servir "un build distinto" en el e2e (dos `dist/` y cambiar cuál sirve el servidor, o un
  servidor de prueba propio) se decide en el plan.

## 5. Documentación e issues

- `AGENTS.md`: "Publicación" reescrita (canal por major, home de backends, sin carpetas ni zips,
  tags del repo, nunca bajar); el stack ("service worker propio", con la razón, en vez de
  `vite-plugin-pwa`); la tabla de comandos (`/ACTUALIZAR`); "Onboarding de demo" (el link va al
  canal); "Qué es esto" (la PWA ya no está pendiente); estado y siguiente.
- `src/ui/AGENTS.md`: el registro, `/ACTUALIZAR`, el aviso y la regla de los `import()` dinámicos.
- `src/storage/AGENTS.md`: las cachés por carpeta y lo que `pos.reset()` borra.
- `e2e/AGENTS.md`: `serviceWorkers: 'block'` y el spec nuevo.
- `docs/publicacion.md`: publicar = tag, va al canal; no se puede bajar; volver atrás = revert y
  parche; qué verificar en producción (instalar, abrir offline, actualizar); la limpieza de la
  primera vez; el acceso directo con `--kiosk-printing` apunta a `https://pos.contax.ar/v4/`.
- `docs/integradores/guia.md`: el build se sirve en cualquier carpeta, con service worker si es
  `https` o `localhost`; una versión exacta sale de los tags; los links de demo van al canal.
- **Issue en rauldiazsolis/mini-erp**: los links de demo y alta van a `https://pos.contax.ar/v4/`;
  ya no hay `/<versión>/` ni zips, así que el espejo de desarrollo (`src/server/pos-mirror/`) y
  `scripts/contract-source.ts` dejan de fijar una versión (bajan `/v4/` y `/v4/docs/`, o un tag del
  repo); `pages.dev` y `pos.contax.ar` son el mismo proyecto, así que la limpieza también los afecta
  ahí; con un major nuevo del contrato, el backend tiene que hablar los dos durante la transición.
  Absorbe rauldiazsolis/mini-erp#38. Se abre **antes** de la primera publicación.
- **Issue `backlog` en offline-pos**: pasar una terminal de `/v4/` a `/v5/` sin perder lo pendiente
  (relacionado con #143).

## Fuera de alcance

Background Sync API (el sync es del motor propio), notificaciones push, el número de versión en el
aviso, la actualización automática en un momento ocioso, CSP y hardening (si queda algo concreto,
issue aparte).

## Orden de implementación

1. Service worker (`sw-logic.ts`, `sw.ts`) y el plugin de build.
2. Registro y manifest (con los íconos).
3. `/ACTUALIZAR` y el aviso.
4. `pos.reset()` y `/DIAGNOSTICO`.
5. `site/`: canal, home, limpieza; la Action.
6. E2E.
7. Docs; el issue del mini-erp y el `backlog`.

La primera publicación (`0.3.0`, que además hace la limpieza) va **después del merge**, con el issue
del mini-erp ya abierto; la verificación de instalar, abrir offline y actualizar se hace ahí.

## Desvíos aprobados durante la implementación

- **Task 2 — `zod` dentro de `sw.js`**: `sw-logic.ts::parseSwMessage` valida el mensaje con Zod
  (regla del repo para todo dato externo), así que `sw.js` pesa unos 64 KB sin comprimir en vez de
  unos pocos. No cambia nada observable: el service worker se baja una vez por versión.
- **Task 5 — `tab-browser.ts`**: `prepareTabRelease` ahora devuelve con qué deshacer la suelta, y el
  puerto `TabLeadershipDeps.prepareRelease` de #175 sigue devolviendo `Promise<void>`: el adaptador
  lo envuelve (el traspaso nunca deshace, después se recarga) en vez de cambiar el puerto.
- **Task 5 — test de `tab-release.test.ts`** (aclaración, no desvío): "pausa el sync, espera a que
  termine el ciclo en curso…" (de #175, con una espera fija de 60 ms) falló una vez con la suite
  completa en paralelo y pasó solo y en las corridas siguientes. Es un flake de carga del test viejo,
  no de este cambio.
- **Task 6 — `pos.reset()` con el service worker que falla**: si dar de baja el registro o borrar las
  cachés falla, lo dice en la consola y **recarga igual** (los datos ya se borraron). Tiene su test.
- **Task 6 — cuarto estado en `/DIAGNOSTICO`**: además de los tres de la sección 3, `installing`
  ("preparando el modo sin conexión"), para no decir "lista" mientras se instala el primer service
  worker (ya anotado en el plan).
- **Task 7 — link de la guía publicada**: `site/templates/guide.html` tenía "Todas las versiones"
  (`../../versions/`); pasa a "Backends y canales" (`../../`, la home).
- **Task 9 — la página tiene que estar controlada antes de una versión nueva**: cada test de
  Playwright tiene un contexto nuevo, y en la primera carga el service worker se instala sin
  controlar la página (no hay `clients.claim()`, a propósito). Así, una versión nueva no espera (no
  hay ninguna pestaña controlada) y no se avisa. `pwa.spec.ts` recarga una vez hasta tener
  `controller` (`openControlled`) antes de simular la versión nueva. En producción es lo mismo: la
  primera visita a `/v4/` no ve el aviso de una versión que sale en ese mismo momento, y la siguiente
  carga ya arranca con la nueva.
- **Task 9 — `pos.reset()` en el e2e**: el nombre de la caché sale del contenido del build, así que
  al reinstalarse el service worker vuelve a ser el mismo y "ese nombre ya no existe" no prueba nada.
  El test guarda una marca dentro de la caché antes del reset y verifica que después ya no esté.
  `waitForURL` no sirve para esperar la recarga (la URL no cambia): espera el evento `load`.
- **Task 9 — Prettier**: el código copiado del plan no estaba formateado; un commit aparte
  (`style: prettier en los archivos nuevos de #54`) formatea solo los archivos de esta etapa (el CI
  no corre `format:check`, y hay otros archivos del repo sin formatear que no se tocaron).
- **Rama**: la rama de la spec y el plan (`claude/etapa-54-service-worker-pwa-051e50`) estaba tomada
  por otro worktree; se trabajó en una rama local sobre el mismo commit y se publicó con el nombre de
  esa rama.
- **Prueba manual — las docs del canal mostraban el POS**: el service worker atendía cualquier
  navegación dentro del `scope` con el `index.html`, así que `/v4/docs/` quedaba en "Preparando…".
  Ahora solo la carpeta (o su `index.html`) es el POS; otra navegación (las docs) va a la red, o a la
  caché si es un archivo del build. Lo cubren `sw-logic.test.ts` y un test de `pwa.spec.ts` con el
  service worker activo (el de `published-site.spec.ts` corre con los service workers bloqueados, por
  eso no lo vio).
- **Prueba manual — la advertencia de `/ACTUALIZAR` quedaba después de cobrar**: una advertencia de
  la barra se borra con la próxima tecla, y cerrar la venta con Enter o Ctrl+Enter no tipea nada.
  `submitCheckout` ahora borra la advertencia al cerrar la venta (también la de stock, que era de esa
  venta).
- **Prueba manual — los tags del repo en una pestaña nueva** (`target="_blank" rel="noopener"`).
- **Prueba manual — ícono propio (#196)**: en vez del logo de Vite, la marca de mini contax con una
  "p" en lugar de la "c", con sus dos variantes, como en mini: `public/favicon.svg` (el ticket grande,
  que se lee a 16 px) y `scripts/pwa-icon.svg` (el ticket angosto con la línea) para los PNG de 192 y
  512 y el maskable, este con fondo índigo lleno. `theme_color` sigue siendo el de la barra de la app
  (`--color-chrome-bg`).
- **Prueba manual — acentos de `llms.txt` en local** (aclaración, no desvío): `pnpm site:preview` no
  declara `charset` para `.txt`, y Chrome lo lee como Latin-1. Cloudflare Pages lo sirve como
  `text/plain; charset=utf-8` (verificado en `pos.contax.ar/llms.txt`), así que en producción se ve
  bien; ya pasaba antes de #54.
