# Publicación del POS

Guía para el mantenedor: cómo se publica una versión del POS y cómo se configura Cloudflare Pages la
primera vez. El diseño está en `docs/superpowers/specs/2026-09-29-deploy-mvp-design.md` (#148) y,
desde el canal por major del contrato, en
`docs/superpowers/specs/2026-10-03-service-worker-pwa-canal-design.md` (#54), que reemplaza las
carpetas por versión.

## 1. Cómo funciona

- El sitio publicado vive en la rama **`publish`** del repo, una rama huérfana (sin historia común con
  `main`) que acumula todo lo publicado:
  - la **home** (`/index.html`): los backends conocidos, cada uno con su link de demo, y para
    integradores las docs de cada canal;
  - un **canal por major del contrato** (`/v4/`): siempre el último POS de ese major, con su service
    worker, su manifest, su `version.json` (versión, contrato y piso) y sus docs (`/v4/docs/`, con el
    OpenAPI, y `/v4/docs/google-sheets/` con el puente de Google Sheets, su setup y su referencia);
  - `/llms.txt`, `_headers` y `_redirects` (`/versions` redirige a la home).
- Dentro del canal, una versión nueva llega a las terminales por el **service worker**, con la misma
  URL y el mismo almacenamiento: el operador la aplica con `/ACTUALIZAR`, o se aplica sola al abrir
  el POS sin ninguna pestaña abierta. Un canal nuevo (`/v5/`) nace solo con un major nuevo del
  contrato; el anterior queda congelado con su último POS.
- No hay carpetas por versión ni zips. Una versión exacta del POS sale de los
  [tags del repo](https://github.com/rauldiazsolis/offline-pos/tags) (`git checkout vX.Y.Z` y
  `pnpm build`).
- La GitHub Action **Publicación** (`.github/workflows/publish.yml`) es la única que escribe en
  `publish`. Corre:
  - con un **tag `vX.Y.Z`**: chequea que el tag coincida con `package.json`, corre el **CI entero**
    (el mismo `ci.yml` de los PR, con el e2e) y, solo si pasa, reemplaza el canal entero con esa
    versión, borra lo que quedó de las carpetas por versión (ver §2) y regenera la home. Tarda lo que
    el CI (unos 4 o 5 minutos);
  - con un **push a `main` que toca `site/`** (por ejemplo, un backend nuevo en `site/backends.json`):
    solo regenera la home y `/llms.txt`;
  - **todos los días** (cron) y **a mano** (Run workflow): igual, solo regenera. Si nada cambió más
    que la fecha de consulta, no commitea. Sin tag no corre el CI: si el código de `site/` estuviera
    roto, la home falla igual y no se publica nada.
- El **CI** (`.github/workflows/ci.yml`) corre en cada PR (un push nuevo cancela la corrida vieja)
  y con el tag, llamado por Publicación; no en el push a `main`: el PR ya probó el merge y el tag lo
  vuelve a probar antes de publicar (#207).
- La home se genera consultando en vivo cada backend de `site/backends.json`
  (`POST /demo-sessions` y, con esa conexión, `GET /info`). El demo-backend local no se consulta en
  la máquina de nadie: la Action levanta el del commit, en memoria. Si un backend no contesta, la
  Action falla y no publica nada.
- **Cloudflare Pages** solo sirve la rama `publish`, tal cual, sin build. No hace falta ningún token de
  Cloudflare en GitHub.
- La Action falla si el tag no coincide con `package.json` o si el canal ya tiene esa versión **o una
  más nueva**: nunca baja ni repite (además, una versión vieja no abre una base de IndexedDB ya
  migrada).

## 2. Publicar una versión

1. Un PR que sube `version` en `package.json` (por ejemplo a `0.3.0`), con el resto de los cambios
   de la versión. Merge como siempre.
2. Con `main` actualizado en tu máquina:

   ```sh
   git switch main
   git pull
   pnpm release:tag
   ```

   `pnpm release:tag` (`site/tag-release.ts`) crea el tag `v<versión de package.json>` y lo sube.
   Antes verifica que estés en `main`, sin cambios sin commitear, igual que `origin/main`, y que el
   tag no exista; si algo falla, dice qué hacer y no toca nada.

3. En GitHub → pestaña **Actions** → **Publicación**, mirá que la corrida del tag termine en verde
   (los jobs `version`, `ci` y `publish`, en ese orden).
4. Verificá en producción (§5).

**Volver atrás es siempre hacia adelante**: un revert en `main`, un tag de parche (`0.3.1`) y
publicar. La Action no deja publicar una versión igual o más vieja que la del canal.

**La primera publicación del canal** (`0.3.0`) además borra de `publish` las carpetas `0.1.0/` y
`0.2.0/`, sus zips y `/versions/` (`site/cleanup.ts`; deja cualquier otra cosa). Las siguientes no
encuentran nada que borrar. Como `offline-pos.pages.dev` y `pos.contax.ar` son el mismo proyecto de
Pages, la limpieza vale para los dos: antes de esa publicación tiene que estar abierto el issue del
mini-erp que deja de bajar `/<versión>/` y los zips.

La rama `publish` la crea la primera corrida de la Action, sea la de un tag o la de un push a `main`
que toque `site/` (así pasó en `0.1.0`: el merge del PR de #148 la creó, y el tag sumó la carpeta).
Que la Action corra al mergear un PR así es lo esperado; corre aparte del CI.

## 3. Primera vez: el proyecto de Cloudflare Pages

Hacelo **después** de que la primera Action haya creado la rama `publish` (Cloudflare la pide al
configurar el proyecto).

1. Creá una cuenta en [dash.cloudflare.com](https://dash.cloudflare.com) (el plan gratuito alcanza).
2. En el panel: **Workers & Pages** → **Create application**. Esa pantalla arranca por **Workers**
   (un asistente con "Select a method" que termina pidiendo "Build command" y "Deploy command:
   `npx wrangler deploy`"): **ese no es**, no aprietes Deploy. Abajo de todo está el link **Looking
   to deploy Pages? Get started**; ahí, **Import an existing Git repository**. (La documentación de
   Cloudflare todavía describe el camino viejo, **Create application** → **Pages** → **Connect to
   Git**.)
3. Iniciá sesión con GitHub. Al instalar la app de Cloudflare en GitHub, elegí **Only select
   repositories** y marcá solo `offline-pos` (permisos mínimos). Después **Install & Authorize** y
   **Begin setup**.
4. En **Set up builds and deployments** (se reconoce porque pide **Production branch**, **Framework
   preset** y **Build output directory**, y no "Deploy command"):
   - **Project name**: `offline-pos`. Si está tomado, otro: el sitio queda en
     `https://<nombre>.pages.dev`.
   - **Production branch**: `publish`.
   - **Framework preset**: `None`.
   - **Build command**: vacío.
   - **Build output directory**: `/` (la raíz de la rama; si la interfaz no acepta `/`, dejalo vacío).
   - **Root directory (advanced)** y **Environment variables**: sin tocar.
5. **Save and Deploy**.

Ojo: un proyecto conectado a Git no se puede pasar después a "Direct Upload"; no hace falta.

## 4. Desactivar los preview deployments

Si no, cada push a `main` o a cualquier otra rama publicaría la raíz del repo como un sitio de
preview.

En el proyecto: **Settings** → **Builds & deployments** → configuración de las ramas de preview →
**None** ("Turns off automatic builds for all preview branches"). Dejá activado **Enable automatic
production branch deployments** para `publish`.

## 5. Verificar

Con `https://pos.contax.ar` (antes del dominio propio era `https://<proyecto>.pages.dev`; ver §8):

1. `/` muestra la home: los backends conocidos con su contrato, sus capacidades y **Abrir demo**.
2. `/versions` y `/versions/` redirigen a `/` (lo hace `_redirects`).
3. `/v4` (sin barra) redirige a `/v4/`.
4. Los assets tienen caché larga y el service worker no:

   ```sh
   curl -I https://pos.contax.ar/v4/assets/<un archivo del canal>
   curl -I https://pos.contax.ar/v4/sw.js
   ```

   el primero tiene que mostrar `cache-control: public, max-age=31536000, immutable`; el segundo,
   `max-age=0` (así la búsqueda de versiones nuevas siempre llega al servidor).

5. Con el demo-backend levantado en tu máquina (`pnpm backend`, del último tag), el link **Abrir
   demo** abre `/v4/` en DEMO. Chrome pide permiso de **acceso a la red local** (la página es `https`
   y el backend `http://localhost`): aceptalo.
6. `/DIAGNOSTICO` muestra `POS 0.3.0 · almacenamiento offline-pos@/v4/ · sin conexión: lista`.
7. Chrome ofrece **instalar** la app (el ícono de la barra de direcciones). Instalada, abre en su
   propia ventana.
8. Sin red (DevTools → Network → Offline, o desconectando la compu) y con F5, el POS abre igual.
9. Con la versión siguiente: una terminal abierta muestra **Versión nueva (/ACTUALIZAR)** en la barra
   de estado (busca cada hora y al arrancar), y `/ACTUALIZAR` la aplica y recarga.
10. `/v4/docs/` muestra la guía para integradores; su link al setup de Google Sheets abre
    `/v4/docs/google-sheets/`, con sus imágenes, y desde ahí `pos-sheets.gs` (el de la versión
    publicada, para pegar en la planilla) y la referencia (`referencia.html`) responden.

## 6. Sumar un backend a la home

Un PR a `site/backends.json` con `name`, `url` (`https`) y, si querés, `notes`. El backend tiene que
ofrecer demos (capacidad `demo-sessions` en `GET /info`). Al mergear, la Action regenera la home
(el push a `main` toca `site/`). Si el backend no contesta, la Action falla: revisalo antes de mergear.

## 7. Si la Action falla

Abrí la corrida en **Actions** y mirá el job y el paso que fallaron:

- **Falló el job `ci`** (con un tag): no se publicó nada. Arreglalo con un PR y publicá un tag de
  parche (`0.4.1`); el tag que falló queda en el repo sin publicar, y el canal nunca lo va a tener
  (el siguiente siempre es más nuevo). Si fue un flake del e2e, abrí la corrida y usá **Re-run
  failed jobs**: vuelve a correr el CI y, si pasa, publica.

- **"El tag … no coincide con package.json"** (job `version`, antes del CI): borrá el tag remoto y
  local, corregí y volvé a taggear (`pnpm release:tag` ya no deja crear uno así):

  ```sh
  git push origin :refs/tags/v0.1.0
  git tag -d v0.1.0
  ```

- **"La versión … ya está publicada en /v4/ (o hay una más nueva …)"**: el canal nunca baja ni
  repite. Para volver atrás: revert en `main`, subí el número de versión (`0.3.1`) y publicá esa.
- **Un backend no contesta** (en `Home y /llms.txt`): el sitio queda como estaba. Se reintenta
  solo al día siguiente, o a mano en **Actions** → **Publicación** → **Run workflow**. Si el backend
  dejó de existir, sacalo de `site/backends.json`. Con un **tag** tampoco se publica el canal (el
  commit va después de la home): cuando el backend vuelva, abrí esa misma corrida y usá **Re-run
  jobs**, no **Run workflow** (que corre sobre `main` y solo regenera la home).

## 8. Dominio propio (#150)

El POS se publica en **`https://pos.contax.ar`**. El DNS de `contax.ar` y `contax.com.ar` está en
DreamHost y se queda ahí: Cloudflare solo sirve el sitio.

### `pos.contax.ar` en Pages

El orden importa: primero Cloudflare, después el DNS (con el registro cargado antes, Cloudflare
contesta con un error 522).

1. En Cloudflare: **Workers & Pages** → el proyecto `offline-pos` → **Custom domains** → **Set up a
   custom domain** → `pos.contax.ar` → **Continue**. Como el DNS no está en Cloudflare, muestra el
   registro a cargar: un **CNAME** con nombre `pos` y destino `offline-pos.pages.dev`, y queda en
   **Inactive (Requires DNS setup)**.
2. En DreamHost: la sección de **DNS** del dominio `contax.ar` → agregar un registro **CNAME**, nombre
   `pos`, valor `offline-pos.pages.dev`.
3. Comprobar que el DNS ya lo devuelve (puede tardar unos minutos):

   ```sh
   nslookup pos.contax.ar 8.8.8.8
   ```

   tiene que mostrar `Name: offline-pos.pages.dev` y `Aliases: pos.contax.ar`.

4. De vuelta en **Custom domains**: **Complete DNS setup** → **Check DNS records**. Si Cloudflare
   revisó antes de que el registro llegara a todos los servidores de DreamHost, sigue en
   **Inactive**: vuelve a revisar solo y avisa por mail. Cuando dice **Active**, emite el certificado
   en unos minutos.
5. Verificar con `https://pos.contax.ar` (§5).

Ningún registro CAA de `contax.ar` limita quién emite certificados; si algún día se agrega uno, tiene
que permitir a las autoridades que usa Cloudflare.

### `pos.contax.com.ar` redirige a `pos.contax.ar`

Como todo `*.contax.com.ar`, redirige a su par en `*.contax.ar`. Lo hace DreamHost, sin pasar por
Cloudflare:

1. En [panel.dreamhost.com](https://panel.dreamhost.com): **Websites** → **Manage Websites** →
   **Add Website** → **Create a Subdomain** → `pos.contax.com.ar` → **Continue**.
2. Elegir **Redirect Domain**, con **Destination URL** `https://pos.contax.ar` (sin barra ni ruta al
   final), y guardar con **Redirect Domain**. DreamHost crea solo el registro DNS del subdominio.
3. En **Manage Websites**, en `pos.contax.com.ar`: agregarle el certificado gratuito de **Let's
   Encrypt**.
4. Verificar:

   ```sh
   curl -I https://pos.contax.com.ar/v4/
   ```

   tiene que mostrar un `301` con `location: https://pos.contax.ar/v4/` (la ruta se conserva).

### `offline-pos.pages.dev` sigue sirviendo

No redirige al dominio propio. El almacenamiento del navegador es **por origen**: una terminal que
operó en `offline-pos.pages.dev` no ve sus datos en `pos.contax.ar` (lo que no se sincronizó queda en
la dirección vieja), así que una redirección no traería nada y le cortaría el acceso a lo guardado.
Las dos direcciones son instalaciones separadas que no se mezclan; la oficial es
`pos.contax.ar/v4/` y una terminal real se instala solo ahí. Además, el mini-erp baja de
`offline-pos.pages.dev` su copia del POS publicado y el contrato (desde #54, de `/v4/` y
`/v4/docs/`: ya no hay carpetas por versión).

## 9. Imprimir sin el diálogo del navegador (#174)

El POS imprime con `window.print()`: cada ticket abre el diálogo de impresión del navegador. Para
que salga directo, sin diálogo, la terminal abre Chrome o Edge con el flag `--kiosk-printing`, por
ejemplo con un acceso directo cuyo destino termine así:

```text
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://pos.contax.ar/v4/
```

Con el flag, el ticket va a la **impresora predeterminada** del sistema, así que:

- la impresora de tickets tiene que ser la predeterminada;
- en su driver tiene que estar elegido el papel del rollo (58 u 80 mm), el mismo formato que en
  `/IMPRESORA`. Con un rollo, el largo del ticket lo corta el driver: se confirma con la impresora
  real.

El flag solo vale si no hay otra ventana de ese navegador abierta al lanzarlo (si la hay, se suma a
ella y lo ignora). Para probar sin impresora, "Guardar como PDF" en el diálogo muestra el ancho y el
contenido del ticket.
