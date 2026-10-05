# Google Sheets en 4.6.0: portal a la planilla, "Conectar el POS" y el puente publicado

Fecha: 2026-10-05
Estado: diseño aprobado; un plan por etapa en `docs/superpowers/plans/`.
Issues: epic #180 (Google Sheets como acceso gratuito y permanente): etapa A = punto 2, etapa B =
punto 3 (#133), etapa C = punto 1. Reemplaza a la spec del 2026-09-30 ("el puente de Sheets publicado
en cada carpeta de versión", sin implementar), que quedó vieja con el canal `/v4/` (#54) y el
contrato 4.6.0 (#178). Antecedentes: #127 y #138 (cerrados), PR #168 (el puente se mantiene en este
repo, con piso).

## Contexto

- **El puente** (`src/connectors/google-sheets/bridge.gs` y `columnas.gs`) habla el contrato 4.2.0.
  Con el piso 4.0.0 es compatible con el POS de hoy (4.6.0), pero no declara capacidades: no se
  anulan sus cobranzas, no hay portal ni empresa. `sync/connector-registry.ts` lo describe como "Sin
  mantenimiento: habla el contrato 4.2".
- **El portal** (4.6.0, #178 y #179) solo existe para los conectores REST:
  `sync/portal-link.ts::requestPortalLink` devuelve `portal/not-offered` para cualquier otro tipo
  sin pedir nada. El resto es genérico: el conector de Sheets valida `info` con el mismo
  `backendInfoSchema`, así que capacidades, empresa (4.5.0) y `portal` del puente se guardan y se
  muestran como los de un backend REST; `sync/backend-portal.ts::portalOffer` decide el comando.
- **El onboarding** (#128): la vuelta `#connect=<base64url>` (`sync/demo-link.ts::readConnectReturn`,
  `ui/onboarding.ts::handleReturn`) solo acepta una conexión REST (`baseUrl`, `apiKey`, `branch`,
  `pointOfSale`). Sheets no tiene onboarding (#133): se pega la URL del Web App en `/CONFIG` a mano.
- **El seed**: en el primer pedido el puente crea las pestañas que faltan y siembra productos y
  clientes de prueba en las nuevas.
- **La publicación** (#54): un canal `/v<major>/` (hoy `/v4/`) que siempre tiene el último POS del
  major, armado por `site/build-channel.ts`. Ya copia `bridge.gs` y `columnas.gs` sueltos en
  `/v4/docs/`, sin guía; `bridge.gs` tiene 18 comentarios que citan issues (uno, también el
  requisito `RNF-07` del doc de diseño) y uno que remite a `demo-backend/src/lots.ts`.

## Qué se busca

Que una planilla de Google Sheets sea un acceso gratuito y permanente al POS, sin servidor: quien
quiere usarla copia un template, implementa el puente y se conecta desde un botón; desde el POS, el
portal abre la planilla de origen. El usuario va a armar ese template a partir de la planilla que
genera el seed (agregándole datos y resúmenes) y compartirla. Un integrador encuentra el puente y su
guía en las docs del canal.

## Decisiones

Tomadas en el brainstorming del 2026-10-05 (y las del 2026-09-30 que siguen en pie):

- **El puente pasa a 4.6.0**, con `customer-payment-void` (4.3), `company` (4.5) y `portal` (4.6).
  Sin `notices` por ahora; la planilla nunca está en mantenimiento.
- **El portal abre la planilla de origen**: comando `/PLANILLA`, etiqueta "Abrir planilla".
- **Las cobranzas anuladas se marcan**, como las ventas: la original pasa a Estado = Anulada.
- **El link que conecta sale de la copia ya implementada**, nunca de una celda: una celda con la URL
  del Web App viajaría en "Hacer una copia" y conectaría el POS a la planilla de otro. La página de
  `doGet` lo arma con la URL de su propia implementación.
- **El link no lleva el secreto compartido**: la página de `doGet` es pública.
- **El link de Sheets siempre precarga el wizard**, nunca aplica ni borra solo: le faltan la
  sucursal y el punto de venta (y el secreto, si se usa).
- **Una spec, tres etapas** (A → B → C), cada una con su plan, su rama y su PR; entre etapas, el
  usuario prueba contra una planilla real.
- **Doc público nuevo** en `docs/integradores/google-sheets.md`; el README del conector queda para
  desarrollo. **`bridge.gs` sin referencias internas en el repo**, publicado tal cual.
- **Sin versión propia**: el canal se publica con el próximo tag (`pnpm release:tag`).

## Etapa A: el puente en 4.6.0, con portal a la planilla

### Puente

- `CONTRACT_VERSION = '4.6.0'`. La acción `info` devuelve, además de lo de hoy:

  ```js
  capabilities: ['customer-payment-void', 'portal'],
  company: { name: SpreadsheetApp.getActive().getName() },
  portal: { command: 'PLANILLA', label: 'Abrir planilla' },
  ```

  `info` sigue liviana (sin lock y sin crear pestañas). Un nombre de planilla vacío no manda
  `company` (el POS lo trataría como mal formado igual, pero no se manda basura).
- **Cobranzas anuladas (4.3)**: una cobranza con `voidsPaymentId` se escribe como cualquier otra
  (medios y total en negativo; en `CuentaCorriente`, `-total`, así que el saldo sube: ya funciona
  hoy). Se suman dos columnas opcionales a Cobranzas en `columnas.gs`: **Estado** (`Cerrada` /
  `Anulada`, con desplegable, como en Ventas) y **Anula a** (el id de la cobranza anulada). Toda
  cobranza nueva se escribe `Cerrada`; la anulación marca `Anulada` las filas de la original. Si la
  planilla no tiene la original, no es un error (igual que con las ventas). Una planilla existente
  gana las dos columnas al final con `ensureColumns`; las filas viejas quedan con Estado vacío.
- **Acción nueva `portalLink`**: sin payload; devuelve `{ url: SpreadsheetApp.getActive().getUrl() }`.
  Pasa por el chequeo de secreto y de versión de siempre; no toma el lock ni crea pestañas. No emite
  ningún token: abrir la planilla ya exige la cuenta de Google de quien tenga acceso.
- Tests en `bridge.test.ts` con la planilla falsa (`src/test/fake-spreadsheet.ts`, que gana
  `getName()` y `getUrl()` si no los tiene).

### POS

- `sync/portal-link.ts::requestPortalLink`: con `config.type === 'google-sheets'`, llama a
  `callBridge(config, { action: 'portalLink' }, portalLinkSchema)` (`bridge-client.ts`) en vez de
  devolver `portal/not-offered`; los errores son los del cliente del puente. El `fetch` de REST queda
  igual. `portalLinkSchema` (https) se reusa.
- `sync/connector-registry.ts`: la descripción de Sheets deja de decir "Sin mantenimiento".
- Lo demás no cambia: el comando y el botón salen de `portalOffer` con la capacidad y el objeto
  `portal` que el puente declara.

### Docs de la etapa

- README del conector: sección "Contrato 4.6.0" (qué hay que redesplegar, columnas nuevas, portal) y
  los pasos nuevos del checklist manual (portal, anular una cobranza, empresa en `/DIAGNOSTICO`).
- `src/connectors/AGENTS.md` y `src/sync/AGENTS.md` (el portal ya no es solo REST).

## Etapa B: "Conectar el POS" (onboarding de Sheets, #133)

### Puente

- **`doGet` devuelve una página** (`HtmlService`) en vez del JSON de prueba: el nombre de la planilla,
  la versión del contrato y un botón **Conectar el POS** que abre
  `<POS_URL>#connect=<base64url de JSON>` con

  ```json
  { "type": "google-sheets", "webAppUrl": "<ScriptApp.getService().getUrl()>" }
  ```

  en una pestaña nueva (`target="_blank"`: la página de un Web App corre en un iframe). `POS_URL` es
  una constante de `bridge.gs` (`https://pos.contax.ar/v4/`) que se puede cambiar con la propiedad de
  script `POS_URL`. La base64url se arma con `Utilities.base64EncodeWebSafe` sin el relleno `=`.
- **Pestaña Inicio** en el seed, la primera de la planilla, creada solo si no existe (nunca se
  reescribe: el usuario la va a editar para el template): título, el link fijo a
  `https://pos.contax.ar/v4/` (sin config, así sobrevive a la copia) y los pasos (hacer una copia,
  Extensiones > Apps Script > Implementar como Aplicación web, abrir la URL del Web App, Conectar el
  POS, completar el wizard). Cada terminal se conecta igual, abriendo la URL del Web App desde esa
  terminal. No guarda nada propio de una copia. Sus textos van en `columnas.gs`.
- **Riesgo, primero de la etapa**: `ScriptApp.getService().getUrl()` podría pedir un permiso además
  de `@OnlyCurrentDoc`. Se verifica contra una planilla real antes de seguir; si lo pide, se descarta
  (permisos mínimos) y la página pasa a tener un campo para pegar la URL del Web App.

### POS

- `sync/demo-link.ts::readConnectReturn` acepta dos formas en `#connect`: la REST de hoy (sin
  `type`, o `type: 'rest'`) y la de Sheets (`type: 'google-sheets'`, `webAppUrl` https). `ConnectReturn`
  pasa a ser una unión discriminada; la de Sheets nunca trae `wipeKey`.
- `ui/onboarding.ts::handleReturn`: con la forma de Sheets devuelve siempre
  `{ kind: 'review', candidate: { type: 'google-sheets', webAppUrl, …locale }, notice }`, con un aviso
  que pide completar la sucursal, el punto de venta y el secreto si se configuró. Nunca prueba ni
  borra. Con una terminal que ya tiene config o datos, el wizard ofrece Mantener o Borrar como hoy.
- `stripOnboardingParams` ya borra el fragmento: no cambia.

## Etapa C: el puente publicado en el canal

- **Guía pública** `docs/integradores/google-sheets.md` (`# Google Sheets: el puente de Apps Script`),
  escrita sobre A y B: qué es (contrato **4.6.0**, capacidades, qué no hace: stock, reserva de
  crédito, avisos), instalar desde el template o desde una planilla vacía, permisos, Conectar el POS,
  el portal, actualizar el puente (bajar los `.gs` del canal de las terminales, nueva versión de la
  misma implementación), cómo se edita la planilla, qué guarda cada evento, el contrato del puente
  (transporte y acciones `info`, `pushBatch`, `pullBatch`, `portalLink`) y limitaciones. Sin issues
  ni archivos del repo, salvo los links a los `.gs` que se localizan al publicar.
- **Dónde**: `/v4/docs/google-sheets/` con `guia.md`, `index.html`, `bridge.gs` y `columnas.gs`
  (`site/build-channel.ts`; dejan de ir sueltos en `/v4/docs/`). `DocsSources` reemplaza `bridge:
  string[]` por `sheetsGuide`, `sheetsBridge` y `sheetsColumns`.
- **Links**: en el repo la guía apunta a `../../src/connectors/google-sheets/*.gs` y a `guia.md`;
  publicada, a `bridge.gs`, `columnas.gs` y `../guia.md` (reemplazo literal de prefijos, una función
  por destino). `guia.md` suma la sección "Google Sheets: un backend sin servidor" (en el repo
  `google-sheets.md`, publicada `google-sheets/`); `llms.txt` suma la guía (`google-sheets/guia.md`)
  y los dos `.gs`. Sin anclas a secciones: `marked` no genera ids.
- **`renderGuidePage(markdown, version, docsRoot = '')`**: el encabezado de
  `site/templates/guide.html` enlaza al OpenAPI, a `llms.txt` y a "Backends y canales" relativo a
  `docs/`; desde `docs/google-sheets/` hace falta `docsRoot = '../'`. El link "Markdown" es el
  `guia.md` de al lado.
- **`bridge.gs` sin referencias internas**: los comentarios pierden el issue y conservan la versión
  ("4.0.0 (#99): …" → "4.0.0: …"); el de `demo-backend/src/lots.ts` describe el despacho sin nombrar
  el archivo; `RNF-07` pasa a "un evento nunca se modifica". Solo comentarios.
- **README del conector**: las secciones que cubre la guía (setup, cómo se ve la planilla, qué hace
  cada operación, cursor, contrato del puente) pasan a ser un link a ella.

### Tests de la etapa C

- `site/docs.test.ts`: los `.gs` no citan issues (`\(#\d|#\d{2,}|, #\d`, que no confunde
  `'#,##0.00'`) ni `superpowers`, `AGENTS.md`, `pos-web-diseno`, `historia.md`, `demo-backend`,
  `RNF-\d`; la guía del puente igual, salvo los links a los `.gs`; la guía dice el mismo
  `CONTRACT_VERSION` que `bridge.gs`; `guia.md` y `llms.txt` enlazan al puente.
- `site/build-channel.test.ts`: `docs/google-sheets/` con sus cuatro archivos, los `.gs` idénticos a
  la fuente, links localizados, `index.html` con su título y el encabezado con `../`; nada de `.gs`
  suelto en `docs/`.
- `e2e/published-site.spec.ts`: desde `/v4/docs/`, el link a la guía del puente abre su página, y
  `bridge.gs`, `columnas.gs` y el OpenAPI del encabezado responden.

## Verificación

Por etapa: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` y `pnpm test:e2e`; en C,
`pnpm site:build` y `pnpm site:preview` (4174). Prueba manual del usuario contra una planilla real:
en A, el portal, la empresa en `/DIAGNOSTICO` y anular una cobranza; en B, el permiso de
`ScriptApp`, la página de `doGet`, Conectar el POS y la pestaña Inicio en una copia; en C, la guía
en el sitio armado.

## Documentación del repo

Cada etapa pone al día lo suyo (`src/connectors/AGENTS.md`, `src/sync/AGENTS.md`,
`src/ui/AGENTS.md`, README del conector); la C, además, "Publicación" del `AGENTS.md` y
`docs/publicacion.md`. Después de cada merge: "Estado del proyecto" y el ítem en #180.
