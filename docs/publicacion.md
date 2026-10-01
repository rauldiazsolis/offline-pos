# Publicación del POS

Guía para el mantenedor: cómo se publica una versión del POS y cómo se configura Cloudflare Pages la
primera vez. El diseño está en `docs/superpowers/specs/2026-09-29-deploy-mvp-design.md` (#148).

## 1. Cómo funciona

- El sitio publicado vive en la rama **`publish`** del repo, una rama huérfana (sin historia común con
  `main`) que acumula todo lo publicado:
  - una carpeta **inmutable** por versión (`/0.1.0/`), con el POS, su `version.json` y sus docs;
  - un zip por versión (`/0.1.0.zip`);
  - `/versions/` (la tabla de versiones × backends conocidos), `/llms.txt`, `_headers` y `_redirects`.
- La GitHub Action **Publicación** (`.github/workflows/publish.yml`) es la única que escribe en
  `publish`. Corre:
  - con un **tag `vX.Y.Z`**: arma la carpeta de esa versión y su zip, y regenera `/versions`;
  - con un **push a `main` que toca `site/`** (por ejemplo, un backend nuevo en `site/backends.json`):
    solo regenera `/versions` y `/llms.txt`;
  - **todos los días** (cron) y **a mano** (Run workflow): igual, solo regenera. Si nada cambió más
    que la fecha de consulta, no commitea.
- `/versions` se genera consultando en vivo cada backend de `site/backends.json`
  (`POST /demo-sessions` y, con esa conexión, `GET /info`). El demo-backend local no se consulta en
  la máquina de nadie: la Action levanta el del commit, en memoria. Si un backend no contesta, la
  Action falla y no publica nada.
- **Cloudflare Pages** solo sirve la rama `publish`, tal cual, sin build. No hace falta ningún token de
  Cloudflare en GitHub.
- Las carpetas son inmutables: la Action falla si el tag no coincide con `package.json` o si esa
  versión ya está publicada.

## 2. Publicar una versión

1. Un PR que sube `version` en `package.json` (por ejemplo a `0.1.0`), con el resto de los cambios
   de la versión. Merge como siempre.
2. Con `main` actualizado en tu máquina:

   ```sh
   git switch main
   git pull
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. En GitHub → pestaña **Actions** → **Publicación**, mirá que la corrida del tag termine en verde.

La rama `publish` la crea la primera corrida de la Action, sea la de un tag o la de un push a `main`
que toque `site/` (así pasó en `0.1.0`: el merge del PR de #148 la creó con `/versions` vacía, y el
tag sumó la carpeta). Que la Action corra al mergear un PR así es lo esperado; corre aparte del CI.

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

1. `/` redirige a `/versions/` (lo hace `_redirects`).
2. `/versions/` lista `0.1.0`, con el demo-backend local, su contrato y sus capacidades.
3. `/0.1.0` (sin barra) redirige a `/0.1.0/`.
4. Los assets tienen caché larga:

   ```sh
   curl -I https://pos.contax.ar/0.1.0/assets/<un archivo de la carpeta>
   ```

   tiene que mostrar `cache-control: public, max-age=31536000, immutable`.

5. Con el demo-backend levantado en tu máquina (`pnpm backend`, del mismo
   tag), el link **Abrir demo** abre el POS. Chrome pide permiso de **acceso a la red local**
   (la página es `https` y el backend `http://localhost`): aceptalo. El POS tiene que entrar a la venta
   en modo DEMO.
6. `/DIAGNOSTICO` muestra `POS 0.1.0 · almacenamiento offline-pos@/0.1.0/`.

Si el paso 5 no anda con el permiso aceptado (por ejemplo, Chrome exige que el `fetch` declare
`targetAddressSpace`), el arreglo sale como `0.1.1`: la carpeta `0.1.0` no se vuelve a publicar.

## 6. Sumar un backend a /versions

Un PR a `site/backends.json` con `name`, `url` (`https`) y, si querés, `notes`. El backend tiene que
ofrecer demos (capacidad `demo-sessions` en `GET /info`). Al mergear, la Action regenera `/versions`
(el push a `main` toca `site/`). Si el backend no contesta, la Action falla: revisalo antes de mergear.

## 7. Si la Action falla

Abrí la corrida en **Actions** y mirá el paso que falló:

- **"El tag … no coincide con package.json"**: borrá el tag remoto y local, corregí y volvé a
  taggear:

  ```sh
  git push origin :refs/tags/v0.1.0
  git tag -d v0.1.0
  ```

- **"La versión … ya está publicada"**: las carpetas no se pisan. Subí el número de versión
  (`0.1.1`) y publicá esa.
- **Un backend no contesta** (en `/versions y /llms.txt`): el sitio queda como estaba. Se reintenta
  solo al día siguiente, o a mano en **Actions** → **Publicación** → **Run workflow**. Si el backend
  dejó de existir, sacalo de `site/backends.json`.

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
   curl -I https://pos.contax.com.ar/0.1.0/
   ```

   tiene que mostrar un `301` con `location: https://pos.contax.ar/0.1.0/` (la ruta se conserva).

### `offline-pos.pages.dev` sigue sirviendo

No redirige al dominio propio. El almacenamiento del navegador es **por origen**: una terminal que
operó en `offline-pos.pages.dev` no ve sus datos en `pos.contax.ar` (lo que no se sincronizó queda en
la dirección vieja), así que una redirección no traería nada y le cortaría el acceso a lo guardado.
Las dos direcciones son instalaciones separadas que no se mezclan; la oficial es `pos.contax.ar` y
una terminal real se instala solo ahí. Además, el mini-erp baja de `offline-pos.pages.dev` su copia
del POS publicado y el contrato.
